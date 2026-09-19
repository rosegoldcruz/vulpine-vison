export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { asApiServiceError } from '@/lib/autobidder/api/errors';
import { resolveMappingSchema } from '@/lib/autobidder/validation/schemas';
import { applyManualSkuResolution } from '@/lib/autobidder/services/workflow-service';

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const parsed = resolveMappingSchema.safeParse(body);
    if (!parsed.success) {
      return fail(
        {
          code: 'VALIDATION_ERROR',
          message: 'Invalid manual resolution payload.',
          details: { issues: parsed.error.issues },
        },
        400,
      );
    }
    const job = await applyManualSkuResolution(id, {
      cabinetFamily: parsed.data.cabinetFamily,
      mappedSku: parsed.data.mappedSku,
      unitCostCents: parsed.data.unitCostCents,
      overrideReason: parsed.data.overrideReason,
      overrideUser: parsed.data.overrideUser,
    });
    return ok({ job });
  } catch (error: any) {
    const typed = asApiServiceError(error);
    console.error('POST /api/jobs/[id]/resolve failed', typed);
    return fail(
      {
        code: typed.code,
        message: typed.message || 'Failed to apply manual resolution.',
        details: typed.details,
      },
      typed.status,
    );
  }
}
