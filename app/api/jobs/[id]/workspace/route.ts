export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { getRunDiagnostics, latestJobRun, listProgressEvents } from '@/lib/autobidder/services/job-control-service';
import { getDatabase } from '@/lib/autobidder/db/database';
import { emailProviderState } from '@/lib/backoffice/providers/email';
import { companyIntelligenceProviderState } from '@/lib/backoffice/providers/company-intelligence';
import { mapsProviderState } from '@/lib/backoffice/providers/maps';
import { getCanonicalBidSnapshot } from '@/lib/autobidder/services/canonical-bid-service';
import { listFileQueue } from '@/lib/autobidder/services/file-queue-service';
import { visionProviderState } from '@/lib/autobidder/services/cabinet-vision-provider';

function count(table: string, jobId: string): number {
  const allowed = new Set(['takeoff_lines', 'sku_mappings', 'estimate_lines', 'qa_results', 'export_artifacts']);
  if (!allowed.has(table)) return 0;
  const key = table === 'sku_mappings' ? 'takeoff_line_id IN (SELECT id FROM takeoff_lines WHERE bid_job_id = ?)' : 'bid_job_id = ?';
  const row = getDatabase().prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${key}`).get(jobId) as { count: number };
  return Number(row.count);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    const job = await new BidJobRepository().get(id);
    if (!job) return fail({ code: 'NOT_FOUND', message: 'Job not found.' }, 404);
    const project = await new ProjectRepository().get(job.projectId, principal.organizationId);
    if (!project) return fail({ code: 'NOT_FOUND', message: 'Job not found.' }, 404);
    const run = latestJobRun(job.id);
    let canonical = null;
    try { canonical = getCanonicalBidSnapshot(job.id, principal); } catch { canonical = null; }
    const planSheets = getDatabase().prepare(`SELECT ps.id, ps.source_document_id AS sourceDocumentId,
      ps.page_number AS pageNumber, ps.sheet_number AS sheetNumber, ps.title, ps.classification,
      ps.classification_confidence AS classificationConfidence, ps.review_required AS reviewRequired,
      ps.render_storage_key AS renderStorageKey, ps.payload_json AS payloadJson, sd.file_name AS sourceFileName
      FROM plan_sheets ps JOIN source_documents sd ON sd.id=ps.source_document_id
      WHERE sd.project_id=? ORDER BY sd.created_at, ps.page_number`).all(job.projectId).map((row) => {
        const item = row as Record<string, unknown>;
        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(String(item.payloadJson || '{}')); } catch { payload = {}; }
        return { ...item, ...payload, reviewRequired: Boolean(item.reviewRequired), payloadJson: undefined };
      });
    const latestManifestRow = getDatabase().prepare(`SELECT manifest_json FROM ingestion_manifests WHERE project_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(job.projectId) as { manifest_json: string } | undefined;
    let ingestionManifest = null;
    try { ingestionManifest = latestManifestRow ? JSON.parse(latestManifestRow.manifest_json) : null; } catch { ingestionManifest = null; }
    return ok({
      project,
      job,
      run,
      diagnostics: run ? getRunDiagnostics(run.id, principal.id) : null,
      progressEvents: run ? listProgressEvents(run.id) : [],
      canonical,
      planSheets,
      ingestionManifest,
      fileQueue: listFileQueue(job.id),
      canonicalCounts: {
        takeoff: count('takeoff_lines', job.id),
        mappings: count('sku_mappings', job.id),
        estimateLines: count('estimate_lines', job.id),
        qaRuns: count('qa_results', job.id),
        exports: count('export_artifacts', job.id),
      },
      integrations: {
        email: emailProviderState({
          provider: process.env.EMAIL_PROVIDER,
          apiKey: process.env.EMAIL_API_KEY,
          fromAddress: process.env.EMAIL_FROM,
        }),
        companyIntelligence: companyIntelligenceProviderState({
          provider: process.env.COMPANY_INTELLIGENCE_PROVIDER,
          apiKey: process.env.COMPANY_INTELLIGENCE_API_KEY,
        }),
        maps: mapsProviderState({ provider: process.env.MAPS_PROVIDER, apiKey: process.env.MAPS_API_KEY }),
        cabinetVision: visionProviderState(),
      },
    });
  } catch (error: any) {
    return fail({ code: error.code || 'WORKSPACE_READ_FAILED', message: error.message || 'Failed to load workspace.' }, error.status || 500);
  }
}
