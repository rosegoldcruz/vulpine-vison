export const runtime = 'nodejs';

import { randomUUID } from 'crypto';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { fail, ok } from '@/lib/autobidder/api/response';
import { createLeadHandoffProjectSchema } from '@/lib/autobidder/validation/schemas';
import { LEADS_HANDOFF_AUTH_HEADER } from '@/lib/platform/contracts/leads-handoff-v1';

function integrationKeyValid(req: Request): boolean {
  const configuredKey = process.env.LEADS_INTEGRATION_KEY || '';
  if (!configuredKey) {
    return false;
  }
  const provided = req.headers.get(LEADS_HANDOFF_AUTH_HEADER) || '';
  return provided.length > 0 && provided === configuredKey;
}

export async function POST(req: Request) {
  try {
    if (!process.env.LEADS_INTEGRATION_KEY) {
      return fail(
        {
          code: 'INTEGRATION_NOT_CONFIGURED',
          message: 'LEADS_INTEGRATION_KEY is not configured on this service.',
          details: {},
        },
        503,
      );
    }

    if (!integrationKeyValid(req)) {
      return fail(
        {
          code: 'UNAUTHORIZED',
          message: 'Invalid integration credentials.',
          details: {},
        },
        401,
      );
    }

    const body = await req.json();
    const parsed = createLeadHandoffProjectSchema.safeParse(body);
    if (!parsed.success) {
      return fail(
        {
          code: 'VALIDATION_ERROR',
          message: 'Invalid lead handoff payload.',
          details: { issues: parsed.error.issues },
        },
        400,
      );
    }

    const repo = new ProjectRepository();
    const project = await repo.create(parsed.data.projectName);

    project.leadHandoff = {
      correlationId: parsed.data.correlationId || randomUUID(),
      sourceSystem: parsed.data.sourceSystem,
      leadId: parsed.data.leadId,
      accountName: parsed.data.accountName,
      contactName: parsed.data.contactName,
      contactEmail: parsed.data.contactEmail,
      contactPhone: parsed.data.contactPhone,
      opportunityName: parsed.data.opportunityName,
      notes: parsed.data.notes,
      attachmentRefs: parsed.data.attachmentRefs,
      createdAt: new Date().toISOString(),
    };

    await repo.save(project);

    return ok(
      {
        project,
        handoff: {
          projectId: project.projectId,
          correlationId: project.leadHandoff.correlationId,
          nextAction: 'Upload bid files via POST /api/uploads with x-project-id header.',
        },
      },
      201,
    );
  } catch (error: any) {
    console.error('POST /api/integrations/leads/handoff failed', error);
    return fail({ code: 'INTERNAL_ERROR', message: 'Failed to create handoff project.' }, 500);
  }
}
