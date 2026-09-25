import 'server-only';

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ApiServiceError } from '@/lib/autobidder/api/errors';
import {
  compileEstimate,
  mapCatalogSku,
  reconcileUnitMix,
  runCabinetQa,
  traceProjectEvidence,
  buildProvenanceIndex,
  type ApprovedNormalizationRule,
  type ApprovedSubstitution,
} from '@/lib/autobidder/compiler';
import { applyTransition, WorkflowTransitionError } from '@/lib/autobidder/domain/canonical-workflow';
import { getDatabase, withTransaction } from '@/lib/autobidder/db/database';
import type {
  Approval,
  AuditEvent,
  BidJob,
  CabinetCategory,
  CabinetInstance,
  CatalogSku,
  EstimateLine,
  PlanSheet,
  Principal,
  QAResult,
  SkuMapping,
  SourceDocument,
  TakeoffLine,
  UnitMixEntry,
  UnitType,
  VisionEvidence,
  WorkflowState,
  WorkflowTransition,
} from '@/types/canonical';
import { createNotificationOnce } from '@/lib/autobidder/services/notification-service';

const CALCULATION_VERSION = 'cabinet-compiler-v1';

type JsonObject = Record<string, unknown>;
type JobContextRow = {
  id: string;
  project_id: string;
  workflow_state: string;
  version: number;
  created_at: string;
  updated_at: string;
  organization_id: string;
  currency: string;
};

export interface CatalogWorkbookInput {
  fileName: string;
  sha256: string;
  sourceDocumentId?: string;
  rows: Array<{
    sku: string;
    cabinetCode: string;
    sourceWorksheet: string;
    sourceRow: number;
    rawValues?: JsonObject;
    description?: string;
    cabinetFamily?: string;
    widthInches?: number;
    heightInches?: number;
    depthInches?: number;
    finish?: string;
    constructionFamily?: string;
    modifiers?: string[];
    unitCostCents?: number;
    sellPriceCents?: number;
    accessoryClassification?: string;
    availability?: string;
    active?: boolean;
  }>;
}

export interface TakeoffDraftInput {
  cabinets: Array<{
    unitTypeId: string;
    room: string;
    category: CabinetCategory;
    interpretedCode?: string;
    widthInches?: number;
    heightInches?: number;
    depthInches?: number;
    configuration?: string;
    quantityPerUnit: number;
    ada?: boolean;
    evidenceIds: string[];
    confidence?: number;
    planNote?: string;
  }>;
}

export interface VisualExtractionInput {
  unitTypes: Array<{
    code: string;
    name: string;
    accessibility?: UnitType['accessibility'];
    aliases?: string[];
    evidenceIds: string[];
  }>;
}

export interface UnitMixDraftInput {
  entries: Array<{
    unitTypeId?: string;
    code: string;
    name: string;
    accessibility?: UnitType['accessibility'];
    aliases?: string[];
    extractedCount: number;
    evidenceIds: string[];
    discrepancy?: string;
  }>;
}

export interface CanonicalBidSnapshot {
  job: BidJob;
  unitTypes: UnitType[];
  unitMixEntries: UnitMixEntry[];
  cabinetInstances: CabinetInstance[];
  takeoffLines: TakeoffLine[];
  catalogSkus: CatalogSku[];
  mappings: SkuMapping[];
  estimateLines: EstimateLine[];
  qaResults: QAResult[];
  approvals: Approval[];
  auditEvents: AuditEvent[];
  visionEvidence: VisionEvidence[];
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function now(): string {
  return new Date().toISOString();
}

function assertSafeCount(value: number, field: string, allowZero = true) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new ApiServiceError('VALIDATION_ERROR', `${field} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer.`, 400);
  }
}

function loadContext(db: DatabaseSync, jobId: string, principal?: Principal): JobContextRow {
  const row = db
    .prepare(
      `SELECT j.id, j.project_id, j.workflow_state, j.version, j.created_at, j.updated_at,
              p.organization_id, p.currency
       FROM bid_jobs j JOIN projects p ON p.id = j.project_id WHERE j.id = ?`,
    )
    .get(jobId) as JobContextRow | undefined;
  if (!row) throw new ApiServiceError('JOB_NOT_FOUND', 'Bid job was not found.', 404, { jobId });
  if (principal && principal.organizationId !== row.organization_id) {
    throw new ApiServiceError('JOB_NOT_FOUND', 'Bid job was not found.', 404, { jobId });
  }
  return row;
}

function loadWorkflowEvents(db: DatabaseSync, jobId: string): WorkflowTransition[] {
  const rows = db.prepare('SELECT * FROM workflow_events WHERE bid_job_id = ? ORDER BY occurred_at, id').all(jobId) as any[];
  return rows.map((row) => ({
    id: row.id,
    bidJobId: row.bid_job_id,
    from: row.from_state,
    to: row.to_state,
    accepted: Boolean(row.accepted),
    reason: row.reason ?? undefined,
    actorId: row.actor_id,
    occurredAt: row.occurred_at,
  }));
}

function loadCanonicalJob(db: DatabaseSync, context: JobContextRow): BidJob {
  const state = context.workflow_state as WorkflowState;
  const allowed: WorkflowState[] = [
    'project_created', 'source_files_ingested', 'workbook_ingested', 'cabinet_pages_classified',
    'cabinet_pages_extracted', 'cabinet_takeoff_draft', 'unit_mix_required', 'unit_mix_verified',
    'sku_mapping_required', 'pricing_mapping_required', 'cabinet_bid_review_required', 'qa_failed',
    'cabinet_bid_safe_to_send', 'exported',
  ];
  if (!allowed.includes(state)) {
    throw new ApiServiceError('CANONICAL_STATE_REQUIRED', `Job is in legacy or unsupported state: ${context.workflow_state}.`, 409);
  }
  const unresolved = db
    .prepare(`SELECT m.id FROM sku_mappings m JOIN takeoff_lines t ON t.id = m.takeoff_line_id WHERE t.bid_job_id = ? AND m.outcome = 'unresolved'`)
    .all(context.id) as Array<{ id: string }>;
  const approvals = db.prepare('SELECT id FROM approvals WHERE bid_job_id = ? ORDER BY occurred_at').all(context.id) as Array<{ id: string }>;
  const artifacts = db.prepare('SELECT id FROM export_artifacts WHERE bid_job_id = ? ORDER BY generated_at').all(context.id) as Array<{ id: string }>;
  const run = db.prepare('SELECT id FROM job_runs WHERE bid_job_id = ? ORDER BY COALESCE(started_at, rowid) DESC LIMIT 1').get(context.id) as { id: string } | undefined;
  return {
    id: context.id,
    projectId: context.project_id,
    state,
    stateHistory: loadWorkflowEvents(db, context.id),
    unresolvedItemIds: unresolved.map((row) => row.id),
    approvalIds: approvals.map((row) => row.id),
    artifactIds: artifacts.map((row) => row.id),
    currentRunId: run?.id,
    createdAt: context.created_at,
    updatedAt: context.updated_at,
    version: context.version,
  };
}

function persistTransition(db: DatabaseSync, job: BidJob, to: WorkflowState, principal: Principal, reason: string): BidJob {
  try {
    const result = applyTransition(job, to, principal.id, reason);
    const event = result.attempt;
    db.prepare(
      `INSERT INTO workflow_events (id, bid_job_id, from_state, to_state, accepted, reason, actor_id, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(event.id, event.bidJobId, event.from, event.to, 1, event.reason ?? null, event.actorId, event.occurredAt);
    db.prepare('UPDATE bid_jobs SET workflow_state = ?, version = ?, updated_at = ? WHERE id = ?')
      .run(result.job.state, result.job.version, result.job.updatedAt, result.job.id);
    return result.job;
  } catch (error) {
    if (error instanceof WorkflowTransitionError) {
      const attempt = (error as WorkflowTransitionError & { attempt?: WorkflowTransition }).attempt;
      if (attempt) {
        db.prepare(
          `INSERT INTO workflow_events (id, bid_job_id, from_state, to_state, accepted, reason, actor_id, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(attempt.id, attempt.bidJobId, attempt.from, attempt.to, 0, attempt.reason ?? null, attempt.actorId, attempt.occurredAt);
      }
      throw new ApiServiceError('INVALID_WORKFLOW_TRANSITION', error.message, 409, { from: error.from, to: error.to });
    }
    throw error;
  }
}

function assertState(job: BidJob, states: WorkflowState[]) {
  if (!states.includes(job.state)) {
    throw new ApiServiceError('INVALID_WORKFLOW_STATE', `Action is not allowed while the job is ${job.state}.`, 409, {
      currentState: job.state,
      requiredStates: states,
    });
  }
}

function insertAudit(db: DatabaseSync, context: JobContextRow, principal: Principal, args: {
  action: string;
  resourceType: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  outcome?: AuditEvent['outcome'];
  reason?: string;
}) {
  const event: AuditEvent = {
    id: randomUUID(),
    organizationId: context.organization_id,
    projectId: context.project_id,
    actorId: principal.id,
    actorKind: principal.kind,
    action: args.action,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    before: args.before,
    after: args.after,
    outcome: args.outcome ?? 'accepted',
    reason: args.reason,
    occurredAt: now(),
  };
  db.prepare(
    `INSERT INTO audit_events
       (id, organization_id, project_id, actor_id, actor_kind, action, resource_type, resource_id,
        before_json, after_json, outcome, reason, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.id, event.organizationId, event.projectId, event.actorId, event.actorKind, event.action,
    event.resourceType, event.resourceId, event.before === undefined ? null : JSON.stringify(event.before),
    event.after === undefined ? null : JSON.stringify(event.after), event.outcome, event.reason ?? null, event.occurredAt,
  );
}

function insertApproval(db: DatabaseSync, context: JobContextRow, principal: Principal, args: {
  type: Approval['type']; targetType: string; targetId: string; decision?: Approval['decision']; note?: string;
}): Approval {
  const approval: Approval = {
    id: randomUUID(), projectId: context.project_id, bidJobId: context.id, type: args.type,
    targetType: args.targetType, targetId: args.targetId, decision: args.decision ?? 'approved',
    note: args.note, actorId: principal.id, occurredAt: now(),
  };
  db.prepare(
    `INSERT INTO approvals (id, project_id, bid_job_id, type, target_type, target_id, decision, note, actor_id, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(approval.id, approval.projectId, approval.bidJobId, approval.type, approval.targetType, approval.targetId,
    approval.decision, approval.note ?? null, approval.actorId, approval.occurredAt);
  return approval;
}

function ensureEvidence(db: DatabaseSync, projectId: string, evidenceIds: readonly string[]) {
  const unique = [...new Set(evidenceIds)];
  if (unique.length === 0) throw new ApiServiceError('MISSING_SOURCE_EVIDENCE', 'At least one source evidence reference is required.', 409);
  const valid = new Set(
    (db.prepare(`SELECT id FROM vision_evidence WHERE project_id = ?`).all(projectId) as Array<{ id: string }>).map((row) => row.id),
  );
  const missing = unique.filter((id) => !valid.has(id));
  if (missing.length > 0) throw new ApiServiceError('MISSING_SOURCE_EVIDENCE', 'Evidence does not belong to this project.', 409, { missing });
}

function ensureEvidenceKinds(
  db: DatabaseSync,
  projectId: string,
  evidenceIds: readonly string[],
  allowedKinds: readonly VisionEvidence['kind'][],
  label: string,
) {
  ensureEvidence(db, projectId, evidenceIds);
  const placeholders = evidenceIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, kind FROM vision_evidence WHERE project_id=? AND id IN (${placeholders})`)
    .all(projectId, ...evidenceIds) as Array<{ id: string; kind: VisionEvidence['kind'] }>;
  const invalid = rows.filter((row) => !allowedKinds.includes(row.kind));
  if (invalid.length) {
    throw new ApiServiceError('EVIDENCE_KIND_MISMATCH', `${label} requires ${allowedKinds.join(' or ')} evidence.`, 409, {
      invalid: invalid.map((row) => ({ id: row.id, kind: row.kind })), allowedKinds,
    });
  }
}

function ensureReviewedRelevantEvidence(db: DatabaseSync, projectId: string, evidenceIds: readonly string[], label: string) {
  const placeholders = evidenceIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT e.id, ps.classification, ps.review_required
    FROM vision_evidence e JOIN plan_sheets ps ON ps.id=e.plan_sheet_id
    JOIN source_documents sd ON sd.id=ps.source_document_id
    WHERE e.project_id=? AND sd.project_id=? AND e.id IN (${placeholders})`).all(projectId, projectId, ...evidenceIds) as Array<{ id: string; classification: string | null; review_required: number }>;
  const blocked = rows.filter((row) => Boolean(row.review_required) || ['UNKNOWN', 'IRRELEVANT', 'COVER', 'INDEX'].includes(row.classification || 'UNKNOWN'));
  if (blocked.length) throw new ApiServiceError('PLAN_CLASSIFICATION_REVIEW_REQUIRED', `${label} may use only reviewed cabinet-relevant plan sheets.`, 409, { evidenceIds: blocked.map((row) => row.id) });
}

function loadUnitTypes(db: DatabaseSync, projectId: string): UnitType[] {
  return (db.prepare('SELECT * FROM unit_types WHERE project_id = ? ORDER BY code').all(projectId) as any[]).map((row) => ({
    id: row.id, projectId: row.project_id, code: row.code, name: row.name,
    accessibility: row.accessibility, aliases: parseJson(row.aliases_json, []),
  }));
}

function loadApprovals(db: DatabaseSync, jobId: string): Approval[] {
  return (db.prepare('SELECT * FROM approvals WHERE bid_job_id = ? ORDER BY occurred_at').all(jobId) as any[]).map((row) => ({
    id: row.id, projectId: row.project_id, bidJobId: row.bid_job_id, type: row.type,
    targetType: row.target_type, targetId: row.target_id, decision: row.decision, note: row.note ?? undefined,
    actorId: row.actor_id, occurredAt: row.occurred_at,
  }));
}

function loadVisionEvidence(db: DatabaseSync, projectId: string): VisionEvidence[] {
  return (db.prepare('SELECT * FROM vision_evidence WHERE project_id = ? ORDER BY created_at, id').all(projectId) as any[]).map((row) => ({
    ...parseJson(row.payload_json, {}), id: row.id, projectId: row.project_id, planSheetId: row.plan_sheet_id,
    kind: row.kind, region: parseJson(row.region_json, undefined), text: row.text_content ?? undefined,
    confidence: row.confidence ?? undefined, createdAt: row.created_at,
  }));
}

function loadUnitMix(db: DatabaseSync, projectId: string, jobId: string): UnitMixEntry[] {
  const approvalByTarget = new Map(
    loadApprovals(db, jobId).filter((item) => item.type === 'unit_mix' && item.decision === 'approved').map((item) => [item.targetId, item]),
  );
  return (db.prepare('SELECT * FROM unit_mix_entries WHERE project_id = ? ORDER BY id').all(projectId) as any[]).map((row) => ({
    id: row.id, projectId: row.project_id, unitTypeId: row.unit_type_id, extractedCount: Number(row.extracted_count),
    verifiedCount: row.verified_count === null ? undefined : Number(row.verified_count),
    evidenceIds: parseJson(row.evidence_ids_json, []), discrepancy: row.discrepancy ?? undefined,
    resolutionNote: approvalByTarget.get(row.id)?.note, status: row.status,
    approvedBy: row.approved_by ?? undefined, approvedAt: row.approved_at ?? undefined,
  }));
}

function loadCabinets(db: DatabaseSync, projectId: string): CabinetInstance[] {
  return (db.prepare('SELECT * FROM cabinet_instances WHERE project_id = ? ORDER BY id').all(projectId) as any[]).map((row) => {
    const payload = parseJson<JsonObject>(row.payload_json, {});
    return {
      ...payload, id: row.id, projectId: row.project_id, unitTypeId: row.unit_type_id, room: row.room,
      category: row.category, quantityPerUnit: Number(row.quantity_per_unit), status: row.status,
      evidenceIds: parseJson(row.evidence_ids_json, []),
    } as CabinetInstance;
  });
}

function loadTakeoff(db: DatabaseSync, jobId: string): TakeoffLine[] {
  return (db.prepare('SELECT * FROM takeoff_lines WHERE bid_job_id = ? ORDER BY id').all(jobId) as any[]).map((row) => ({
    id: row.id, bidJobId: row.bid_job_id, cabinetInstanceId: row.cabinet_instance_id,
    unitTypeId: row.unit_type_id, quantityPerUnit: Number(row.quantity_per_unit), status: row.status,
    evidenceIds: parseJson(row.evidence_ids_json, []),
  }));
}

function loadCatalog(db: DatabaseSync, projectId: string, authoritativeOnly = false): CatalogSku[] {
  const condition = authoritativeOnly ? ' AND w.authoritative = 1' : '';
  return (db.prepare(
    `SELECT s.*, w.file_name source_workbook FROM catalog_skus s
     JOIN catalog_workbooks w ON w.id = s.workbook_id WHERE w.project_id = ?${condition} ORDER BY s.source_worksheet, s.source_row`,
  ).all(projectId) as any[]).map((row) => {
    const payload = parseJson<JsonObject>(row.payload_json, {});
    return {
      ...payload, id: row.id, workbookId: row.workbook_id, sourceWorkbook: row.source_workbook,
      sourceWorksheet: row.source_worksheet, sourceRow: Number(row.source_row), rawValues: parseJson(row.raw_values_json, {}),
      sku: row.sku, cabinetCode: row.cabinet_code, unitCostCents: row.unit_cost_cents === null ? undefined : Number(row.unit_cost_cents),
      sellPriceCents: row.sell_price_cents === null ? undefined : Number(row.sell_price_cents), active: Boolean(row.active),
      modifiers: Array.isArray(payload.modifiers) ? payload.modifiers : [],
    } as CatalogSku;
  });
}

function loadMappings(db: DatabaseSync, jobId: string): SkuMapping[] {
  return (db.prepare(
    `SELECT m.* FROM sku_mappings m JOIN takeoff_lines t ON t.id = m.takeoff_line_id WHERE t.bid_job_id = ? ORDER BY m.id`,
  ).all(jobId) as any[]).map((row) => ({
    id: row.id, takeoffLineId: row.takeoff_line_id, catalogSkuId: row.catalog_sku_id ?? undefined,
    outcome: row.outcome, matchMethod: row.match_method, confidence: row.confidence ?? undefined,
    normalizationRuleId: row.normalization_rule_id ?? undefined, approvedBy: row.approved_by ?? undefined,
    approvedAt: row.approved_at ?? undefined, resolutionNote: row.resolution_note ?? undefined,
  }));
}

function loadEstimateLines(db: DatabaseSync, jobId: string): EstimateLine[] {
  return (db.prepare(
    `SELECT e.*, t.quantity_per_unit, u.verified_count
     FROM estimate_lines e
     LEFT JOIN sku_mappings m ON m.id = e.mapping_id
     LEFT JOIN takeoff_lines t ON t.id = m.takeoff_line_id
     LEFT JOIN unit_mix_entries u ON u.id = e.unit_mix_entry_id
     WHERE e.bid_job_id = ? ORDER BY e.id`,
  ).all(jobId) as any[]).map((row) => ({
    id: row.id, bidJobId: row.bid_job_id, mappingId: row.mapping_id ?? undefined,
    unitMixEntryId: row.unit_mix_entry_id ?? undefined, category: row.category, description: row.description,
    quantityPerUnit: row.quantity_per_unit === null ? undefined : Number(row.quantity_per_unit),
    verifiedUnitCount: row.verified_count === null ? undefined : Number(row.verified_count),
    projectQuantity: Number(row.project_quantity), unitCostCents: Number(row.unit_cost_cents),
    extendedCostCents: Number(row.extended_cost_cents), currency: row.currency,
    calculationVersion: row.calculation_version, evidenceIds: parseJson(row.evidence_ids_json, []),
  }));
}

function loadQa(db: DatabaseSync, jobId: string): QAResult[] {
  return (db.prepare('SELECT * FROM qa_results WHERE bid_job_id = ? ORDER BY executed_at DESC').all(jobId) as any[]).map((row) => ({
    id: row.id, bidJobId: row.bid_job_id, safeToSend: Boolean(row.safe_to_send),
    issues: parseJson(row.issues_json, []), reconciliation: parseJson(row.reconciliation_json, {}),
    warnings: parseJson(row.warnings_json, []), informationalNotes: parseJson(row.informational_notes_json, []),
    reviewerRequirements: parseJson(row.reviewer_requirements_json, []), calculationVersion: row.calculation_version,
    executedAt: row.executed_at, executedBy: 'cabinet_qa_agent',
  }));
}

export function getCanonicalBidSnapshot(jobId: string, principal?: Principal): CanonicalBidSnapshot {
  const db = getDatabase();
  const context = loadContext(db, jobId, principal);
  return {
    job: loadCanonicalJob(db, context), unitTypes: loadUnitTypes(db, context.project_id),
    unitMixEntries: loadUnitMix(db, context.project_id, jobId), cabinetInstances: loadCabinets(db, context.project_id),
    takeoffLines: loadTakeoff(db, jobId), catalogSkus: loadCatalog(db, context.project_id, true),
    mappings: loadMappings(db, jobId), estimateLines: loadEstimateLines(db, jobId), qaResults: loadQa(db, jobId),
    approvals: loadApprovals(db, jobId),
    visionEvidence: loadVisionEvidence(db, context.project_id),
    auditEvents: (db.prepare('SELECT * FROM audit_events WHERE project_id = ? ORDER BY occurred_at DESC').all(context.project_id) as any[]).map((row) => ({
      id: row.id, organizationId: row.organization_id, projectId: row.project_id ?? undefined, actorId: row.actor_id,
      actorKind: row.actor_kind, action: row.action, resourceType: row.resource_type, resourceId: row.resource_id,
      correlationId: row.correlation_id ?? undefined, before: parseJson(row.before_json, undefined), after: parseJson(row.after_json, undefined),
      outcome: row.outcome, reason: row.reason ?? undefined, occurredAt: row.occurred_at,
    })),
  };
}

export function recordCanonicalVisualExtraction(jobId: string, input: VisualExtractionInput, principal: Principal) {
  if (!Array.isArray(input.unitTypes) || input.unitTypes.length === 0) {
    throw new ApiServiceError('VALIDATION_ERROR', 'At least one evidence-backed unit type is required.', 400);
  }
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    let job = loadCanonicalJob(db, context);
    assertState(job, ['cabinet_pages_classified', 'cabinet_pages_extracted']);
    const seen = new Set<string>();
    for (const [index, item] of input.unitTypes.entries()) {
      const code = item.code?.trim();
      const name = item.name?.trim();
      if (!code || !name) throw new ApiServiceError('VALIDATION_ERROR', `Unit type ${index + 1} requires a code and name.`, 400);
      if (seen.has(code)) throw new ApiServiceError('DUPLICATE_UNIT_TYPE', `Unit type code ${code} is duplicated.`, 409);
      seen.add(code);
      ensureEvidenceKinds(db, context.project_id, item.evidenceIds, ['unit_mix', 'classification', 'note'], 'Visual unit-type extraction');
      ensureReviewedRelevantEvidence(db, context.project_id, item.evidenceIds, 'Visual unit-type extraction');
      const id = (db.prepare('SELECT id FROM unit_types WHERE project_id=? AND code=?').get(context.project_id, code) as { id: string } | undefined)?.id || randomUUID();
      db.prepare(
        `INSERT INTO unit_types (id, project_id, code, name, accessibility, aliases_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, code) DO UPDATE SET name=excluded.name,
         accessibility=excluded.accessibility, aliases_json=excluded.aliases_json`,
      ).run(id, context.project_id, code, name, item.accessibility ?? 'unknown', JSON.stringify([...new Set(item.aliases ?? [])]));
    }
    insertAudit(db, context, principal, {
      action: 'visual_extraction.reviewed', resourceType: 'BidJob', resourceId: jobId,
      after: { unitTypes: input.unitTypes.map((item) => ({ code: item.code.trim(), evidenceIds: [...new Set(item.evidenceIds)] })) },
      reason: 'Human-reviewed unit type extraction persisted from rendered plan evidence.',
    });
    if (job.state === 'cabinet_pages_classified') {
      job = persistTransition(db, job, 'cabinet_pages_extracted', principal, 'Human-reviewed visual extraction recorded with source evidence.');
    }
    createNotificationOnce({ principalId: principal.id, projectId: context.project_id, bidJobId: jobId, type: 'extraction_complete', severity: 'success',
      title: 'Visual extraction reviewed', body: `${input.unitTypes.length} evidence-backed unit type(s) are ready for takeoff.`, targetPath: `/?job=${encodeURIComponent(jobId)}` });
    return { job, unitTypes: loadUnitTypes(db, context.project_id) };
  });
}

export function materializeCabinetVisionDraft(jobId: string, principal: Principal) {
  if (principal.kind !== 'service') throw new ApiServiceError('FORBIDDEN', 'Only the server vision worker may materialize agent candidates.', 403);
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    let job = loadCanonicalJob(db, context);
    assertState(job, ['cabinet_pages_classified']);
    const evidenceRows = db.prepare(`SELECT e.id, e.kind, e.confidence, e.payload_json
      FROM vision_evidence e WHERE e.project_id=? AND e.payload_json LIKE '%"agent":"cabinet_vision"%'
      ORDER BY e.created_at, e.id`).all(context.project_id) as Array<{ id: string; kind: string; confidence: number | null; payload_json: string }>;
    const candidates = evidenceRows.map((row) => ({ ...row, payload: parseJson<Record<string, any>>(row.payload_json, {}) }))
      .filter((row) => (row.confidence ?? 0) >= 0.7);
    const unitCandidates = candidates.filter((row) => row.payload.agentCandidate === 'unit_type');
    const cabinetCandidates = candidates.filter((row) => row.payload.agentCandidate === 'cabinet' && !row.payload.unresolvedAmbiguity);
    if (!unitCandidates.length && !cabinetCandidates.length) return { job, materialized: false, reason: 'No supported high-confidence Vision candidates.' };

    const unitByCode = new Map(loadUnitTypes(db, context.project_id).map((item) => [item.code, item]));
    const ensureUnit = (codeValue: unknown, nameValue?: unknown, accessibilityValue?: unknown, aliasesValue?: unknown) => {
      const code = String(codeValue || '').trim();
      if (!code) throw new ApiServiceError('VISION_SCHEMA_INVALID', 'Vision cabinet candidate omitted unitCode.', 502);
      const existing = unitByCode.get(code);
      if (existing) return existing;
      const accessibility = ['standard', 'ada', 'type_a', 'unknown'].includes(String(accessibilityValue)) ? String(accessibilityValue) : 'unknown';
      const aliases = Array.isArray(aliasesValue) ? aliasesValue.filter((value): value is string => typeof value === 'string') : [];
      const unit = { id: randomUUID(), projectId: context.project_id, code, name: String(nameValue || `Unit ${code}`).trim(), accessibility, aliases } as UnitType;
      db.prepare(`INSERT INTO unit_types (id, project_id, code, name, accessibility, aliases_json) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(unit.id, unit.projectId, unit.code, unit.name, unit.accessibility, JSON.stringify(unit.aliases));
      unitByCode.set(code, unit);
      return unit;
    };
    for (const row of unitCandidates) ensureUnit(row.payload.code, row.payload.name, row.payload.accessibility, row.payload.aliases);
    for (const row of cabinetCandidates) ensureUnit(row.payload.unitCode);
    job = persistTransition(db, job, 'cabinet_pages_extracted', principal, 'High-confidence provider observations were persisted as a reviewable visual extraction draft.');

    const existingTakeoff = loadTakeoff(db, jobId);
    if (!existingTakeoff.length && cabinetCandidates.length) {
      for (const row of cabinetCandidates) {
        const item = row.payload;
        const unit = ensureUnit(item.unitCode);
        const cabinetId = randomUUID();
        const takeoffId = randomUUID();
        const payload = { interpretedCode: item.interpretedCode, view: item.view, widthInches: item.widthInches, heightInches: item.heightInches,
          depthInches: item.depthInches, configuration: item.configuration, adjacentAppliances: item.adjacentAppliances || [], fillers: item.fillers || [],
          panels: item.panels || [], exposedEnds: item.exposedEnds || [], ada: Boolean(item.ada), confidence: row.confidence,
          planNote: item.planNote, extractionProvider: item.provider, extractionModel: item.model };
        db.prepare(`INSERT INTO cabinet_instances
          (id, project_id, unit_type_id, room, category, quantity_per_unit, status, evidence_ids_json, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, 'review_required', ?, ?)`).run(cabinetId, context.project_id, unit.id,
          String(item.room || 'Unspecified'), String(item.category), Number(item.quantityPerUnit), JSON.stringify([row.id]), JSON.stringify(payload));
        db.prepare(`INSERT INTO takeoff_lines
          (id, bid_job_id, cabinet_instance_id, unit_type_id, quantity_per_unit, status, evidence_ids_json)
          VALUES (?, ?, ?, ?, ?, 'unresolved', ?)`).run(takeoffId, jobId, cabinetId, unit.id, Number(item.quantityPerUnit), JSON.stringify([row.id]));
      }
      job = persistTransition(db, job, 'cabinet_takeoff_draft', principal, 'CabinetTakeoffAgent generated a normalized, evidence-linked draft requiring human approval.');
    }

    if (unitCandidates.some((row) => Number.isSafeInteger(row.payload.projectCount))) {
      db.prepare('DELETE FROM unit_mix_entries WHERE project_id=?').run(context.project_id);
      const grouped = new Map<string, typeof unitCandidates>();
      for (const row of unitCandidates.filter((candidate) => Number.isSafeInteger(candidate.payload.projectCount))) {
        const code = String(row.payload.code);
        grouped.set(code, [...(grouped.get(code) || []), row]);
      }
      for (const [code, rows] of grouped) {
        const unit = ensureUnit(code);
        const counts = [...new Set(rows.map((row) => Number(row.payload.projectCount)))];
        const discrepancy = counts.length > 1
          ? `Vision sources disagree for ${code}: ${counts.join(', ')}.`
          : rows.map((row) => row.payload.discrepancy).filter(Boolean).join(' | ') || null;
        db.prepare(`INSERT INTO unit_mix_entries
          (id, project_id, unit_type_id, extracted_count, verified_count, status, discrepancy, evidence_ids_json)
          VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`).run(randomUUID(), context.project_id, unit.id, counts[0], discrepancy ? 'disputed' : 'unverified',
          discrepancy, JSON.stringify(rows.map((row) => row.id)));
      }
    }
    insertAudit(db, context, principal, { action: 'vision.agents.materialized', resourceType: 'BidJob', resourceId: jobId,
      after: { unitCandidates: unitCandidates.length, cabinetCandidates: cabinetCandidates.length, state: job.state },
      reason: 'Only schema-validated, high-confidence, non-ambiguous provider observations were materialized; all remain review-required.' });
    return { job, materialized: true, unitTypes: loadUnitTypes(db, context.project_id), takeoffLines: loadTakeoff(db, jobId), unitMixEntries: loadUnitMix(db, context.project_id, jobId) };
  });
}

export function advanceCanonicalSystemState(
  jobId: string,
  to: Extract<WorkflowState, 'source_files_ingested' | 'cabinet_pages_classified'>,
  principal: Principal,
  reason: string,
) {
  if (principal.kind !== 'service') throw new ApiServiceError('FORBIDDEN', 'Only the server processing service may advance ingestion states.', 403);
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    const job = loadCanonicalJob(db, context);
    const next = persistTransition(db, job, to, principal, reason);
    insertAudit(db, context, principal, {
      action: `workflow.${to}`, resourceType: 'BidJob', resourceId: jobId, after: { state: to }, reason,
    });
    return next;
  });
}

export function approveCanonicalExport(jobId: string, note: string, principal: Principal) {
  if (!note?.trim()) throw new ApiServiceError('APPROVAL_NOTE_REQUIRED', 'Export approval requires a review note.', 400);
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    const job = loadCanonicalJob(db, context);
    assertState(job, ['cabinet_bid_review_required', 'qa_failed', 'cabinet_bid_safe_to_send']);
    const approval = insertApproval(db, context, principal, {
      type: 'export', targetType: 'BidJob', targetId: jobId, note: note.trim(),
    });
    insertAudit(db, context, principal, { action: 'export.approved', resourceType: 'BidJob', resourceId: jobId, after: approval });
    return { job, approval };
  });
}

export function markCanonicalExported(jobId: string, artifactId: string, principal: Principal) {
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    const job = loadCanonicalJob(db, context);
    assertState(job, ['cabinet_bid_safe_to_send']);
    const artifact = db.prepare(`SELECT id FROM export_artifacts WHERE id=? AND bid_job_id=? AND audience='customer' AND status='ready'`).get(artifactId, jobId);
    if (!artifact) throw new ApiServiceError('CUSTOMER_EXPORT_NOT_READY', 'A ready customer artifact is required before marking exported.', 409);
    const next = persistTransition(db, job, 'exported', principal, `Customer export artifact ${artifactId} generated.`);
    insertAudit(db, context, principal, { action: 'export.completed', resourceType: 'ExportArtifact', resourceId: artifactId, after: { state: next.state } });
    return next;
  });
}

export function ingestCanonicalCatalog(jobId: string, input: CatalogWorkbookInput, principal: Principal) {
  if (!input.fileName?.trim() || !input.sha256?.trim() || input.rows.length === 0) {
    throw new ApiServiceError('VALIDATION_ERROR', 'Workbook name, hash, and at least one catalog row are required.', 400);
  }
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    let job = loadCanonicalJob(db, context);
    assertState(job, ['source_files_ingested', 'workbook_ingested']);
    if (input.sourceDocumentId) {
      const source = db.prepare('SELECT id FROM source_documents WHERE id = ? AND project_id = ?').get(input.sourceDocumentId, context.project_id);
      if (!source) throw new ApiServiceError('INVALID_SOURCE_DOCUMENT', 'Workbook source document is not part of this project.', 409);
    }
    for (const [index, row] of input.rows.entries()) {
      if (!row.sku?.trim() || !row.cabinetCode?.trim() || !row.sourceWorksheet?.trim()) {
        throw new ApiServiceError('WORKBOOK_SCHEMA_UNSUPPORTED', `Catalog row ${index + 1} is missing a SKU, cabinet code, or worksheet.`, 400);
      }
      assertSafeCount(row.sourceRow, `rows[${index}].sourceRow`, false);
      if (row.unitCostCents !== undefined) assertSafeCount(row.unitCostCents, `rows[${index}].unitCostCents`);
      if (row.sellPriceCents !== undefined) assertSafeCount(row.sellPriceCents, `rows[${index}].sellPriceCents`);
    }
    db.prepare('UPDATE catalog_workbooks SET authoritative = 0 WHERE project_id = ?').run(context.project_id);
    const workbookId = randomUUID();
    db.prepare(
      `INSERT INTO catalog_workbooks (id, project_id, source_document_id, file_name, sha256, authoritative, ingested_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    ).run(workbookId, context.project_id, input.sourceDocumentId ?? null, input.fileName.trim(), input.sha256.trim(), now());
    const statement = db.prepare(
      `INSERT INTO catalog_skus
       (id, workbook_id, sku, cabinet_code, source_worksheet, source_row, unit_cost_cents, sell_price_cents,
        raw_values_json, payload_json, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of input.rows) {
      const payload = {
        description: row.description, cabinetFamily: row.cabinetFamily, widthInches: row.widthInches,
        heightInches: row.heightInches, depthInches: row.depthInches, finish: row.finish,
        constructionFamily: row.constructionFamily, modifiers: row.modifiers ?? [],
        accessoryClassification: row.accessoryClassification, availability: row.availability,
      };
      statement.run(randomUUID(), workbookId, row.sku.trim(), row.cabinetCode.trim(), row.sourceWorksheet.trim(), row.sourceRow,
        row.unitCostCents ?? null, row.sellPriceCents ?? null, JSON.stringify(row.rawValues ?? {}), JSON.stringify(payload), row.active === false ? 0 : 1);
    }
    insertAudit(db, context, principal, { action: 'catalog.workbook.ingested', resourceType: 'CatalogWorkbook', resourceId: workbookId,
      after: { fileName: input.fileName, rowCount: input.rows.length, authoritative: true } });
    if (job.state === 'source_files_ingested') job = persistTransition(db, job, 'workbook_ingested', principal, 'Authoritative catalog workbook ingested.');
    return { workbookId, rowCount: input.rows.length, job };
  });
}

export function recordCanonicalTakeoff(jobId: string, input: TakeoffDraftInput, principal: Principal) {
  if (!Array.isArray(input.cabinets) || input.cabinets.length === 0) throw new ApiServiceError('VALIDATION_ERROR', 'At least one cabinet is required.', 400);
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    let job = loadCanonicalJob(db, context);
    assertState(job, ['cabinet_pages_classified', 'cabinet_pages_extracted', 'cabinet_takeoff_draft']);
    const unitTypes = new Set(loadUnitTypes(db, context.project_id).map((item) => item.id));
    for (const [index, cabinet] of input.cabinets.entries()) {
      if (!unitTypes.has(cabinet.unitTypeId)) throw new ApiServiceError('UNKNOWN_UNIT_TYPE', `Cabinet ${index + 1} references an unknown unit type.`, 409);
      assertSafeCount(cabinet.quantityPerUnit, `cabinets[${index}].quantityPerUnit`, false);
      ensureEvidenceKinds(db, context.project_id, cabinet.evidenceIds, ['cabinet', 'dimension', 'note'], 'Cabinet takeoff');
      ensureReviewedRelevantEvidence(db, context.project_id, cabinet.evidenceIds, 'Cabinet takeoff');
    }
    const previousCabinetIds = (db.prepare('SELECT cabinet_instance_id FROM takeoff_lines WHERE bid_job_id = ?').all(jobId) as Array<{ cabinet_instance_id: string }>).map((row) => row.cabinet_instance_id);
    db.prepare('DELETE FROM takeoff_lines WHERE bid_job_id = ?').run(jobId);
    const deleteCabinet = db.prepare('DELETE FROM cabinet_instances WHERE id = ? AND project_id = ?');
    for (const cabinetId of previousCabinetIds) deleteCabinet.run(cabinetId, context.project_id);
    const cabinets: CabinetInstance[] = [];
    const takeoffLines: TakeoffLine[] = [];
    for (const item of input.cabinets) {
      const cabinet: CabinetInstance = {
        id: randomUUID(), projectId: context.project_id, unitTypeId: item.unitTypeId, room: item.room.trim() || 'Unspecified',
        category: item.category, interpretedCode: item.interpretedCode?.trim() || undefined,
        widthInches: item.widthInches, heightInches: item.heightInches, depthInches: item.depthInches,
        configuration: item.configuration, quantityPerUnit: item.quantityPerUnit, ada: Boolean(item.ada),
        evidenceIds: [...new Set(item.evidenceIds)], confidence: item.confidence, planNote: item.planNote,
        status: 'review_required',
      };
      const takeoff: TakeoffLine = {
        id: randomUUID(), bidJobId: jobId, cabinetInstanceId: cabinet.id, unitTypeId: cabinet.unitTypeId,
        quantityPerUnit: cabinet.quantityPerUnit, evidenceIds: cabinet.evidenceIds, status: 'unresolved',
      };
      const payload = { interpretedCode: cabinet.interpretedCode, widthInches: cabinet.widthInches,
        heightInches: cabinet.heightInches, depthInches: cabinet.depthInches, configuration: cabinet.configuration,
        ada: cabinet.ada, confidence: cabinet.confidence, planNote: cabinet.planNote };
      db.prepare(
        `INSERT INTO cabinet_instances
         (id, project_id, unit_type_id, room, category, quantity_per_unit, status, evidence_ids_json, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(cabinet.id, cabinet.projectId, cabinet.unitTypeId, cabinet.room, cabinet.category, cabinet.quantityPerUnit,
        cabinet.status, JSON.stringify(cabinet.evidenceIds), JSON.stringify(payload));
      db.prepare(
        `INSERT INTO takeoff_lines
         (id, bid_job_id, cabinet_instance_id, unit_type_id, quantity_per_unit, status, evidence_ids_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(takeoff.id, takeoff.bidJobId, takeoff.cabinetInstanceId, takeoff.unitTypeId, takeoff.quantityPerUnit,
        takeoff.status, JSON.stringify(takeoff.evidenceIds));
      cabinets.push(cabinet); takeoffLines.push(takeoff);
    }
    insertAudit(db, context, principal, { action: 'takeoff.draft.recorded', resourceType: 'BidJob', resourceId: jobId, after: { lineCount: takeoffLines.length } });
    if (job.state === 'cabinet_pages_classified') {
      job = persistTransition(db, job, 'cabinet_pages_extracted', principal, 'Evidence-backed cabinet extraction recorded.');
    }
    if (job.state === 'cabinet_pages_extracted') job = persistTransition(db, job, 'cabinet_takeoff_draft', principal, 'Cabinet takeoff draft recorded.');
    return { job, cabinets, takeoffLines };
  });
}

export function approveCanonicalTakeoff(jobId: string, takeoffLineIds: string[], note: string, principal: Principal) {
  if (!note?.trim()) throw new ApiServiceError('APPROVAL_NOTE_REQUIRED', 'Takeoff approval requires a review note.', 400);
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    let job = loadCanonicalJob(db, context);
    assertState(job, ['cabinet_takeoff_draft']);
    const lines = loadTakeoff(db, jobId);
    const selected = new Set(takeoffLineIds);
    if (selected.size !== lines.length || lines.some((line) => !selected.has(line.id))) {
      throw new ApiServiceError('INCOMPLETE_TAKEOFF_APPROVAL', 'Every takeoff line must be explicitly approved.', 409);
    }
    for (const line of lines) {
      db.prepare(`UPDATE takeoff_lines SET status = 'approved' WHERE id = ?`).run(line.id);
      db.prepare(`UPDATE cabinet_instances SET status = 'approved' WHERE id = ?`).run(line.cabinetInstanceId);
      insertApproval(db, context, principal, { type: 'pricing', targetType: 'TakeoffLine', targetId: line.id, note: note.trim() });
    }
    insertAudit(db, context, principal, { action: 'takeoff.approved', resourceType: 'BidJob', resourceId: jobId, after: { lineIds: [...selected] } });
    const extractedUnitMix = loadUnitMix(db, context.project_id, jobId);
    if (extractedUnitMix.length) job = persistTransition(db, job, 'unit_mix_required', principal, 'Agent-extracted unit mix is ready for mandatory human verification.');
    return { job, takeoffLines: loadTakeoff(db, jobId), cabinets: loadCabinets(db, context.project_id) };
  });
}

export function recordCanonicalUnitMix(jobId: string, input: UnitMixDraftInput, principal: Principal) {
  if (!Array.isArray(input.entries) || input.entries.length === 0) throw new ApiServiceError('VALIDATION_ERROR', 'At least one unit mix entry is required.', 400);
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    let job = loadCanonicalJob(db, context);
    assertState(job, ['cabinet_takeoff_draft', 'unit_mix_required']);
    const takeoff = loadTakeoff(db, jobId);
    if (takeoff.length === 0 || takeoff.some((line) => line.status !== 'approved')) {
      throw new ApiServiceError('TAKEOFF_APPROVAL_REQUIRED', 'Every takeoff line must be explicitly approved before unit mix review.', 409);
    }
    db.prepare('DELETE FROM unit_mix_entries WHERE project_id = ?').run(context.project_id);
    const existingTypes = loadUnitTypes(db, context.project_id);
    const typeByCode = new Map(existingTypes.map((item) => [item.code, item]));
    const entries: UnitMixEntry[] = [];
    for (const [index, item] of input.entries.entries()) {
      assertSafeCount(item.extractedCount, `entries[${index}].extractedCount`);
      ensureEvidenceKinds(db, context.project_id, item.evidenceIds, ['unit_mix'], 'Unit mix');
      ensureReviewedRelevantEvidence(db, context.project_id, item.evidenceIds, 'Unit mix');
      let unitType = item.unitTypeId ? existingTypes.find((candidate) => candidate.id === item.unitTypeId) : typeByCode.get(item.code);
      if (!unitType) {
        unitType = { id: randomUUID(), projectId: context.project_id, code: item.code.trim(), name: item.name.trim(),
          accessibility: item.accessibility ?? 'unknown', aliases: [...new Set(item.aliases ?? [])] };
        db.prepare(`INSERT INTO unit_types (id, project_id, code, name, accessibility, aliases_json) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(unitType.id, unitType.projectId, unitType.code, unitType.name, unitType.accessibility, JSON.stringify(unitType.aliases));
        typeByCode.set(unitType.code, unitType);
      }
      const entry: UnitMixEntry = {
        id: randomUUID(), projectId: context.project_id, unitTypeId: unitType.id, extractedCount: item.extractedCount,
        evidenceIds: [...new Set(item.evidenceIds)], discrepancy: item.discrepancy?.trim() || undefined,
        status: item.discrepancy ? 'disputed' : 'unverified',
      };
      db.prepare(
        `INSERT INTO unit_mix_entries
         (id, project_id, unit_type_id, extracted_count, verified_count, status, discrepancy, evidence_ids_json)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
      ).run(entry.id, entry.projectId, entry.unitTypeId, entry.extractedCount, entry.status, entry.discrepancy ?? null, JSON.stringify(entry.evidenceIds));
      entries.push(entry);
    }
    insertAudit(db, context, principal, { action: 'unit_mix.draft.recorded', resourceType: 'BidJob', resourceId: jobId, after: { entryCount: entries.length } });
    if (job.state === 'cabinet_takeoff_draft') job = persistTransition(db, job, 'unit_mix_required', principal, 'Unit mix requires human verification.');
    createNotificationOnce({ principalId: principal.id, projectId: context.project_id, bidJobId: jobId, type: 'unit_mix_review_required', severity: 'warning',
      title: 'Unit mix review required', body: 'Every extracted project count requires explicit verification before SKU mapping.', targetPath: `/?job=${encodeURIComponent(jobId)}` });
    return { job, unitTypes: loadUnitTypes(db, context.project_id), entries };
  });
}

export function verifyCanonicalUnitMix(jobId: string, decisions: Array<{ entryId: string; verifiedCount: number; resolutionNote?: string }>, principal: Principal) {
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    let job = loadCanonicalJob(db, context);
    assertState(job, ['unit_mix_required']);
    const entries = loadUnitMix(db, context.project_id, jobId);
    const byId = new Map(decisions.map((item) => [item.entryId, item]));
    if (entries.length === 0 || decisions.length !== entries.length || entries.some((entry) => !byId.has(entry.id))) {
      throw new ApiServiceError('INCOMPLETE_UNIT_MIX_APPROVAL', 'Every unit mix entry requires an explicit verification decision.', 409);
    }
    for (const entry of entries) {
      const decision = byId.get(entry.id)!;
      assertSafeCount(decision.verifiedCount, `verifiedCount:${entry.id}`);
      const changed = decision.verifiedCount !== entry.extractedCount || Boolean(entry.discrepancy);
      if (changed && !decision.resolutionNote?.trim()) {
        throw new ApiServiceError('DISCREPANCY_UNRESOLVED', 'Changed or disputed counts require a resolution note.', 409, { entryId: entry.id });
      }
      const timestamp = now();
      db.prepare(`UPDATE unit_mix_entries SET verified_count = ?, status = 'verified', approved_by = ?, approved_at = ? WHERE id = ?`)
        .run(decision.verifiedCount, principal.id, timestamp, entry.id);
      insertApproval(db, context, principal, { type: 'unit_mix', targetType: 'UnitMixEntry', targetId: entry.id, note: decision.resolutionNote?.trim() });
    }
    const verifiedEntries = loadUnitMix(db, context.project_id, jobId);
    const reconciliation = reconcileUnitMix(verifiedEntries, { unitTypes: loadUnitTypes(db, context.project_id) });
    if (!reconciliation.canCompile) throw new ApiServiceError('UNIT_MIX_NOT_VERIFIED', 'Unit mix did not pass deterministic reconciliation.', 409, { issues: reconciliation.issues });
    insertAudit(db, context, principal, { action: 'unit_mix.verified', resourceType: 'BidJob', resourceId: jobId, after: reconciliation });
    job = persistTransition(db, job, 'unit_mix_verified', principal, 'All unit mix entries verified by an authorized reviewer.');
    job = persistTransition(db, job, 'sku_mapping_required', principal, 'Verified counts are ready for deterministic SKU mapping.');
    return { job, entries: verifiedEntries, reconciliation };
  });
}

function persistMapping(db: DatabaseSync, mapping: SkuMapping) {
  db.prepare(
    `INSERT INTO sku_mappings
     (id, takeoff_line_id, catalog_sku_id, outcome, match_method, confidence, normalization_rule_id, approved_by, approved_at, resolution_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(mapping.id, mapping.takeoffLineId, mapping.catalogSkuId ?? null, mapping.outcome, mapping.matchMethod,
    mapping.confidence ?? null, mapping.normalizationRuleId ?? null, mapping.approvedBy ?? null,
    mapping.approvedAt ?? null, mapping.resolutionNote ?? null);
}

export function mapCanonicalSkus(jobId: string, principal: Principal) {
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    let job = loadCanonicalJob(db, context);
    assertState(job, ['sku_mapping_required']);
    const takeoff = loadTakeoff(db, jobId);
    const cabinets = new Map(loadCabinets(db, context.project_id).map((item) => [item.id, item]));
    const catalog = loadCatalog(db, context.project_id, true);
    const workbookIds = [...new Set(catalog.map((item) => item.workbookId))];
    if (workbookIds.length !== 1) throw new ApiServiceError('AUTHORITATIVE_WORKBOOK_REQUIRED', 'Exactly one authoritative catalog workbook is required.', 409);
    db.prepare('DELETE FROM sku_mappings WHERE takeoff_line_id IN (SELECT id FROM takeoff_lines WHERE bid_job_id = ?)').run(jobId);
    const mappings: SkuMapping[] = [];
    for (const line of takeoff) {
      const cabinet = cabinets.get(line.cabinetInstanceId);
      if (!cabinet) throw new ApiServiceError('TAKEOFF_LINK_MISMATCH', 'Takeoff references a missing cabinet instance.', 409, { takeoffLineId: line.id });
      const result = mapCatalogSku({ mappingId: randomUUID(), takeoffLine: line, cabinet, catalog, authoritativeWorkbookId: workbookIds[0] });
      persistMapping(db, result.mapping); mappings.push(result.mapping);
    }
    const unresolved = mappings.filter((item) => item.outcome === 'unresolved');
    insertAudit(db, context, principal, { action: 'sku_mapping.compiled', resourceType: 'BidJob', resourceId: jobId,
      after: { mappingCount: mappings.length, unresolvedCount: unresolved.length } });
    if (unresolved.length === 0) job = persistTransition(db, job, 'pricing_mapping_required', principal, 'Every takeoff line has an authoritative catalog mapping.');
    if (unresolved.length) createNotificationOnce({ principalId: principal.id, projectId: context.project_id, bidJobId: jobId, type: 'unresolved_mapping', severity: 'warning',
      title: 'SKU resolution required', body: `${unresolved.length} cabinet mapping exception(s) require an authorized decision.`, targetPath: `/?job=${encodeURIComponent(jobId)}` });
    return { job, mappings, unresolvedCount: unresolved.length };
  });
}

export function approveCanonicalSubstitution(jobId: string, takeoffLineId: string, catalogSkuId: string, note: string, principal: Principal) {
  if (!note?.trim()) throw new ApiServiceError('APPROVAL_NOTE_REQUIRED', 'A substitution requires a rationale.', 400);
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    let job = loadCanonicalJob(db, context);
    assertState(job, ['sku_mapping_required']);
    const takeoff = loadTakeoff(db, jobId).find((item) => item.id === takeoffLineId);
    if (!takeoff) throw new ApiServiceError('TAKEOFF_NOT_FOUND', 'Takeoff line was not found in this bid job.', 404);
    const cabinet = loadCabinets(db, context.project_id).find((item) => item.id === takeoff.cabinetInstanceId);
    if (!cabinet) throw new ApiServiceError('TAKEOFF_LINK_MISMATCH', 'Cabinet instance was not found.', 409);
    const catalog = loadCatalog(db, context.project_id, true);
    const workbookIds = [...new Set(catalog.map((item) => item.workbookId))];
    if (workbookIds.length !== 1) throw new ApiServiceError('AUTHORITATIVE_WORKBOOK_REQUIRED', 'Exactly one authoritative workbook is required.', 409);
    const timestamp = now();
    const substitution: ApprovedSubstitution = { takeoffLineId, targetCatalogSkuId: catalogSkuId, approvedBy: principal.id, approvedAt: timestamp, note: note.trim() };
    const result = mapCatalogSku({ mappingId: randomUUID(), takeoffLine: takeoff, cabinet, catalog,
      authoritativeWorkbookId: workbookIds[0], substitutions: [substitution] });
    if (result.mapping.outcome !== 'approved_substitution') throw new ApiServiceError('INVALID_SUBSTITUTION', result.mapping.resolutionNote || 'Substitution is invalid.', 409);
    db.prepare('DELETE FROM sku_mappings WHERE takeoff_line_id = ?').run(takeoffLineId);
    persistMapping(db, result.mapping);
    insertApproval(db, context, principal, { type: 'sku_substitution', targetType: 'SkuMapping', targetId: result.mapping.id, note: note.trim() });
    insertAudit(db, context, principal, { action: 'sku_mapping.substitution_approved', resourceType: 'SkuMapping', resourceId: result.mapping.id,
      after: result.mapping, reason: note.trim() });
    const unresolved = loadMappings(db, jobId).filter((item) => item.outcome === 'unresolved');
    if (unresolved.length === 0) job = persistTransition(db, job, 'pricing_mapping_required', principal, 'All mappings resolved, including approved substitutions.');
    return { job, mapping: result.mapping, unresolvedCount: unresolved.length };
  });
}

export function approveCanonicalNormalization(jobId: string, takeoffLineId: string, catalogSkuId: string, note: string, principal: Principal) {
  if (!note?.trim()) throw new ApiServiceError('APPROVAL_NOTE_REQUIRED', 'A normalization requires a rationale.', 400);
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    let job = loadCanonicalJob(db, context);
    assertState(job, ['sku_mapping_required']);
    const takeoff = loadTakeoff(db, jobId).find((item) => item.id === takeoffLineId);
    if (!takeoff) throw new ApiServiceError('TAKEOFF_NOT_FOUND', 'Takeoff line was not found in this bid job.', 404);
    const cabinet = loadCabinets(db, context.project_id).find((item) => item.id === takeoff.cabinetInstanceId);
    if (!cabinet?.interpretedCode) throw new ApiServiceError('NORMALIZATION_SOURCE_REQUIRED', 'Cabinet has no interpreted source code to normalize.', 409);
    const catalog = loadCatalog(db, context.project_id, true);
    const workbookIds = [...new Set(catalog.map((item) => item.workbookId))];
    if (workbookIds.length !== 1) throw new ApiServiceError('AUTHORITATIVE_WORKBOOK_REQUIRED', 'Exactly one authoritative workbook is required.', 409);
    const timestamp = now();
    const rule: ApprovedNormalizationRule = {
      id: randomUUID(), sourceCode: cabinet.interpretedCode, targetCatalogSkuId: catalogSkuId,
      approvedBy: principal.id, approvedAt: timestamp, widthInches: cabinet.widthInches,
      heightInches: cabinet.heightInches, depthInches: cabinet.depthInches, cabinetCategory: cabinet.category,
    };
    const result = mapCatalogSku({ mappingId: randomUUID(), takeoffLine: takeoff, cabinet, catalog,
      authoritativeWorkbookId: workbookIds[0], normalizationRules: [rule] });
    if (result.mapping.outcome !== 'normalized_match') throw new ApiServiceError('INVALID_NORMALIZATION', result.mapping.resolutionNote || 'Normalization is invalid.', 409);
    result.mapping.resolutionNote = note.trim();
    db.prepare('DELETE FROM sku_mappings WHERE takeoff_line_id = ?').run(takeoffLineId);
    persistMapping(db, result.mapping);
    insertApproval(db, context, principal, { type: 'normalization', targetType: 'SkuMapping', targetId: result.mapping.id, note: note.trim() });
    insertAudit(db, context, principal, { action: 'sku_mapping.normalization_approved', resourceType: 'SkuMapping', resourceId: result.mapping.id,
      after: result.mapping, reason: note.trim() });
    const unresolved = loadMappings(db, jobId).filter((item) => item.outcome === 'unresolved');
    if (unresolved.length === 0) job = persistTransition(db, job, 'pricing_mapping_required', principal, 'All mappings resolved, including approved normalization rules.');
    return { job, mapping: result.mapping, unresolvedCount: unresolved.length };
  });
}

export function compileCanonicalEstimate(jobId: string, principal: Principal) {
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    let job = loadCanonicalJob(db, context);
    assertState(job, ['pricing_mapping_required']);
    const unitMix = loadUnitMix(db, context.project_id, jobId);
    const mixByType = new Map(unitMix.map((item) => [item.unitTypeId, item]));
    const takeoff = loadTakeoff(db, jobId);
    const cabinets = new Map(loadCabinets(db, context.project_id).map((item) => [item.id, item]));
    const mappings = loadMappings(db, jobId);
    const mappingByTakeoff = new Map(mappings.map((item) => [item.takeoffLineId, item]));
    const catalog = new Map(loadCatalog(db, context.project_id, true).map((item) => [item.id, item]));
    const inputs = takeoff.map((line) => {
      const cabinet = cabinets.get(line.cabinetInstanceId);
      const mapping = mappingByTakeoff.get(line.id);
      const sku = mapping?.catalogSkuId ? catalog.get(mapping.catalogSkuId) : undefined;
      const mix = mixByType.get(line.unitTypeId);
      if (!cabinet || !mapping || !sku || !mix) {
        throw new ApiServiceError('COMPILER_INPUT_INCOMPLETE', 'Estimate inputs contain unresolved or missing records.', 409, { takeoffLineId: line.id });
      }
      return { estimateLineId: randomUUID(), bidJobId: jobId, takeoffLine: line, cabinet, mapping,
        catalogSku: sku, unitMixEntry: mix, currency: context.currency, calculationVersion: CALCULATION_VERSION };
    });
    const compiled = compileEstimate(inputs);
    db.prepare('DELETE FROM estimate_lines WHERE bid_job_id = ?').run(jobId);
    const insert = db.prepare(
      `INSERT INTO estimate_lines
       (id, bid_job_id, mapping_id, unit_mix_entry_id, category, description, project_quantity, unit_cost_cents,
        extended_cost_cents, currency, calculation_version, evidence_ids_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const line of compiled.lines) {
      insert.run(line.id, line.bidJobId, line.mappingId ?? null, line.unitMixEntryId ?? null, line.category,
        line.description, line.projectQuantity, line.unitCostCents, line.extendedCostCents, line.currency,
        line.calculationVersion, JSON.stringify(line.evidenceIds));
    }
    insertAudit(db, context, principal, { action: 'estimate.compiled', resourceType: 'BidJob', resourceId: jobId,
      after: { lineCount: compiled.lines.length, totalsByCategory: compiled.totalsByCategory, grandTotalCents: compiled.grandTotalCents } });
    job = persistTransition(db, job, 'cabinet_bid_review_required', principal, 'Deterministic estimate compiled from authoritative server catalog costs.');
    createNotificationOnce({ principalId: principal.id, projectId: context.project_id, bidJobId: jobId, type: 'ready_for_review', severity: 'success',
      title: 'Bid ready for QA review', body: `${compiled.lines.length} deterministic estimate line(s) are ready for the final safety gate.`, targetPath: `/?job=${encodeURIComponent(jobId)}` });
    return { job, ...compiled };
  });
}

export function runCanonicalQa(jobId: string, principal: Principal) {
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    let job = loadCanonicalJob(db, context);
    assertState(job, ['cabinet_bid_review_required', 'qa_failed']);
    if (job.state === 'qa_failed') job = persistTransition(db, job, 'cabinet_bid_review_required', principal, 'QA re-run requested after corrective review.');
    const entries = loadUnitMix(db, context.project_id, jobId);
    const takeoff = loadTakeoff(db, jobId);
    const cabinets = loadCabinets(db, context.project_id);
    const mappings = loadMappings(db, jobId);
    const catalog = loadCatalog(db, context.project_id, true);
    const estimates = loadEstimateLines(db, jobId);
    const workbookIds = [...new Set(catalog.map((item) => item.workbookId))];
    const evidenceIds = (db.prepare('SELECT id FROM vision_evidence WHERE project_id = ?').all(context.project_id) as Array<{ id: string }>).map((row) => row.id);
    const qa = runCabinetQa({
      qaResultId: randomUUID(), bidJob: job, executedAt: now(), calculationVersion: CALCULATION_VERSION,
      unitMixEntries: entries, takeoffLines: takeoff, cabinetInstances: cabinets, mappings, catalogSkus: catalog,
      estimateLines: estimates, authoritativeWorkbookIds: workbookIds,
      approvedNormalizationRuleIds: mappings.flatMap((item) => item.normalizationRuleId ? [item.normalizationRuleId] : []),
      availableEvidenceIds: evidenceIds, scopeComplete: estimates.length > 0 && takeoff.length > 0 && estimates.length === takeoff.length,
    });
    db.prepare(
      `INSERT INTO qa_results
       (id, bid_job_id, safe_to_send, issues_json, reconciliation_json, reviewer_requirements_json,
        warnings_json, informational_notes_json, calculation_version, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(qa.id, jobId, qa.safeToSend ? 1 : 0, JSON.stringify(qa.issues), JSON.stringify(qa.reconciliation),
      JSON.stringify(qa.reviewerRequirements), JSON.stringify(qa.warnings || []), JSON.stringify(qa.informationalNotes || []), qa.calculationVersion, qa.executedAt);
    insertAudit(db, context, principal, { action: 'qa.executed', resourceType: 'QAResult', resourceId: qa.id,
      after: { safeToSend: qa.safeToSend, issueCount: qa.issues.length } });
    if (!qa.safeToSend) job = persistTransition(db, job, 'qa_failed', principal, 'Cabinet QA detected one or more hard-stop issues.');
    if (!qa.safeToSend) createNotificationOnce({ principalId: principal.id, projectId: context.project_id, bidJobId: jobId, type: 'qa_failed', severity: 'critical',
      title: 'QA hard stop', body: `${qa.issues.length} critical issue(s) keep this bid unsafe to send.`, targetPath: `/?job=${encodeURIComponent(jobId)}` });
    return { job, qa };
  });
}

export function approveCanonicalQa(jobId: string, qaResultId: string, note: string, principal: Principal) {
  if (!note?.trim()) throw new ApiServiceError('APPROVAL_NOTE_REQUIRED', 'Final bid approval requires a note.', 400);
  return withTransaction((db) => {
    const context = loadContext(db, jobId, principal);
    let job = loadCanonicalJob(db, context);
    assertState(job, ['cabinet_bid_review_required']);
    const latest = loadQa(db, jobId)[0];
    if (!latest || latest.id !== qaResultId || !latest.safeToSend || latest.issues.some((issue) => issue.severity === 'critical' && !issue.resolved)) {
      throw new ApiServiceError('QA_APPROVAL_BLOCKED', 'Only the latest clean QA result can be approved.', 409);
    }
    const approval = insertApproval(db, context, principal, { type: 'qa', targetType: 'QAResult', targetId: qaResultId, note: note.trim() });
    insertAudit(db, context, principal, { action: 'qa.approved', resourceType: 'QAResult', resourceId: qaResultId,
      after: approval, reason: note.trim() });
    job = persistTransition(db, job, 'cabinet_bid_safe_to_send', principal, 'Latest clean QA result explicitly approved by an authorized actor.');
    createNotificationOnce({ principalId: principal.id, projectId: context.project_id, bidJobId: jobId, type: 'safe_to_send', severity: 'success',
      title: 'Bid safe to send', body: 'The latest clean QA result was explicitly approved. Customer export is unlocked.', targetPath: `/?job=${encodeURIComponent(jobId)}` });
    return { job, qa: latest, approval };
  });
}

export function getCanonicalProvenance(jobId: string, principal?: Principal) {
  const db = getDatabase();
  const context = loadContext(db, jobId, principal);
  const estimateLines = loadEstimateLines(db, jobId);
  const evidence = loadVisionEvidence(db, context.project_id);
  const sheets = (db.prepare(
    `SELECT s.* FROM plan_sheets s JOIN source_documents d ON d.id = s.source_document_id WHERE d.project_id = ?`,
  ).all(context.project_id) as any[]).map((row): PlanSheet => ({
    ...parseJson(row.payload_json, {}), id: row.id, sourceDocumentId: row.source_document_id,
    pageNumber: Number(row.page_number), sheetNumber: row.sheet_number ?? undefined, title: row.title ?? undefined,
    rotation: (parseJson<JsonObject>(row.payload_json, {}).rotation as PlanSheet['rotation']) ?? 0,
    classification: row.classification ?? undefined, classificationConfidence: row.classification_confidence ?? undefined,
    reviewRequired: Boolean(row.review_required), renderStorageKey: row.render_storage_key ?? undefined,
    thumbnailStorageKey: row.thumbnail_storage_key ?? undefined,
  }));
  const documents = (db.prepare('SELECT * FROM source_documents WHERE project_id = ?').all(context.project_id) as any[]).map((row): SourceDocument => ({
    id: row.id, projectId: row.project_id, originalPath: row.original_path, storageKey: row.storage_key,
    fileName: row.file_name, mimeType: row.mime_type, byteSize: Number(row.byte_size), sha256: row.sha256,
    ingestionOutcome: row.outcome, duplicateOfId: row.duplicate_of_id ?? undefined, createdAt: row.created_at,
  }));
  const index = buildProvenanceIndex({ estimateLines, mappings: loadMappings(db, jobId), takeoffLines: loadTakeoff(db, jobId),
    cabinetInstances: loadCabinets(db, context.project_id), unitMixEntries: loadUnitMix(db, context.project_id, jobId),
    catalogSkus: loadCatalog(db, context.project_id), evidence, planSheets: sheets, sourceDocuments: documents });
  return traceProjectEvidence(estimateLines.map((line) => line.id), index);
}
