export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { listProgressEvents, recordProgress } from '@/lib/autobidder/services/job-control-service';
import type { ExecutionStatus } from '@/types/canonical';
import { assertRunAccess } from '@/lib/autobidder/auth/resource-access';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    assertRunAccess(id, principal);
    return ok({ events: listProgressEvents(id) });
  } catch (error: any) {
    return fail({ code: error.code || 'PROGRESS_READ_FAILED', message: error.message || 'Failed to read progress.' }, error.status || 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:upload');
    const { id } = await context.params;
    assertRunAccess(id, principal);
    const body = (await request.json()) as { stage?: ExecutionStatus; unit?: string; completed?: number; total?: number; message?: string };
    if (!body.stage || !body.unit || !Number.isInteger(body.completed)) {
      return fail({ code: 'VALIDATION_ERROR', message: 'stage, unit, and integer completed are required.' }, 400);
    }
    return ok({ event: recordProgress({ runId: id, stage: body.stage, unit: body.unit, completed: body.completed!, total: body.total, message: body.message }) }, 201);
  } catch (error: any) {
    return fail({ code: error.code || 'PROGRESS_WRITE_FAILED', message: error.message || 'Failed to write progress.' }, error.status || 500);
  }
}
