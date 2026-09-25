export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { recordCanonicalVisualExtraction } from '@/lib/autobidder/services/canonical-bid-service';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:upload');
    const { id } = await context.params;
    const body = await request.json();
    if (!body || !Array.isArray(body.unitTypes)) return fail({ code: 'VALIDATION_ERROR', message: 'Unit types are required.' }, 400);
    return ok(recordCanonicalVisualExtraction(id, body, principal));
  } catch (error: any) {
    return fail({ code: error.code || 'VISUAL_EXTRACTION_FAILED', message: error.message || 'Failed to record visual extraction.', details: error.details }, error.status || 500);
  }
}
