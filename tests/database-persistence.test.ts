import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { closeDatabasesForTests, getDatabase } from '@/lib/autobidder/db/database';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'cabinet-brain-db-'));
  process.env.AUTOBIDDER_DATABASE_PATH = path.join(directory, 'test.sqlite');
});

afterEach(() => {
  closeDatabasesForTests();
  delete process.env.AUTOBIDDER_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe('database persistence', () => {
  it('runs canonical migrations and persists project/job repository data across connections', async () => {
    const projectRepo = new ProjectRepository();
    const project = await projectRepo.create('Persistence Fixture');
    const job = await new BidJobRepository().create(project);

    const tables = getDatabase()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining(['projects', 'bid_jobs', 'source_documents', 'audit_events', 'job_runs', 'export_artifacts']),
    );

    closeDatabasesForTests();
    const resumedProject = await new ProjectRepository().get(project.projectId);
    const resumedJob = await new BidJobRepository().get(job.id);
    expect(resumedProject?.projectName).toBe('Persistence Fixture');
    expect(resumedJob?.projectId).toBe(project.projectId);
  });
});

