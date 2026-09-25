export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { getProcessingSettings, saveProcessingSettings } from '@/lib/autobidder/services/job-control-service';

export async function GET(request: Request) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    return ok({ settings: getProcessingSettings(principal.id) });
  } catch (error: any) {
    return fail({ code: error.code || 'SETTINGS_READ_FAILED', message: error.message || 'Failed to read settings.' }, error.status || 500);
  }
}

export async function PUT(request: Request) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'settings:admin');
    return ok({ settings: saveProcessingSettings(principal.id, await request.json()) });
  } catch (error: any) {
    return fail({ code: error.code || 'SETTINGS_WRITE_FAILED', message: error.message || 'Failed to save settings.' }, error.status || 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'settings:admin');
    return ok({ settings: saveProcessingSettings(principal.id, {}) });
  } catch (error: any) {
    return fail({ code: error.code || 'SETTINGS_RESET_FAILED', message: error.message || 'Failed to restore defaults.' }, error.status || 500);
  }
}

