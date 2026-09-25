export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { listDeals, saveDeal } from '@/lib/backoffice/service';
import { assertProjectAccess } from '@/lib/autobidder/auth/resource-access';

export async function GET(request: Request) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    return ok({ deals: listDeals(principal.organizationId) });
  } catch (error: any) {
    return fail({ code: error.code || 'DEALS_READ_FAILED', message: error.message || 'Failed to read deals.' }, error.status || 500);
  }
}

export async function POST(request: Request) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'pricing:change');
    const body = await request.json();
    assertProjectAccess(body.projectId, principal);
    return ok({ deal: saveDeal(body, principal.id) }, 201);
  } catch (error: any) {
    return fail({ code: error.code || 'DEAL_SAVE_FAILED', message: error.message || 'Failed to save deal.' }, error.status || 500);
  }
}
