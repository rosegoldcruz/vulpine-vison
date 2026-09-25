import 'server-only';
import { randomUUID } from 'crypto';
import type { BidJob, ProjectManifest } from '@/types';
import { getDatabase } from '@/lib/autobidder/db/database';

type JobRow = { payload_json: string };

function parseJob(row: JobRow | undefined): BidJob | null {
  if (!row) return null;
  return JSON.parse(row.payload_json) as BidJob;
}

function emptyQa() {
  return {
    safeToSend: false,
    criticalIssues: [
      {
        code: 'NOT_PROCESSED',
        message: 'Job has not completed mandatory processing stages.',
      },
    ],
    warnings: [],
    assumptions: [],
  };
}

export class BidJobRepository {
  async create(project: ProjectManifest): Promise<BidJob> {
    const now = new Date().toISOString();
    const job: BidJob = {
      id: randomUUID(),
      projectId: project.projectId,
      state: 'created',
      createdAt: now,
      updatedAt: now,
      manifest: project,
      workbookRecords: [],
      classifiedPages: [],
      unitMix: [],
      takeoffRows: [],
      skuMappings: [],
      pricingLines: [],
      qaResult: emptyQa(),
      manualOverrides: [],
      timings: [],
      logs: [],
    };
    getDatabase()
      .prepare(
        `INSERT INTO bid_jobs
          (id, project_id, workflow_state, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(job.id, job.projectId, 'project_created', JSON.stringify(job), now, now);
    return job;
  }

  async get(jobId: string): Promise<BidJob | null> {
    const row = getDatabase().prepare('SELECT payload_json FROM bid_jobs WHERE id = ?').get(jobId) as JobRow | undefined;
    return parseJob(row);
  }

  async save(job: BidJob): Promise<void> {
    job.updatedAt = new Date().toISOString();
    const result = getDatabase()
      .prepare(
        `UPDATE bid_jobs
         SET payload_json = ?, updated_at = ?, version = version + 1
         WHERE id = ?`,
      )
      .run(JSON.stringify(job), job.updatedAt, job.id);
    if (result.changes !== 1) throw new Error(`Bid job not found: ${job.id}`);
  }

  async listByProject(projectId: string): Promise<BidJob[]> {
    const rows = getDatabase()
      .prepare('SELECT payload_json FROM bid_jobs WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as JobRow[];
    return rows.map((row) => parseJob(row)).filter((value): value is BidJob => value !== null);
  }
}
