export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { listOperatingEvents, recordOperatingEvent } from '@/lib/backoffice/service';
import { assertProjectAccess } from '@/lib/autobidder/auth/resource-access';

export async function GET(request: Request) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    return ok({ events: listOperatingEvents(principal.organizationId) });
  } catch (error: any) {
    return fail({ code: error.code || 'EVENTS_READ_FAILED', message: error.message || 'Failed to read operating events.' }, error.status || 500);
  }
}

export async function POST(request: Request) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'settings:admin');
    const body = await request.json();
    if (!body.projectId) return fail({ code: 'VALIDATION_FAILED', message: 'projectId is required for tenant-scoped events.' }, 400);
    assertProjectAccess(body.projectId, principal);
    return ok({ event: recordOperatingEvent(body, principal.id) }, 201);
  } catch (error: any) {
    return fail({ code: error.code || 'EVENT_RECORD_FAILED', message: error.message || 'Failed to record operating event.' }, error.status || 500);
  }
}
