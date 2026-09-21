export const runtime = 'nodejs';

import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { fail, ok } from '@/lib/autobidder/api/response';
import { asApiServiceError } from '@/lib/autobidder/api/errors';
import { processJobSchema } from '@/lib/autobidder/validation/schemas';
import { processJob } from '@/lib/autobidder/services/workflow-service';
import { withVisionIntegration } from '@/lib/platform/integration-auth';

async function processVisionJob(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
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

    const job = await processJob(id);
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

export const POST = withVisionIntegration('POST /api/jobs/:id/process', processVisionJob);
