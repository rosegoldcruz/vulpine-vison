export const runtime = 'nodejs';

import { asApiServiceError } from '@/lib/autobidder/api/errors';
import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { getRunDiagnostics } from '@/lib/autobidder/services/job-control-service';
import { assertRunAccess } from '@/lib/autobidder/auth/resource-access';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    assertRunAccess(id, principal);
    return ok({ diagnostics: getRunDiagnostics(id, principal.id) });
  } catch (error) {
    const typed = asApiServiceError(error);
    return fail({ code: typed.code, message: typed.message, details: typed.details }, typed.status);
  }
}
