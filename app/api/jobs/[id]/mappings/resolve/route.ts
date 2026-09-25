export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { approveCanonicalNormalization, approveCanonicalSubstitution } from '@/lib/autobidder/services/canonical-bid-service';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'sku:override');
    const { id } = await context.params;
    const body = await request.json();
    if (!body?.takeoffLineId || !body?.catalogSkuId) return fail({ code: 'VALIDATION_ERROR', message: 'Takeoff line and catalog SKU are required.' }, 400);
    if (body.resolutionType === 'normalization') {
      return ok(approveCanonicalNormalization(id, body.takeoffLineId, body.catalogSkuId, body.note, principal));
    }
    if (body.resolutionType && body.resolutionType !== 'substitution') {
      return fail({ code: 'VALIDATION_ERROR', message: 'resolutionType must be normalization or substitution.' }, 400);
    }
    return ok(approveCanonicalSubstitution(id, body.takeoffLineId, body.catalogSkuId, body.note, principal));
  } catch (error: any) {
    return fail({ code: error.code || 'SKU_RESOLUTION_FAILED', message: error.message || 'Failed to resolve SKU.', details: error.details }, error.status || 500);
  }
}
