export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { approveCanonicalQa } from '@/lib/autobidder/services/canonical-bid-service';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'qa:approve');
    requirePermission(principal, 'bid:mark_safe');
    const { id } = await context.params;
    const body = await request.json();
    if (!body?.qaResultId) return fail({ code: 'VALIDATION_ERROR', message: 'QA result id is required.' }, 400);
    return ok(approveCanonicalQa(id, body.qaResultId, body.note, principal));
  } catch (error: any) {
    return fail({ code: error.code || 'QA_APPROVAL_FAILED', message: error.message || 'Failed to approve QA.', details: error.details }, error.status || 500);
  }
}
