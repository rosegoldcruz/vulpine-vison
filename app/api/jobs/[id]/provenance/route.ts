export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { getCanonicalProvenance } from '@/lib/autobidder/services/canonical-bid-service';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    return ok({ traces: getCanonicalProvenance(id, principal) });
  } catch (error: any) {
    return fail({ code: error.code || 'PROVENANCE_READ_FAILED', message: error.message || 'Failed to read provenance.', details: error.details }, error.status || 500);
  }
}
