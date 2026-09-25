import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import { getDatabase } from '@/lib/autobidder/db/database';
import {
  buildExportSnapshot,
  generateReviewPdf,
  serializeExportCsv,
  serializeExportJson,
  serializeExportXlsx,
  type BuildExportSnapshotInput,
  type ExportAudience,
  type ExportSnapshotError,
} from '@/lib/autobidder/exports';
import { readBinary, writeBinary } from '@/lib/autobidder/storage/file-store';
import type {
  Approval, BidJob, CabinetInstance, CatalogSku, EstimateLine, ExportArtifact, PlanSheet, Project,
  QAResult, SkuMapping, SourceDocument, TakeoffLine, UnitMixEntry, UnitType, VisionEvidence, WorkflowState,
} from '@/types/canonical';
import { ApiServiceError } from '@/lib/autobidder/api/errors';

type ExportFormat = ExportArtifact['format'];
type Row = Record<string, unknown>;

const workflowStates = new Set<WorkflowState>([
  'project_created', 'source_files_ingested', 'workbook_ingested', 'cabinet_pages_classified',
  'cabinet_pages_extracted', 'cabinet_takeoff_draft', 'unit_mix_required', 'unit_mix_verified',
  'sku_mapping_required', 'pricing_mapping_required', 'cabinet_bid_review_required', 'qa_failed',
  'cabinet_bid_safe_to_send', 'exported',
]);

const formatConfig: Record<ExportFormat, { extension: string; mimeType: string }> = {
  json: { extension: 'json', mimeType: 'application/json' },
  csv: { extension: 'csv', mimeType: 'text/csv; charset=utf-8' },
  xlsx: { extension: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  review_pdf: { extension: 'pdf', mimeType: 'application/pdf' },
};

function text(value: unknown): string { return String(value ?? ''); }
function optionalText(value: unknown): string | undefined { return value === null || value === undefined || value === '' ? undefined : String(value); }
function number(value: unknown): number { return Number(value); }
function optionalNumber(value: unknown): number | undefined { return value === null || value === undefined ? undefined : Number(value); }
function boolean(value: unknown): boolean { return Number(value) === 1 || value === true; }
function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
function rows(sql: string, ...params: SQLInputValue[]): Row[] {
  return getDatabase().prepare(sql).all(...params) as Row[];
}

function loadProject(row: Row): Project {
  const payload = json<Record<string, unknown>>(row.payload_json, {});
  return {
    id: text(row.id), organizationId: text(row.organization_id), name: text(row.name),
    customerName: optionalText(payload.customerName), projectAddress: optionalText(payload.projectAddress),
    currency: text(row.currency), createdBy: optionalText(payload.createdBy) || 'system',
    createdAt: text(row.created_at), updatedAt: text(row.updated_at), version: number(row.version),
  };
}

function loadJob(row: Row): BidJob {
  const state = text(row.workflow_state) as WorkflowState;
  if (!workflowStates.has(state)) {
    throw new ApiServiceError('CANONICAL_JOB_REQUIRED', 'This job has not entered the canonical cabinet workflow.', 409, { state });
  }
  const payload = json<Partial<BidJob>>(row.payload_json, {});
  return {
    id: text(row.id), projectId: text(row.project_id), state, stateHistory: payload.stateHistory || [],
    unresolvedItemIds: payload.unresolvedItemIds || [], approvalIds: payload.approvalIds || [],
    artifactIds: payload.artifactIds || [], currentRunId: payload.currentRunId, createdAt: text(row.created_at),
    updatedAt: text(row.updated_at), version: number(row.version),
  };
}

function loadSnapshotInput(jobId: string, actorId: string, audience: ExportAudience, snapshotId: string): BuildExportSnapshotInput {
  const db = getDatabase();
  const jobRow = db.prepare('SELECT * FROM bid_jobs WHERE id = ?').get(jobId) as Row | undefined;
  if (!jobRow) throw new ApiServiceError('JOB_NOT_FOUND', 'Job not found.', 404, { jobId });
  const projectRow = db.prepare('SELECT * FROM projects WHERE id = ?').get(text(jobRow.project_id)) as Row | undefined;
  if (!projectRow) throw new ApiServiceError('PROJECT_NOT_FOUND', 'Project not found.', 404, { projectId: jobRow.project_id });
  const project = loadProject(projectRow);
  const job = loadJob(jobRow);
  const qaRow = db.prepare('SELECT * FROM qa_results WHERE bid_job_id = ? ORDER BY executed_at DESC LIMIT 1').get(jobId) as Row | undefined;
  if (!qaRow) throw new ApiServiceError('QA_RESULT_REQUIRED', 'Run Cabinet QA before exporting.', 409, { jobId });

  const sourceDocuments: SourceDocument[] = rows('SELECT * FROM source_documents WHERE project_id = ? ORDER BY created_at, id', project.id).map((row) => ({
    id: text(row.id), projectId: text(row.project_id), originalPath: text(row.original_path), storageKey: text(row.storage_key),
    fileName: text(row.file_name), mimeType: text(row.mime_type), byteSize: number(row.byte_size), sha256: text(row.sha256),
    ingestionOutcome: text(row.outcome) as SourceDocument['ingestionOutcome'], duplicateOfId: optionalText(row.duplicate_of_id), createdAt: text(row.created_at),
  }));
  const documentIds = sourceDocuments.map((item) => item.id);
  const planSheets: PlanSheet[] = (documentIds.length ? rows(`SELECT * FROM plan_sheets WHERE source_document_id IN (${documentIds.map(() => '?').join(',')}) ORDER BY source_document_id, page_number`, ...documentIds) : []).map((row) => {
    const payload = json<Partial<PlanSheet>>(row.payload_json, {});
    return {
      id: text(row.id), sourceDocumentId: text(row.source_document_id), pageNumber: number(row.page_number), sheetNumber: optionalText(row.sheet_number),
      title: optionalText(row.title), widthPoints: payload.widthPoints, heightPoints: payload.heightPoints, rotation: payload.rotation || 0,
      renderStorageKey: optionalText(row.render_storage_key), thumbnailStorageKey: optionalText(row.thumbnail_storage_key), renderDpi: payload.renderDpi,
      renderWidthPx: payload.renderWidthPx, renderHeightPx: payload.renderHeightPx, classification: optionalText(row.classification),
      classificationConfidence: optionalNumber(row.classification_confidence), classificationEvidence: payload.classificationEvidence,
      reviewRequired: boolean(row.review_required),
    };
  });
  const evidence: VisionEvidence[] = rows('SELECT * FROM vision_evidence WHERE project_id = ? ORDER BY created_at, id', project.id).map((row) => {
    const payload = json<Partial<VisionEvidence>>(row.payload_json, {});
    return {
      id: text(row.id), projectId: text(row.project_id), planSheetId: text(row.plan_sheet_id), kind: text(row.kind) as VisionEvidence['kind'],
      region: json(row.region_json, undefined), text: optionalText(row.text_content), confidence: optionalNumber(row.confidence),
      extractionProvider: payload.extractionProvider, extractionModel: payload.extractionModel, createdAt: text(row.created_at),
    };
  });
  for (const row of rows('SELECT * FROM measurements WHERE project_id = ? ORDER BY created_at, id', project.id)) {
    const geometry = json<{ points?: Array<{ x: number; y: number }> }>(row.geometry_json, {});
    const points = geometry.points || [];
    const xs = points.map((point) => point.x).filter(Number.isFinite);
    const ys = points.map((point) => point.y).filter(Number.isFinite);
    const x = xs.length ? Math.min(...xs) : 0;
    const y = ys.length ? Math.min(...ys) : 0;
    const maxX = xs.length ? Math.max(...xs) : x;
    const maxY = ys.length ? Math.max(...ys) : y;
    evidence.push({
      id: text(row.id), projectId: project.id, planSheetId: text(row.plan_sheet_id), kind: 'measurement',
      region: { x, y, width: Math.max(0.000001, maxX - x), height: Math.max(0.000001, maxY - y) },
      text: `${text(row.kind)}: ${row.value == null ? 'unresolved' : number(row.value)} ${text(row.unit)}`,
      extractionProvider: 'architectural-measurement-studio', extractionModel: 'calibrated-geometry/v1', createdAt: text(row.created_at),
    });
  }
  for (const row of rows('SELECT * FROM evidence_snippets WHERE project_id = ? ORDER BY created_at, id', project.id)) {
    evidence.push({
      id: text(row.id), projectId: project.id, planSheetId: text(row.plan_sheet_id), kind: 'snippet',
      region: json(row.region_json, undefined), text: `${text(row.title)}${row.annotations_json ? ` — ${text(row.annotations_json)}` : ''}`,
      extractionProvider: 'human-review', extractionModel: 'annotated-snippet/v1', createdAt: text(row.created_at),
    });
  }
  const unitTypes: UnitType[] = rows('SELECT * FROM unit_types WHERE project_id = ? ORDER BY code', project.id).map((row) => ({
    id: text(row.id), projectId: text(row.project_id), code: text(row.code), name: text(row.name),
    accessibility: text(row.accessibility) as UnitType['accessibility'], aliases: json<string[]>(row.aliases_json, []),
  }));
  const unitMixEntries: UnitMixEntry[] = rows('SELECT * FROM unit_mix_entries WHERE project_id = ? ORDER BY id', project.id).map((row) => ({
    id: text(row.id), projectId: text(row.project_id), unitTypeId: text(row.unit_type_id), extractedCount: number(row.extracted_count),
    verifiedCount: optionalNumber(row.verified_count), status: text(row.status) as UnitMixEntry['status'], discrepancy: optionalText(row.discrepancy),
    evidenceIds: json<string[]>(row.evidence_ids_json, []), approvedBy: optionalText(row.approved_by), approvedAt: optionalText(row.approved_at),
  }));
  const cabinetInstances: CabinetInstance[] = rows('SELECT * FROM cabinet_instances WHERE project_id = ? ORDER BY id', project.id).map((row) => {
    const payload = json<Partial<CabinetInstance>>(row.payload_json, {});
    return {
      ...payload, id: text(row.id), projectId: text(row.project_id), unitTypeId: text(row.unit_type_id), room: text(row.room),
      category: text(row.category) as CabinetInstance['category'], quantityPerUnit: number(row.quantity_per_unit),
      evidenceIds: json<string[]>(row.evidence_ids_json, []), status: text(row.status) as CabinetInstance['status'], ada: payload.ada || false,
    };
  });
  const takeoffLines: TakeoffLine[] = rows('SELECT * FROM takeoff_lines WHERE bid_job_id = ? ORDER BY id', jobId).map((row) => ({
    id: text(row.id), bidJobId: text(row.bid_job_id), cabinetInstanceId: text(row.cabinet_instance_id), unitTypeId: text(row.unit_type_id),
    quantityPerUnit: number(row.quantity_per_unit), status: text(row.status) as TakeoffLine['status'], evidenceIds: json<string[]>(row.evidence_ids_json, []),
  }));
  const workbookIds = rows('SELECT id FROM catalog_workbooks WHERE project_id = ?', project.id).map((row) => text(row.id));
  const catalogSkus: CatalogSku[] = (workbookIds.length ? rows(`SELECT s.*, w.file_name AS source_workbook FROM catalog_skus s JOIN catalog_workbooks w ON w.id=s.workbook_id WHERE s.workbook_id IN (${workbookIds.map(() => '?').join(',')}) ORDER BY s.id`, ...workbookIds) : []).map((row) => {
    const payload = json<Partial<CatalogSku>>(row.payload_json, {});
    return {
      ...payload, id: text(row.id), workbookId: text(row.workbook_id), sourceWorkbook: text(row.source_workbook), sourceWorksheet: text(row.source_worksheet),
      sourceRow: number(row.source_row), rawValues: json<Record<string, unknown>>(row.raw_values_json, {}), sku: text(row.sku), cabinetCode: text(row.cabinet_code),
      modifiers: payload.modifiers || [], unitCostCents: optionalNumber(row.unit_cost_cents), sellPriceCents: optionalNumber(row.sell_price_cents), active: boolean(row.active),
    };
  });
  const takeoffIds = takeoffLines.map((item) => item.id);
  const skuMappings: SkuMapping[] = (takeoffIds.length ? rows(`SELECT * FROM sku_mappings WHERE takeoff_line_id IN (${takeoffIds.map(() => '?').join(',')}) ORDER BY id`, ...takeoffIds) : []).map((row) => ({
    id: text(row.id), takeoffLineId: text(row.takeoff_line_id), catalogSkuId: optionalText(row.catalog_sku_id), outcome: text(row.outcome) as SkuMapping['outcome'],
    matchMethod: text(row.match_method), confidence: optionalNumber(row.confidence), normalizationRuleId: optionalText(row.normalization_rule_id),
    approvedBy: optionalText(row.approved_by), approvedAt: optionalText(row.approved_at), resolutionNote: optionalText(row.resolution_note),
  }));
  const estimateLines: EstimateLine[] = rows('SELECT * FROM estimate_lines WHERE bid_job_id = ? ORDER BY id', jobId).map((row) => ({
    id: text(row.id), bidJobId: text(row.bid_job_id), mappingId: optionalText(row.mapping_id), unitMixEntryId: optionalText(row.unit_mix_entry_id),
    category: text(row.category) as EstimateLine['category'], description: text(row.description), projectQuantity: number(row.project_quantity),
    unitCostCents: number(row.unit_cost_cents), extendedCostCents: number(row.extended_cost_cents), currency: text(row.currency),
    calculationVersion: text(row.calculation_version), evidenceIds: json<string[]>(row.evidence_ids_json, []),
  }));
  const qaResult: QAResult = {
    id: text(qaRow.id), bidJobId: text(qaRow.bid_job_id), safeToSend: boolean(qaRow.safe_to_send), issues: json(qaRow.issues_json, []),
    warnings: json(qaRow.warnings_json, []), informationalNotes: json(qaRow.informational_notes_json, []),
    reconciliation: json(qaRow.reconciliation_json, {}), reviewerRequirements: json(qaRow.reviewer_requirements_json, []),
    calculationVersion: text(qaRow.calculation_version), executedAt: text(qaRow.executed_at), executedBy: 'cabinet_qa_agent',
  };
  const approvals: Approval[] = rows('SELECT * FROM approvals WHERE bid_job_id = ? ORDER BY occurred_at, id', jobId).map((row) => ({
    id: text(row.id), projectId: text(row.project_id), bidJobId: text(row.bid_job_id), type: text(row.type) as Approval['type'],
    targetType: text(row.target_type), targetId: text(row.target_id), decision: text(row.decision) as Approval['decision'],
    note: optionalText(row.note), actorId: text(row.actor_id), occurredAt: text(row.occurred_at),
  }));

  return { snapshotId, audience, createdAt: new Date().toISOString(), createdBy: actorId, project, bidJob: job, qaResult, approvals,
    assumptions: [], sourceDocuments, planSheets, evidence, unitTypes, unitMixEntries, cabinetInstances, takeoffLines, catalogSkus, skuMappings, estimateLines };
}

function mapArtifact(row: Row): ExportArtifact {
  return {
    id: text(row.id), projectId: text(row.project_id), bidJobId: text(row.bid_job_id), snapshotId: text(row.snapshot_id),
    format: text(row.format) as ExportFormat, audience: text(row.audience) as ExportAudience, schemaVersion: text(row.schema_version),
    status: text(row.status) as ExportArtifact['status'], storageKey: optionalText(row.storage_key), mimeType: optionalText(row.mime_type),
    byteSize: optionalNumber(row.byte_size), sha256: optionalText(row.sha256), generatedBy: text(row.generated_by),
    generatedAt: optionalText(row.generated_at), qaResultId: optionalText(row.qa_result_id), warnings: json<string[]>(row.warnings_json, []),
  };
}

export function listExportArtifacts(jobId: string): ExportArtifact[] {
  return rows('SELECT * FROM export_artifacts WHERE bid_job_id = ? ORDER BY generated_at DESC, id DESC', jobId).map(mapArtifact);
}

export async function createExportArtifact(jobId: string, actorId: string, format: ExportFormat, audience: ExportAudience): Promise<ExportArtifact> {
  if (format === 'review_pdf' && audience !== 'internal_review') {
    throw new ApiServiceError('INVALID_EXPORT_AUDIENCE', 'Review PDF is internal-review only.', 400);
  }
  const id = randomUUID();
  const snapshotId = randomUUID();
  const input = loadSnapshotInput(jobId, actorId, audience, snapshotId);
  const config = formatConfig[format];
  const db = getDatabase();
  db.prepare(`INSERT INTO export_artifacts (id, project_id, bid_job_id, snapshot_id, format, audience, schema_version, status, generated_by, qa_result_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'generating', ?, ?)`).run(id, input.project.id, jobId, snapshotId, format, audience, 'cabinet-export-snapshot/v1', actorId, input.qaResult.id);
  try {
    const snapshot = buildExportSnapshot(input);
    const bytes = format === 'json' ? serializeExportJson(snapshot)
      : format === 'csv' ? serializeExportCsv(snapshot)
      : format === 'xlsx' ? serializeExportXlsx(snapshot)
      : await generateReviewPdf(snapshot, await Promise.all(rows(`SELECT title, storage_key FROM evidence_snippets
          WHERE project_id=? AND storage_key IS NOT NULL ORDER BY created_at, id`, input.project.id).map(async (row) => ({
            title: text(row.title), bytes: await readBinary(text(row.storage_key)), mimeType: 'image/png' as const,
          }))));
    const storageKey = `exports/${input.project.id}/${jobId}/${id}.${config.extension}`;
    await writeBinary(storageKey, bytes);
    const generatedAt = new Date().toISOString();
    db.prepare(`UPDATE export_artifacts SET status='ready', storage_key=?, mime_type=?, byte_size=?, sha256=?, generated_at=?, warnings_json=? WHERE id=?`)
      .run(storageKey, config.mimeType, bytes.byteLength, createHash('sha256').update(bytes).digest('hex'), generatedAt, JSON.stringify(snapshot.warnings), id);
    return mapArtifact(db.prepare('SELECT * FROM export_artifacts WHERE id = ?').get(id) as Row);
  } catch (error) {
    db.prepare(`UPDATE export_artifacts SET status='failed', generated_at=?, warnings_json=? WHERE id=?`)
      .run(new Date().toISOString(), JSON.stringify([error instanceof Error ? error.message : 'Export failed']), id);
    if (error && typeof error === 'object' && 'code' in error) {
      const typed = error as ExportSnapshotError;
      throw new ApiServiceError(typed.code, typed.message, 409, typed.details);
    }
    throw error;
  }
}

export async function readExportArtifact(artifactId: string): Promise<{ artifact: ExportArtifact; bytes: Buffer }> {
  const row = getDatabase().prepare('SELECT * FROM export_artifacts WHERE id = ?').get(artifactId) as Row | undefined;
  if (!row) throw new ApiServiceError('EXPORT_NOT_FOUND', 'Export artifact not found.', 404, { artifactId });
  const artifact = mapArtifact(row);
  if (artifact.status !== 'ready' || !artifact.storageKey) throw new ApiServiceError('EXPORT_NOT_READY', 'Export artifact is not ready.', 409, { artifactId, status: artifact.status });
  const bytes = await readBinary(artifact.storageKey);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== artifact.sha256) throw new ApiServiceError('EXPORT_INTEGRITY_FAILURE', 'Export artifact hash verification failed.', 500, { artifactId });
  return { artifact, bytes };
}
