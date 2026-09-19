export const runtime = 'nodejs';

import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { fail, ok } from '@/lib/autobidder/api/response';

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const jobRepo = new BidJobRepository();
    const projectRepo = new ProjectRepository();
    const job = await jobRepo.get(id);
    if (!job) {
      return fail({ code: 'NOT_FOUND', message: 'Job not found.', details: {} }, 404);
    }
    const project = await projectRepo.get(job.projectId);
    return ok({ job, project });
  } catch (error: any) {
    console.error('GET /api/jobs/[id] failed', error);
    return fail({ code: 'INTERNAL_ERROR', message: 'Failed to read job.' }, 500);
  }
}
