import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabasesForTests } from '@/lib/autobidder/db/database';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import {
  controlJobRun,
  completeJobRun,
  createJobRun,
  failJobRun,
  getProcessingSettings,
  getRunDiagnostics,
  latestJobRun,
  listProgressEvents,
  recordProgress,
  removeJobRun,
  saveProcessingSettings,
} from '@/lib/autobidder/services/job-control-service';
import { listNotifications } from '@/lib/autobidder/services/notification-service';
import type { Principal } from '@/types/canonical';

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'job-control-db-'));
  process.env.AUTOBIDDER_DATABASE_PATH = path.join(directory, 'test.sqlite');
});

afterEach(() => {
  closeDatabasesForTests();
  delete process.env.AUTOBIDDER_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});

async function fixtureJob() {
  const project = await new ProjectRepository().create('Run Fixture');
  return new BidJobRepository().create(project);
}

describe('persisted job control', () => {
  it('stores measurable progress and controlled pause/resume/cancel state', async () => {
    const job = await fixtureJob();
    const run = createJobRun(job.id);
    recordProgress({ runId: run.id, stage: 'rasterizing', unit: 'pages', completed: 1, total: 4 });
    recordProgress({ runId: run.id, stage: 'rasterizing', unit: 'pages', completed: 2, total: 4 });
    expect(listProgressEvents(run.id).map((event) => event.completed)).toEqual([1, 2]);
    expect(controlJobRun(run.id, 'pause').status).toBe('pause_requested');
    expect(controlJobRun(run.id, 'cancel', 'operator request').status).toBe('cancel_requested');
    expect(latestJobRun(job.id)?.id).toBe(run.id);
  });

  it('persists bounded settings per authenticated principal', () => {
    const saved = saveProcessingSettings('user-1', { workerConcurrency: 99, maximumRetryAttempts: 4 });
    expect(saved.workerConcurrency).toBe(4);
    expect(getProcessingSettings('user-1').maximumRetryAttempts).toBe(4);
    expect(getProcessingSettings('other-user').automaticRetries).toBe(true);
  });

  it('closes runs, non-destructively dismisses completed history, and deletes inactive queue entries', async () => {
    const job = await fixtureJob();
    const completed = createJobRun(job.id);
    expect(completeJobRun(completed.id).status).toBe('completed');
    expect(removeJobRun(completed.id)).toEqual({ id: completed.id, removed: true, disposition: 'dismissed' });
    expect(latestJobRun(job.id)).toBeNull();

    const failed = createJobRun(job.id);
    expect(failJobRun(failed.id, 'Workbook could not be parsed.').controlReason).toContain('Workbook');
    expect(removeJobRun(failed.id)).toEqual({ id: failed.id, removed: true, disposition: 'deleted' });
    expect(() => removeJobRun(failed.id)).toThrow(/not found/i);

    const queued = createJobRun(job.id);
    expect(removeJobRun(queued.id).removed).toBe(true);
  });

  it('derives an evidence-based ETA and persists stalled detection with one notification', async () => {
    const job = await fixtureJob();
    const run = createJobRun(job.id);
    const base = Date.parse('2026-09-25T12:00:00.000Z');
    recordProgress({ runId: run.id, stage: 'rasterizing', unit: 'pages', completed: 1, total: 10, occurredAt: new Date(base).toISOString() });
    recordProgress({ runId: run.id, stage: 'rasterizing', unit: 'pages', completed: 2, total: 10, occurredAt: new Date(base + 10_000).toISOString() });
    recordProgress({ runId: run.id, stage: 'rasterizing', unit: 'pages', completed: 3, total: 10, occurredAt: new Date(base + 20_000).toISOString() });
    const active = getRunDiagnostics(run.id, 'user-1', base + 21_000);
    expect(active.eta).toMatchObject({ samplesUsed: 2, lowerSeconds: 70, upperSeconds: 70 });
    const stalled = getRunDiagnostics(run.id, 'user-1', base + 200_000);
    expect(stalled.run.status).toBe('stalled');
    expect(stalled.failureCause).toContain('No measurable progress');
    const principal: Principal = { id: 'user-1', kind: 'user', displayName: 'User', role: 'admin', organizationId: 'local', scopes: [] };
    expect(listNotifications(principal).filter((item) => item.type === 'processing_stalled')).toHaveLength(1);
    getRunDiagnostics(run.id, 'user-1', base + 300_000);
    expect(listNotifications(principal).filter((item) => item.type === 'processing_stalled')).toHaveLength(1);
  });
});
