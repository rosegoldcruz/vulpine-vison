export const runtime = 'nodejs';

import { asApiServiceError } from '@/lib/autobidder/api/errors';
import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { approveCanonicalExport } from '@/lib/autobidder/services/canonical-bid-service';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'export:create');
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    return ok(approveCanonicalExport(id, typeof body.note === 'string' ? body.note : '', principal), 201);
  } catch (error) {
    const typed = asApiServiceError(error);
    return fail({ code: typed.code, message: typed.message, details: typed.details }, typed.status);
  }
}
