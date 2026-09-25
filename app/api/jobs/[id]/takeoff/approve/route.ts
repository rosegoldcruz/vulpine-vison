export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { approveCanonicalTakeoff } from '@/lib/autobidder/services/canonical-bid-service';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'pricing:change');
    const { id } = await context.params;
    const body = await request.json();
    if (!body || !Array.isArray(body.takeoffLineIds)) return fail({ code: 'VALIDATION_ERROR', message: 'Takeoff line ids are required.' }, 400);
    return ok(approveCanonicalTakeoff(id, body.takeoffLineIds, body.note, principal));
  } catch (error: any) {
    return fail({ code: error.code || 'TAKEOFF_APPROVAL_FAILED', message: error.message || 'Failed to approve takeoff.', details: error.details }, error.status || 500);
  }
}
