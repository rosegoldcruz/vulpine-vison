export const runtime = 'nodejs';

import { z } from 'zod';
import { asApiServiceError } from '@/lib/autobidder/api/errors';
import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { optimizePromptForProject } from '@/lib/autobidder/services/project-assistant-service';

const requestSchema = z.object({
  jobId: z.string().min(1),
  prompt: z.string().min(1).max(20000),
  context: z.object({
    sheet: z.string().max(120).optional(), unitType: z.string().max(120).optional(),
    cabinetTerminology: z.array(z.string().max(120)).max(50).optional(),
    requestedEvidence: z.array(z.string().max(240)).max(50).optional(),
    desiredOutputStructure: z.string().max(1000).optional(),
  }).optional(),
});

export async function POST(request: Request) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail({ code: 'VALIDATION_ERROR', message: 'Invalid prompt optimization request.', details: { issues: parsed.error.issues } }, 400);
    return ok({ revision: await optimizePromptForProject({
      jobId: parsed.data.jobId!,
      prompt: parsed.data.prompt!,
      context: parsed.data.context,
    }, principal) });
  } catch (error) {
    const typed = asApiServiceError(error);
    return fail({ code: typed.code, message: typed.message, details: typed.details }, typed.status);
  }
}
