export const runtime = 'nodejs';

import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { fail, ok } from '@/lib/autobidder/api/response';
import { asApiServiceError } from '@/lib/autobidder/api/errors';
import { processJobSchema } from '@/lib/autobidder/validation/schemas';
import { processJobWithAutomaticRetries } from '@/lib/autobidder/services/workflow-service';
import { withVisionUserOrIntegration } from '@/lib/platform/integration-auth';
import type { Principal } from '@/types/canonical';

async function processVisionJob(req: Request, principal: Principal, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const ownership = await new BidJobRepository().get(id);
    if (!ownership || !await new ProjectRepository().get(ownership.projectId, principal.organizationId)) {
      return fail({ code: 'NOT_FOUND', message: 'Job not found.', details: {} }, 404);
    }
    const body = await req.json();
    const parsed = processJobSchema.safeParse(body);
    if (!parsed.success || parsed.data.jobId !== id) {
      return fail(
        {
          code: 'VALIDATION_ERROR',
          message: 'Invalid process request payload.',
          details: { issues: parsed.success ? [] : parsed.error.issues },
        },
        400,
      );
    }

    const job = await processJobWithAutomaticRetries(id, principal);
    const projectRepo = new ProjectRepository();
    const project = await projectRepo.get(job.projectId);
    return ok({ job, project });
  } catch (error: any) {
    const typed = asApiServiceError(error);
    console.error('POST /api/jobs/[id]/process failed', typed);
    return fail(
      {
        code: typed.code,
        message: typed.message || 'Failed to process job.',
        details: typed.details,
      },
      typed.status,
    );
  }
}

export const POST = withVisionUserOrIntegration('project:upload', 'POST /api/jobs/:id/process', processVisionJob);
