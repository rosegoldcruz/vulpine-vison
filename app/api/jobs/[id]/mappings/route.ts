export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { mapCanonicalSkus } from '@/lib/autobidder/services/canonical-bid-service';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'sku:override');
    const { id } = await context.params;
    return ok(mapCanonicalSkus(id, principal));
  } catch (error: any) {
    return fail({ code: error.code || 'SKU_MAPPING_FAILED', message: error.message || 'Failed to map SKUs.', details: error.details }, error.status || 500);
  }
}
