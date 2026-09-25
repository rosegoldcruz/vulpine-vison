export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { createOutreachDraft, listProjectOutreach, sendOutreach, syncApprovedDealFromBid } from '@/lib/backoffice/service';
import { configuredEmailTransport, emailConnectionState } from '@/lib/backoffice/provider-service';
import { assertProjectAccess } from '@/lib/autobidder/auth/resource-access';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    assertProjectAccess(id, principal);
    return ok({ provider: emailConnectionState(id), outreach: listProjectOutreach(id) });
  } catch (error: any) {
    return fail({ code: error.code || 'OUTREACH_READ_FAILED', message: error.message || 'Failed to read outreach.' }, error.status || 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    const { id } = await context.params;
    assertProjectAccess(id, principal);
    const body = await request.json();
    if (body.action === 'prepare') {
      requirePermission(principal, 'pricing:change');
      const deal = syncApprovedDealFromBid({ projectId: id, jobId: body.jobId, companyName: body.companyName }, principal);
      const outreach = createOutreachDraft(id, body, principal.id);
      return ok({ deal, outreach }, 201);
    }
    if (body.action === 'draft') {
      requirePermission(principal, 'project:upload');
      return ok({ outreach: createOutreachDraft(id, body, principal.id) }, 201);
    }
    if (body.action === 'send') {
      requirePermission(principal, 'outreach:send');
      const result = await sendOutreach({
        outreachId: body.outreachId,
        projectId: id,
        confirmation: body.confirmation,
        actorId: principal.id,
        transport: configuredEmailTransport(),
      });
      return ok(result);
    }
    return fail({ code: 'VALIDATION_FAILED', message: 'action must be prepare, draft, or send.' }, 400);
  } catch (error: any) {
    return fail({ code: error.code || 'OUTREACH_ACTION_FAILED', message: error.message || 'Failed to perform outreach action.' }, error.status || 500);
  }
}
