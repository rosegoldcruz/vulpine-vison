import 'server-only';
import { randomUUID } from 'crypto';
import type { BidJob, ProjectManifest } from '@/types';
import { ensureDataDirs, listFiles, readJson, writeJson } from '@/lib/autobidder/storage/file-store';

function jobPath(jobId: string) {
  return `jobs/${jobId}.json`;
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
    await ensureDataDirs();
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
    await writeJson(jobPath(job.id), job);
    return job;
  }

  async get(jobId: string): Promise<BidJob | null> {
    await ensureDataDirs();
    return readJson<BidJob>(jobPath(jobId));
  }

  async save(job: BidJob): Promise<void> {
    await ensureDataDirs();
    job.updatedAt = new Date().toISOString();
    await writeJson(jobPath(job.id), job);
  }

  async listByProject(projectId: string): Promise<BidJob[]> {
    await ensureDataDirs();
    const files = await listFiles('jobs');
    const jobs: BidJob[] = [];
    for (const f of files) {
      const value = await readJson<BidJob>(f);
      if (value && value.projectId === projectId) {
        jobs.push(value);
      }
    }
    return jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
}
