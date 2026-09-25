export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { createJobRun, latestJobRun, listProgressEvents } from '@/lib/autobidder/services/job-control-service';
import { assertBidJobAccess } from '@/lib/autobidder/auth/resource-access';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    assertBidJobAccess(id, principal);
    const run = latestJobRun(id);
    return ok({ run, events: run ? listProgressEvents(run.id) : [] });
  } catch (error: any) {
    return fail({ code: error.code || 'RUN_READ_FAILED', message: error.message || 'Failed to read processing run.' }, error.status || 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:upload');
    const { id } = await context.params;
    assertBidJobAccess(id, principal);
    const existing = latestJobRun(id);
    if (existing && !['completed', 'failed', 'canceled'].includes(existing.status)) return ok({ run: existing }, 200);
    return ok({ run: createJobRun(id) }, 201);
  } catch (error: any) {
    return fail({ code: error.code || 'RUN_CREATE_FAILED', message: error.message || 'Failed to create processing run.' }, error.status || 500);
  }
}
