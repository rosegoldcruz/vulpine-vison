export const runtime = 'nodejs';

import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { fail, ok } from '@/lib/autobidder/api/response';
import { withVisionUserOrIntegration } from '@/lib/platform/integration-auth';
import type { Principal } from '@/types/canonical';

async function getJob(_: Request, principal: Principal, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const jobRepo = new BidJobRepository();
    const projectRepo = new ProjectRepository();
    const job = await jobRepo.get(id);
    if (!job) {
      return fail({ code: 'NOT_FOUND', message: 'Job not found.', details: {} }, 404);
    }
    const project = await projectRepo.get(job.projectId, principal.organizationId);
    if (!project) return fail({ code: 'NOT_FOUND', message: 'Job not found.', details: {} }, 404);
    return ok({ job, project });
  } catch (error: any) {
    console.error('GET /api/jobs/[id] failed', error);
    return fail({ code: 'INTERNAL_ERROR', message: 'Failed to read job.' }, 500);
  }
}

export const GET = withVisionUserOrIntegration('project:read', 'GET /api/jobs/:id', getJob);
