export const runtime = 'nodejs';

import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { fail, ok } from '@/lib/autobidder/api/response';
import { createProjectSchema } from '@/lib/autobidder/validation/schemas';
import { withVisionIntegration } from '@/lib/platform/integration-auth';

async function createProject(req: Request) {
  try {
    const body = await req.json();
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      return fail(
        {
          code: 'VALIDATION_ERROR',
          message: 'Invalid project creation payload.',
          details: { issues: parsed.error.issues },
        },
        400,
      );
    }

    const repo = new ProjectRepository();
    const project = await repo.create(parsed.data.projectName);
    return ok({ project }, 201);
  } catch (error: any) {
    console.error('POST /api/projects failed', error);
    return fail({ code: 'INTERNAL_ERROR', message: 'Failed to create project.' }, 500);
  }
}

export const POST = withVisionIntegration('POST /api/projects', createProject);
