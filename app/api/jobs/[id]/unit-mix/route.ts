export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { recordCanonicalUnitMix } from '@/lib/autobidder/services/canonical-bid-service';

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'unit_mix:modify');
    const { id } = await context.params;
    const body = await request.json();
    if (!body || !Array.isArray(body.entries)) return fail({ code: 'VALIDATION_ERROR', message: 'Unit mix entries are required.' }, 400);
    return ok(recordCanonicalUnitMix(id, body, principal));
  } catch (error: any) {
    return fail({ code: error.code || 'UNIT_MIX_WRITE_FAILED', message: error.message || 'Failed to write unit mix.', details: error.details }, error.status || 500);
  }
}
