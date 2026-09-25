export const runtime = 'nodejs';

import { z } from 'zod';
import { asApiServiceError } from '@/lib/autobidder/api/errors';
import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { queryProjectAssistant } from '@/lib/autobidder/services/project-assistant-service';
import type { ProjectAssistantToolRequest } from '@/lib/autobidder/assistant';

const requestSchema = z.discriminatedUnion('tool', [
  z.object({ jobId: z.string().min(1), tool: z.literal('workflow_status'), args: z.object({}).optional() }),
  z.object({ jobId: z.string().min(1), tool: z.literal('unresolved_cabinets'), args: z.object({ unitType: z.string().optional() }).optional() }),
  z.object({ jobId: z.string().min(1), tool: z.literal('mapping_explanation'), args: z.object({ cabinetFamily: z.string().optional(), sku: z.string().optional() }) }),
  z.object({ jobId: z.string().min(1), tool: z.literal('workbook_rows'), args: z.object({ sku: z.string().optional(), usedOnly: z.boolean().optional() }).optional() }),
  z.object({ jobId: z.string().min(1), tool: z.literal('qa_blockers'), args: z.object({}).optional() }),
  z.object({ jobId: z.string().min(1), tool: z.literal('remaining_actions'), args: z.object({}).optional() }),
  z.object({ jobId: z.string().min(1), tool: z.literal('audit_summary'), args: z.object({ limit: z.number().int().min(1).max(100).optional() }).optional() }),
]);

export async function POST(request: Request) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail({ code: 'VALIDATION_ERROR', message: 'Invalid assistant query.', details: { issues: parsed.error.issues } }, 400);
    const { jobId, ...query } = parsed.data;
    return ok({ result: await queryProjectAssistant(jobId!, query as ProjectAssistantToolRequest, principal) });
  } catch (error) {
    const typed = asApiServiceError(error);
    return fail({ code: typed.code, message: typed.message, details: typed.details }, typed.status);
  }
}
