export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { asApiServiceError } from '@/lib/autobidder/api/errors';
import { ingestUploads } from '@/lib/autobidder/services/upload-ingestion';
import { withVisionUserOrIntegration } from '@/lib/platform/integration-auth';
import type { Principal } from '@/types/canonical';

async function uploadFiles(req: Request, principal: Principal) {
  try {
    const projectId = req.headers.get('x-project-id') || '';
    if (!projectId) {
      return fail(
        {
          code: 'PROJECT_ID_REQUIRED',
          message: 'Upload requires x-project-id header.',
          details: {},
        },
        400,
      );
    }

    const formData = await req.formData();
    const result = await ingestUploads(projectId, formData, principal);
    return ok(result, 201);
  } catch (error: any) {
    const typed = asApiServiceError(error);
    console.error('POST /api/uploads failed', typed);
    return fail(
      {
        code: typed.code,
        message: typed.message || 'Upload failed.',
        details: typed.details,
      },
      typed.status,
    );
  }
}

export const POST = withVisionUserOrIntegration('project:upload', 'POST /api/uploads', uploadFiles);
