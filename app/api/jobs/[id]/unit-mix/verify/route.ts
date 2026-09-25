export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { verifyCanonicalUnitMix } from '@/lib/autobidder/services/canonical-bid-service';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'unit_mix:approve');
    const { id } = await context.params;
    const body = await request.json();
    if (!body || !Array.isArray(body.decisions)) return fail({ code: 'VALIDATION_ERROR', message: 'Verification decisions are required.' }, 400);
    return ok(verifyCanonicalUnitMix(id, body.decisions, principal));
  } catch (error: any) {
    return fail({ code: error.code || 'UNIT_MIX_VERIFY_FAILED', message: error.message || 'Failed to verify unit mix.', details: error.details }, error.status || 500);
  }
}
