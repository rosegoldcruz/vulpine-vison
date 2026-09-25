import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabasesForTests, getDatabase } from '@/lib/autobidder/db/database';
import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { cancelWaitingFile, initializeFileQueue, listFileQueue, updateFileQueueItem } from '@/lib/autobidder/services/file-queue-service';

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'file-queue-'));
  process.env.AUTOBIDDER_DATABASE_PATH = path.join(directory, 'test.sqlite');
});

afterEach(() => {
  closeDatabasesForTests();
  delete process.env.AUTOBIDDER_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});

async function fixture() {
  const project = await new ProjectRepository().create('Queue fixture');
  const now = new Date().toISOString();
  for (const [id, name] of [['doc-1', 'one.pdf'], ['doc-2', 'two.pdf']]) {
    getDatabase().prepare(`INSERT INTO source_documents
      (id, project_id, original_path, storage_key, file_name, mime_type, byte_size, sha256, outcome, created_at)
      VALUES (?, ?, ?, ?, ?, 'application/pdf', 1, ?, 'accepted', ?)`).run(id, project.projectId, name, `uploads/${name}`, name, `hash-${id}`, now);
  }
  const job = await new BidJobRepository().create(project);
  return { project, job };
}

describe('per-document queue', () => {
  it('tracks independent file progress, retry attempts, failures, and waiting-item cancellation', async () => {
    const { job } = await fixture();
    const items = initializeFileQueue(job.id, ['doc-1', 'doc-2']);
    expect(items.map((item) => item.status)).toEqual(['waiting', 'waiting']);
    updateFileQueueItem(job.id, 'doc-1', { status: 'rasterizing', completedUnits: 1, totalUnits: 2 });
    updateFileQueueItem(job.id, 'doc-1', { status: 'completed', completedUnits: 2, totalUnits: 2 });
    const completedItem = listFileQueue(job.id).find((item) => item.sourceDocumentId === 'doc-1')!;
    updateFileQueueItem(job.id, 'doc-2', { status: 'failed', failureCode: 'ETIMEDOUT', failureReason: 'Temporary network timeout.' });
    const retry = updateFileQueueItem(job.id, 'doc-2', { status: 'retrying' });
    expect(retry.attempt).toBe(2);
    expect(listFileQueue(job.id).find((item) => item.sourceDocumentId === 'doc-1')).toMatchObject({ status: 'completed', completedUnits: 2 });
    expect(cancelWaitingFile(job.id, completedItem.id).status).toBe('completed');
    expect(listFileQueue(job.id).some((item) => item.sourceDocumentId === 'doc-1')).toBe(false);
    expect(getDatabase().prepare('SELECT status, dismissed_at FROM file_queue_items WHERE id=?').get(completedItem.id)).toMatchObject({ status: 'completed' });

    const third = getDatabase().prepare(`INSERT INTO source_documents
      (id, project_id, original_path, storage_key, file_name, mime_type, byte_size, sha256, outcome, created_at)
      VALUES ('doc-3', (SELECT project_id FROM bid_jobs WHERE id=?), 'three.pdf', 'uploads/three.pdf', 'three.pdf', 'application/pdf', 1, 'hash-3', 'accepted', ?)`).run(job.id, new Date().toISOString());
    expect(third.changes).toBe(1);
    const queued = initializeFileQueue(job.id, ['doc-3']).find((item) => item.sourceDocumentId === 'doc-3')!;
    expect(cancelWaitingFile(job.id, queued.id).status).toBe('canceled');
  });

  it('rejects invalid progress and direct removal of active work', async () => {
    const { job } = await fixture();
    const [item] = initializeFileQueue(job.id, ['doc-1']);
    updateFileQueueItem(job.id, 'doc-1', { status: 'rasterizing', completedUnits: 0, totalUnits: 1 });
    expect(() => updateFileQueueItem(job.id, 'doc-1', { status: 'rasterizing', completedUnits: 2, totalUnits: 1 })).toThrow(/may not exceed/i);
    expect(() => cancelWaitingFile(job.id, item.id)).toThrow(/only waiting/i);
  });
});
