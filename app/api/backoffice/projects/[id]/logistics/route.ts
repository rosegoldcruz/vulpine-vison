export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { mapsConnectionState, refreshMapRoute } from '@/lib/backoffice/provider-service';
import { projectLogistics, saveFreightQuote } from '@/lib/backoffice/service';
import { assertProjectAccess } from '@/lib/autobidder/auth/resource-access';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    assertProjectAccess(id, principal);
    return ok({ provider: mapsConnectionState(id), ...projectLogistics(id) });
  } catch (error: any) {
    return fail({ code: error.code || 'LOGISTICS_READ_FAILED', message: error.message || 'Failed to read logistics grounding.' }, error.status || 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    const { id } = await context.params;
    assertProjectAccess(id, principal);
    const body = await request.json();
    if (body.action === 'refresh_map') {
      requirePermission(principal, 'settings:admin');
      await refreshMapRoute({ projectId: id, originLabel: body.originLabel, destinationLabel: body.destinationLabel }, principal.id);
      return ok({ provider: mapsConnectionState(id), ...projectLogistics(id) }, 201);
    }
    if (body.action === 'freight_quote') {
      requirePermission(principal, 'pricing:change');
      const quote = saveFreightQuote(id, body, principal.id);
      return ok({ quote, logistics: projectLogistics(id) }, 201);
    }
    return fail({ code: 'VALIDATION_FAILED', message: 'action must be refresh_map or freight_quote.' }, 400);
  } catch (error: any) {
    return fail({ code: error.code || 'LOGISTICS_ACTION_FAILED', message: error.message || 'Failed to update logistics grounding.' }, error.status || 500);
  }
}
