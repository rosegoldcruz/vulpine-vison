export const runtime = 'nodejs';

import { z } from 'zod';
import { fail, ok } from '@/lib/autobidder/api/response';
import { asApiServiceError } from '@/lib/autobidder/api/errors';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { createExportArtifact, listExportArtifacts } from '@/lib/autobidder/services/export-artifact-service';
import { markCanonicalExported } from '@/lib/autobidder/services/canonical-bid-service';
import { assertBidJobAccess } from '@/lib/autobidder/auth/resource-access';

const requestSchema = z.object({
  format: z.enum(['json', 'csv', 'xlsx', 'review_pdf']),
  audience: z.enum(['internal_review', 'customer']).default('internal_review'),
});

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(req);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    assertBidJobAccess(id, principal);
    return ok({ artifacts: listExportArtifacts(id) });
  } catch (error) {
    const typed = asApiServiceError(error);
    return fail({ code: typed.code, message: typed.message, details: typed.details }, typed.status);
  }
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(req);
    requirePermission(principal, 'export:create');
    const parsed = requestSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid export request.', details: { issues: parsed.error.issues } }, 400);
    }
    const { id } = await context.params;
    assertBidJobAccess(id, principal);
    const artifact = await createExportArtifact(id, principal.id, parsed.data.format, parsed.data.audience);
    if (parsed.data.audience === 'customer') markCanonicalExported(id, artifact.id, principal);
    return ok({ artifact, downloadUrl: `/api/exports/${artifact.id}` }, 201);
  } catch (error) {
    const typed = asApiServiceError(error);
    return fail({ code: typed.code, message: typed.message, details: typed.details }, typed.status);
  }
}
