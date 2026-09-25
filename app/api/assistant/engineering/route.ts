export const runtime = 'nodejs';

import { z } from 'zod';
import { asApiServiceError } from '@/lib/autobidder/api/errors';
import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { inspectEngineeringRuntime } from '@/lib/autobidder/services/engineering-assistant-service';

const schema = z.object({ question: z.string().min(1).max(2000) });

export async function POST(request: Request) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'engineering:inspect');
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail({ code: 'VALIDATION_ERROR', message: 'A concrete engineering question is required.', details: { issues: parsed.error.issues } }, 400);
    return ok({ inspection: await inspectEngineeringRuntime(parsed.data.question) });
  } catch (error) {
    const typed = asApiServiceError(error);
    return fail({ code: typed.code, message: typed.message, details: typed.details }, typed.status);
  }
}
