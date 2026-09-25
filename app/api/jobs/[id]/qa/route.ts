export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { runCanonicalQa } from '@/lib/autobidder/services/canonical-bid-service';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'pricing:change');
    const { id } = await context.params;
    return ok(runCanonicalQa(id, principal));
  } catch (error: any) {
    return fail({ code: error.code || 'QA_RUN_FAILED', message: error.message || 'Failed to run QA.', details: error.details }, error.status || 500);
  }
}
