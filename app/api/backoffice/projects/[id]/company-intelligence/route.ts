export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { companyIntelligenceConnectionState, enrichCompany } from '@/lib/backoffice/provider-service';
import { listProviderSnapshots } from '@/lib/backoffice/service';
import { assertProjectAccess } from '@/lib/autobidder/auth/resource-access';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    assertProjectAccess(id, principal);
    return ok({ provider: companyIntelligenceConnectionState(id), snapshots: listProviderSnapshots(id, 'company_intelligence') });
  } catch (error: any) {
    return fail({ code: error.code || 'INTELLIGENCE_READ_FAILED', message: error.message || 'Failed to read company intelligence.' }, error.status || 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'settings:admin');
    const { id } = await context.params;
    assertProjectAccess(id, principal);
    return ok({ snapshot: await enrichCompany({ ...(await request.json()), projectId: id }, principal.id) }, 201);
  } catch (error: any) {
    return fail({ code: error.code || 'INTELLIGENCE_REFRESH_FAILED', message: error.message || 'Failed to refresh company intelligence.' }, error.status || 500);
  }
}
