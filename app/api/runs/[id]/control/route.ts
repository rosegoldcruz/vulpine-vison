export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { controlJobRun, removeJobRun } from '@/lib/autobidder/services/job-control-service';
import { assertRunAccess } from '@/lib/autobidder/auth/resource-access';

const actions = new Set(['pause', 'resume', 'cancel', 'retry']);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:upload');
    const { id } = await context.params;
    assertRunAccess(id, principal);
    const body = (await request.json()) as { action?: 'pause' | 'resume' | 'cancel' | 'retry'; reason?: string };
    if (!body.action || !actions.has(body.action)) return fail({ code: 'VALIDATION_ERROR', message: 'Invalid control action.' }, 400);
    return ok({ run: controlJobRun(id, body.action, body.reason) });
  } catch (error: any) {
    return fail({ code: error.code || 'CONTROL_FAILED', message: error.message || 'Processing control failed.', details: error.details }, error.status || 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:upload');
    const { id } = await context.params;
    assertRunAccess(id, principal);
    return ok({ removal: removeJobRun(id) });
  } catch (error: any) {
    return fail({ code: error.code || 'RUN_REMOVE_FAILED', message: error.message || 'Run removal failed.', details: error.details }, error.status || 500);
  }
}
