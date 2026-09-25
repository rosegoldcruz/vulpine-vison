export const runtime = 'nodejs';

import { asApiServiceError } from '@/lib/autobidder/api/errors';
import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { reviewPlanSheetClassification } from '@/lib/autobidder/services/viewer-evidence-service';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'unit_mix:modify');
    const { id } = await context.params;
    const body = await request.json();
    if (!body?.classification || !body?.note) return fail({ code: 'VALIDATION_ERROR', message: 'classification and note are required.' }, 400);
    return ok({ sheet: reviewPlanSheetClassification(principal, id, body.classification, body.note) });
  } catch (error) {
    const typed = asApiServiceError(error);
    return fail({ code: typed.code, message: typed.message, details: typed.details }, typed.status);
  }
}
