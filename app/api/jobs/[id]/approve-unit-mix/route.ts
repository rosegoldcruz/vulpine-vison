export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { asApiServiceError } from '@/lib/autobidder/api/errors';
import { approveUnitMixSchema } from '@/lib/autobidder/validation/schemas';
import { approveUnitMix } from '@/lib/autobidder/services/workflow-service';

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const parsed = approveUnitMixSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return fail(
        {
          code: 'VALIDATION_ERROR',
          message: 'Invalid unit mix approval payload.',
          details: { issues: parsed.error.issues },
        },
        400,
      );
    }
    const job = await approveUnitMix(id, parsed.data.approvedBy);
    return ok({ job });
  } catch (error: any) {
    const typed = asApiServiceError(error);
    console.error('POST /api/jobs/[id]/approve-unit-mix failed', typed);
    return fail({ code: typed.code, message: typed.message || 'Failed to approve unit mix.', details: typed.details }, typed.status);
  }
}
