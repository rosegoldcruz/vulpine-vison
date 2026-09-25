export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { captureEvidenceSnippet, listEvidenceSnippets } from '@/lib/autobidder/services/viewer-evidence-service';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    const planSheetId = new URL(request.url).searchParams.get('planSheetId') || undefined;
    return ok({ snippets: listEvidenceSnippets(principal, id, planSheetId) });
  } catch (error: any) {
    return fail({ code: error.code || 'SNIPPETS_READ_FAILED', message: error.message || 'Failed to read evidence snippets.', details: error.details }, error.status || 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'unit_mix:modify');
    const { id } = await context.params;
    const body = (await request.json()) as {
      planSheetId?: string;
      region?: unknown;
      scale?: number;
      annotations?: unknown;
      title?: string;
      storageKey?: string;
      takeoffLineId?: string;
      qaIssueId?: string;
    };
    if (!body.planSheetId || !body.title) return fail({ code: 'VALIDATION_ERROR', message: 'planSheetId and title are required.' }, 400);
    return ok(
      {
        snippet: await captureEvidenceSnippet(principal, {
          projectId: id,
          planSheetId: body.planSheetId,
          region: body.region,
          scale: body.scale,
          annotations: body.annotations,
          title: body.title,
          storageKey: body.storageKey,
          takeoffLineId: body.takeoffLineId,
          qaIssueId: body.qaIssueId,
        }),
      },
      201,
    );
  } catch (error: any) {
    return fail({ code: error.code || 'SNIPPET_CREATE_FAILED', message: error.message || 'Failed to create evidence snippet.', details: error.details }, error.status || 500);
  }
}
