export const runtime = 'nodejs';

import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { fail, ok } from '@/lib/autobidder/api/response';
import { readBinary } from '@/lib/autobidder/storage/file-store';
import { discoverWorkbookSchema } from '@/lib/autobidder/services/workbook-parser';
import { withVisionUserOrIntegration } from '@/lib/platform/integration-auth';
import type { Principal } from '@/types/canonical';

async function discoverProjectWorkbook(req: Request, principal: Principal) {
  try {
    const body = await req.json();
    const projectId = `${body?.projectId || ''}`;
    if (!projectId) {
      return fail({ code: 'VALIDATION_ERROR', message: 'projectId is required.', details: {} }, 400);
    }

    const projectRepo = new ProjectRepository();
    const project = await projectRepo.get(projectId, principal.organizationId);
    if (!project) {
      return fail({ code: 'NOT_FOUND', message: 'Project not found.', details: {} }, 404);
    }

    const workbook = project.workbookFiles[0];
    if (!workbook) {
      return fail(
        {
          code: 'WORKBOOK_REQUIRED',
          message: 'A cabinet pricing workbook must be uploaded before schema discovery.',
          details: {},
        },
        409,
      );
    }

    const buffer = await readBinary(workbook.path);
    const schema = discoverWorkbookSchema(buffer);
    return ok({ workbook: workbook.name, schema });
  } catch (error: any) {
    console.error('POST /api/workbook failed', error);
    return fail({ code: 'WORKBOOK_DISCOVERY_FAILED', message: error?.message || 'Workbook discovery failed.', details: {} }, 400);
  }
}

export const POST = withVisionUserOrIntegration('project:read', 'POST /api/workbook', discoverProjectWorkbook);
