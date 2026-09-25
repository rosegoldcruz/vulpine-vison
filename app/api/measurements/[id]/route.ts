export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { deleteMeasurement } from '@/lib/autobidder/services/viewer-evidence-service';

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'unit_mix:modify');
    const { id } = await context.params;
    deleteMeasurement(principal, id);
    return ok({ deleted: true, measurementId: id });
  } catch (error: any) {
    return fail({ code: error.code || 'MEASUREMENT_DELETE_FAILED', message: error.message || 'Failed to delete measurement.', details: error.details }, error.status || 500);
  }
}
