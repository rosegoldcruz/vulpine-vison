export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { listNotifications } from '@/lib/autobidder/services/notification-service';

function booleanParameter(value: string | null): boolean {
  return value === '1' || value === 'true';
}

export async function GET(request: Request) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const parameters = new URL(request.url).searchParams;
    return ok({
      notifications: listNotifications(principal, {
        unreadOnly: booleanParameter(parameters.get('unreadOnly')),
        includeDismissed: booleanParameter(parameters.get('includeDismissed')),
        projectId: parameters.get('projectId') || undefined,
      }),
    });
  } catch (error: any) {
    return fail({ code: error.code || 'NOTIFICATIONS_READ_FAILED', message: error.message || 'Failed to read notifications.', details: error.details }, error.status || 500);
  }
}
