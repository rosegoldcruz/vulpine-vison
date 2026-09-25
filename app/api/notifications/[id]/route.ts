export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { updateNotificationState } from '@/lib/autobidder/services/notification-service';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    const body = (await request.json()) as { action?: 'read' | 'dismiss' };
    if (body.action !== 'read' && body.action !== 'dismiss') {
      return fail({ code: 'VALIDATION_ERROR', message: 'action must be read or dismiss.' }, 400);
    }
    return ok({ notification: updateNotificationState(principal, id, body.action) });
  } catch (error: any) {
    return fail({ code: error.code || 'NOTIFICATION_UPDATE_FAILED', message: error.message || 'Failed to update notification.', details: error.details }, error.status || 500);
  }
}
