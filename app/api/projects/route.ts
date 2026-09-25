export const runtime = 'nodejs';

import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { fail, ok } from '@/lib/autobidder/api/response';
import { createProjectSchema } from '@/lib/autobidder/validation/schemas';
import { withVisionUserOrIntegration } from '@/lib/platform/integration-auth';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';

export async function GET(req: Request) {
  try {
    const principal = requestPrincipal(req);
    requirePermission(principal, 'project:read');
    const projects = await new ProjectRepository().list(principal.organizationId);
    return ok({ projects });
  } catch (error: any) {
    return fail({ code: error.code || 'PROJECT_LIST_FAILED', message: error.message || 'Failed to list projects.' }, error.status || 500);
  }
}

async function createProject(req: Request, principal: import('@/types/canonical').Principal) {
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
    const project = await repo.create(parsed.data.projectName, principal.organizationId);
    return ok({ project }, 201);
  } catch (error: any) {
    console.error('POST /api/projects failed', error);
    return fail({ code: 'INTERNAL_ERROR', message: 'Failed to create project.' }, 500);
  }
}

export const POST = withVisionUserOrIntegration('project:upload', 'POST /api/projects', createProject);
