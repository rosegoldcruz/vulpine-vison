export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { cancelWaitingFile, listFileQueue } from '@/lib/autobidder/services/file-queue-service';
import { assertBidJobAccess } from '@/lib/autobidder/auth/resource-access';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    assertBidJobAccess(id, principal);
    return ok({ items: listFileQueue(id) });
  } catch (error: any) {
    return fail({ code: error.code || 'FILE_QUEUE_READ_FAILED', message: error.message || 'Failed to read file queue.', details: error.details }, error.status || 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:upload');
    const { id } = await context.params;
    assertBidJobAccess(id, principal);
    const queueItemId = new URL(request.url).searchParams.get('itemId');
    if (!queueItemId) return fail({ code: 'VALIDATION_ERROR', message: 'itemId is required.' }, 400);
    return ok({ item: cancelWaitingFile(id, queueItemId) });
  } catch (error: any) {
    return fail({ code: error.code || 'FILE_QUEUE_CANCEL_FAILED', message: error.message || 'Failed to cancel queue item.', details: error.details }, error.status || 500);
  }
}
