export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { recordCanonicalTakeoff } from '@/lib/autobidder/services/canonical-bid-service';

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:upload');
    const { id } = await context.params;
    const body = await request.json();
    if (!body || !Array.isArray(body.cabinets)) return fail({ code: 'VALIDATION_ERROR', message: 'Cabinet rows are required.' }, 400);
    return ok(recordCanonicalTakeoff(id, body, principal));
  } catch (error: any) {
    return fail({ code: error.code || 'TAKEOFF_WRITE_FAILED', message: error.message || 'Failed to write takeoff.', details: error.details }, error.status || 500);
  }
}
