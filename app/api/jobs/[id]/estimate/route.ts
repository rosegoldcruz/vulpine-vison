export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { compileCanonicalEstimate } from '@/lib/autobidder/services/canonical-bid-service';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'pricing:change');
    const { id } = await context.params;
    return ok(compileCanonicalEstimate(id, principal));
  } catch (error: any) {
    return fail({ code: error.code || 'ESTIMATE_COMPILE_FAILED', message: error.message || 'Failed to compile estimate.', details: error.details }, error.status || 500);
  }
}
