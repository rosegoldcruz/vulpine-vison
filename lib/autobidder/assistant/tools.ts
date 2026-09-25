import 'server-only';

import type {
  CabinetObservation,
  CriticalIssue,
  SkuMapping,
  WorkbookRecord,
  WorkflowState,
} from '@/types';
import { citationId, projectCitation, workflowCitation } from './citations';
import type {
  AssistantCitation,
  AssistantFact,
  AssistantQueryResult,
  ProjectAssistantContext,
  ProjectAssistantToolRequest,
  ProjectAssistantQueryTool,
} from './contracts';
import { assertAssistantQueryTool } from './policy';

export interface WorkflowStatusData {
  projectName: string;
  processingStatus: ProjectAssistantContext['project']['processingStatus'];
  workflowState: WorkflowState;
  safeToSend: boolean;
  updatedAt: string;
}

export interface UnresolvedCabinetItem {
  reason: 'UNRESOLVED_MAPPING' | 'TAKEOFF_REVIEW_REQUIRED';
  cabinetFamily: string;
  unitType?: string;
  room?: string;
  description?: string;
  citations: AssistantCitation[];
}

export interface MappingExplanationItem {
  cabinetFamily: string;
  matchedSku?: string;
  status: SkuMapping['mappingStatus'];
  matchReason?: string;
  workbookReference?: {
    workbook: string;
    sheet: string;
    row: number;
  };
  citations: AssistantCitation[];
}

export interface WorkbookRowItem {
  sku: string;
  cabinetCode: string;
  description?: string;
  sourceWorkbook: string;
  sourceSheet: string;
  sourceRow: number;
  usedByMapping: boolean;
  citations: AssistantCitation[];
}

export interface QaBlockerItem {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  citations: AssistantCitation[];
}

export interface RemainingAction {
  code: string;
  description: string;
  blocking: boolean;
  citations: AssistantCitation[];
}

export interface AuditSummaryEvent {
  index: number;
  event: string;
  actor?: string;
  timestamp?: string;
  citations: AssistantCitation[];
}

function result<T>(
  context: ProjectAssistantContext,
  tool: ProjectAssistantQueryTool,
  data: T,
  facts: AssistantFact[],
  limitations: string[] = [],
): AssistantQueryResult<T> {
  return {
    tool,
    projectId: context.project.projectId,
    jobId: context.job.id,
    readOnly: true,
    data,
    facts,
    limitations,
  };
}

function planCitation(context: ProjectAssistantContext, row: CabinetObservation, index: number): AssistantCitation {
  return {
    id: citationId('plan_evidence', row.source.sourceDocument, row.source.sourcePage, row.sequence, index),
    kind: 'plan_evidence',
    projectId: context.project.projectId,
    jobId: context.job.id,
    entityId: `${row.unitType}:${row.room}:${row.sequence}`,
    label: `${row.source.sourceDocument}, page ${row.source.sourcePage}${row.source.sourceSheet ? `, sheet ${row.source.sourceSheet}` : ''}`,
    sourceDocument: row.source.sourceDocument,
    sourcePage: row.source.sourcePage,
    sourceSheet: row.source.sourceSheet,
    sourceView: row.source.sourceView,
  };
}

function takeoffCitation(context: ProjectAssistantContext, row: CabinetObservation, index: number): AssistantCitation {
  return {
    id: citationId('takeoff', row.unitType, row.room, row.sequence, index),
    kind: 'takeoff',
    projectId: context.project.projectId,
    jobId: context.job.id,
    entityId: `${row.unitType}:${row.room}:${row.sequence}`,
    label: `Takeoff ${row.unitType} / ${row.room} / ${row.cabinetFamily}`,
  };
}

function mappingCitation(context: ProjectAssistantContext, mapping: SkuMapping, index: number): AssistantCitation {
  return {
    id: citationId('sku_mapping', mapping.cabinetFamily, mapping.matchedSku, index),
    kind: 'sku_mapping',
    projectId: context.project.projectId,
    jobId: context.job.id,
    entityId: `${mapping.cabinetFamily}:${index}`,
    label: `SKU mapping ${mapping.cabinetFamily} → ${mapping.matchedSku || 'unresolved'}`,
    sourceWorkbook: mapping.sourceWorkbook,
    sourceSheet: mapping.sourceSheet,
    sourceRow: mapping.sourceRow,
  };
}

function workbookCitation(context: ProjectAssistantContext, record: WorkbookRecord): AssistantCitation {
  return {
    id: citationId('workbook_row', record.sourceWorkbook, record.sourceSheet, record.sourceRow),
    kind: 'workbook_row',
    projectId: context.project.projectId,
    jobId: context.job.id,
    entityId: `${record.sourceWorkbook}:${record.sourceSheet}:${record.sourceRow}`,
    label: `${record.sourceWorkbook}, ${record.sourceSheet}, row ${record.sourceRow}`,
    sourceWorkbook: record.sourceWorkbook,
    sourceSheet: record.sourceSheet,
    sourceRow: record.sourceRow,
  };
}

function qaCitation(context: ProjectAssistantContext, issue: CriticalIssue, index: number): AssistantCitation {
  return {
    id: citationId('qa_issue', issue.code, index),
    kind: 'qa_issue',
    projectId: context.project.projectId,
    jobId: context.job.id,
    entityId: `${issue.code}:${index}`,
    label: `QA issue ${issue.code}`,
  };
}

export function queryWorkflowStatus(context: ProjectAssistantContext): AssistantQueryResult<WorkflowStatusData> {
  const data: WorkflowStatusData = {
    projectName: context.project.projectName,
    processingStatus: context.project.processingStatus,
    workflowState: context.job.state,
    safeToSend: context.job.qaResult.safeToSend,
    updatedAt: context.job.updatedAt,
  };
  const citations = [projectCitation(context), workflowCitation(context)];
  return result(context, 'workflow_status', data, [
    {
      text: `${data.projectName} is in workflow state ${data.workflowState}; safe to send is ${data.safeToSend ? 'yes' : 'no'}.`,
      citations,
    },
  ]);
}

export function queryUnresolvedCabinets(
  context: ProjectAssistantContext,
  args: { unitType?: string } = {},
): AssistantQueryResult<UnresolvedCabinetItem[]> {
  const unitType = args.unitType?.trim().toLowerCase();
  const unresolvedMappings: UnresolvedCabinetItem[] = context.job.skuMappings
    .map((mapping, index) => ({ mapping, index }))
    .filter(({ mapping }) => mapping.mappingStatus === 'UNRESOLVED')
    .map(({ mapping, index }) => ({
      reason: 'UNRESOLVED_MAPPING' as const,
      cabinetFamily: mapping.cabinetFamily,
      citations: [mappingCitation(context, mapping, index)],
    }));

  const reviewRows: UnresolvedCabinetItem[] = context.job.takeoffRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.reviewRequired && (!unitType || row.unitType.toLowerCase() === unitType))
    .map(({ row, index }) => ({
      reason: 'TAKEOFF_REVIEW_REQUIRED' as const,
      cabinetFamily: row.cabinetFamily,
      unitType: row.unitType,
      room: row.room,
      description: row.description,
      citations: [takeoffCitation(context, row, index), planCitation(context, row, index)],
    }));

  const items = [...unresolvedMappings, ...reviewRows];
  const facts = items.map((item) => ({
    text: `${item.cabinetFamily}${item.unitType ? ` in unit ${item.unitType}` : ''} requires resolution (${item.reason}).`,
    citations: item.citations,
  }));
  const limitations = unitType && unresolvedMappings.length
    ? ['SKU mappings are not associated with unit types in the canonical schema, so unresolved mappings cannot be filtered by unit type.']
    : [];
  return result(context, 'unresolved_cabinets', items, facts, limitations);
}

export function queryMappingExplanation(
  context: ProjectAssistantContext,
  args: { cabinetFamily?: string; sku?: string },
): AssistantQueryResult<MappingExplanationItem[]> {
  const cabinetFamily = args.cabinetFamily?.trim().toLowerCase();
  const sku = args.sku?.trim().toLowerCase();
  const matches = context.job.skuMappings
    .map((mapping, index) => ({ mapping, index }))
    .filter(({ mapping }) => {
      const familyMatches = !cabinetFamily || mapping.cabinetFamily.toLowerCase() === cabinetFamily;
      const skuMatches = !sku || mapping.matchedSku?.toLowerCase() === sku;
      return familyMatches && skuMatches;
    });

  const items = matches.map(({ mapping, index }) => {
    const citations = [mappingCitation(context, mapping, index)];
    if (mapping.sourceWorkbook && mapping.sourceSheet && mapping.sourceRow !== undefined) {
      const record = context.job.workbookRecords.find(
        (candidate) =>
          candidate.sourceWorkbook === mapping.sourceWorkbook &&
          candidate.sourceSheet === mapping.sourceSheet &&
          candidate.sourceRow === mapping.sourceRow,
      );
      if (record) citations.push(workbookCitation(context, record));
    }
    return {
      cabinetFamily: mapping.cabinetFamily,
      matchedSku: mapping.matchedSku,
      status: mapping.mappingStatus,
      matchReason: mapping.matchReason,
      workbookReference:
        mapping.sourceWorkbook && mapping.sourceSheet && mapping.sourceRow !== undefined
          ? { workbook: mapping.sourceWorkbook, sheet: mapping.sourceSheet, row: mapping.sourceRow }
          : undefined,
      citations,
    };
  });
  const facts = items.map((item) => ({
    text: `${item.cabinetFamily} is ${item.status}${item.matchedSku ? ` to SKU ${item.matchedSku}` : ''}${item.matchReason ? ` because ${item.matchReason}` : ''}.`,
    citations: item.citations,
  }));
  const limitations = items.length === 0 ? ['No persisted SKU mapping matched the requested cabinet family or SKU.'] : [];
  return result(context, 'mapping_explanation', items, facts, limitations);
}

export function queryWorkbookRows(
  context: ProjectAssistantContext,
  args: { sku?: string; usedOnly?: boolean } = {},
): AssistantQueryResult<WorkbookRowItem[]> {
  const sku = args.sku?.trim().toLowerCase();
  const usedOnly = args.usedOnly ?? true;
  const usedReferences = new Set(
    context.job.skuMappings
      .filter((mapping) => mapping.sourceWorkbook && mapping.sourceSheet && mapping.sourceRow !== undefined)
      .map((mapping) => `${mapping.sourceWorkbook}\u0000${mapping.sourceSheet}\u0000${mapping.sourceRow}`),
  );
  const items = context.job.workbookRecords
    .filter((record) => !sku || record.sku.toLowerCase() === sku)
    .map((record) => ({
      sku: record.sku,
      cabinetCode: record.cabinetCode,
      description: record.description,
      sourceWorkbook: record.sourceWorkbook,
      sourceSheet: record.sourceSheet,
      sourceRow: record.sourceRow,
      usedByMapping: usedReferences.has(`${record.sourceWorkbook}\u0000${record.sourceSheet}\u0000${record.sourceRow}`),
      citations: [workbookCitation(context, record)],
    }))
    .filter((record) => !usedOnly || record.usedByMapping);
  const facts = items.map((item) => ({
    text: `SKU ${item.sku} comes from ${item.sourceWorkbook}, ${item.sourceSheet}, row ${item.sourceRow}${item.usedByMapping ? ' and is used by a persisted mapping' : ''}.`,
    citations: item.citations,
  }));
  return result(context, 'workbook_rows', items, facts);
}

export function queryQaBlockers(context: ProjectAssistantContext): AssistantQueryResult<QaBlockerItem[]> {
  const items = context.job.qaResult.criticalIssues.map((issue, index) => ({
    code: issue.code,
    message: issue.message,
    details: issue.details,
    citations: [qaCitation(context, issue, index)],
  }));
  const facts = items.map((item) => ({
    text: `${item.code}: ${item.message}`,
    citations: item.citations,
  }));
  if (!context.job.qaResult.safeToSend && items.length === 0) {
    return result(context, 'qa_blockers', items, facts, [
      'The job is not safe to send, but no persisted critical QA issues explain why.',
    ]);
  }
  return result(context, 'qa_blockers', items, facts);
}

const stateActions: Partial<Record<string, Array<{ code: string; description: string }>>> = {
  created: [{ code: 'INGEST_FILES', description: 'Ingest project plan files and the authoritative workbook.' }],
  files_ingested: [{ code: 'INGEST_WORKBOOK', description: 'Validate and ingest the authoritative cabinet workbook.' }],
  workbook_ingested: [{ code: 'CLASSIFY_PAGES', description: 'Classify the ingested plan pages.' }],
  pages_classified: [{ code: 'DRAFT_UNIT_MIX', description: 'Extract and reconcile the project unit mix.' }],
  unit_mix_drafted: [{ code: 'REVIEW_UNIT_MIX', description: 'Move the drafted unit mix into controlled human review.' }],
  unit_mix_review_required: [{ code: 'VERIFY_UNIT_MIX', description: 'An authorized estimator must review and verify the unit mix.' }],
  takeoff_drafted: [{ code: 'MAP_SKUS', description: 'Resolve takeoff lines against authoritative workbook SKUs.' }],
  sku_mapping_required: [{ code: 'RESOLVE_SKU_MAPPINGS', description: 'Resolve every outstanding SKU mapping.' }],
  pricing_ready: [{ code: 'COMPLETE_BID_REVIEW', description: 'Complete controlled bid review and QA.' }],
  bid_review_required: [{ code: 'COMPLETE_QA', description: 'Resolve QA blockers before the bid can be safe to send.' }],
  failed: [{ code: 'INVESTIGATE_FAILURE', description: 'Inspect the persisted failure and retry only after its cause is resolved.' }],
  project_created: [{ code: 'INGEST_FILES', description: 'Ingest project plan files and the authoritative workbook.' }],
  source_files_ingested: [{ code: 'INGEST_WORKBOOK', description: 'Validate and ingest the authoritative cabinet workbook.' }],
  cabinet_pages_classified: [{ code: 'REVIEW_VISUAL_EXTRACTION', description: 'Review rendered cabinet-plan evidence and record unit types.' }],
  cabinet_pages_extracted: [{ code: 'CREATE_TAKEOFF', description: 'Create the evidence-linked per-unit cabinet takeoff.' }],
  cabinet_takeoff_draft: [{ code: 'APPROVE_TAKEOFF_AND_UNIT_MIX', description: 'Approve every takeoff line and record the evidence-backed unit mix.' }],
  unit_mix_required: [{ code: 'VERIFY_UNIT_MIX', description: 'An authorized estimator must verify every project unit count.' }],
  unit_mix_verified: [{ code: 'MAP_SKUS', description: 'Run deterministic mapping against the authoritative workbook.' }],
  pricing_mapping_required: [{ code: 'COMPILE_ESTIMATE', description: 'Compile project quantities and material cost with deterministic arithmetic.' }],
  cabinet_bid_review_required: [{ code: 'RUN_AND_APPROVE_QA', description: 'Run the QA hard stop and explicitly approve a clean result.' }],
  qa_failed: [{ code: 'CORRECT_QA_FAILURE', description: 'Use the exact QA issues to correct source records, then re-run QA.' }],
  cabinet_bid_safe_to_send: [{ code: 'EXPORT_APPROVED_BID', description: 'Generate an approved customer artifact or outreach draft.' }],
  exported: [],
};

export function queryRemainingActions(context: ProjectAssistantContext): AssistantQueryResult<RemainingAction[]> {
  const workflow = workflowCitation(context);
  const actions: RemainingAction[] = (stateActions[context.job.state] || []).map((action) => ({
    ...action,
    blocking: true,
    citations: [workflow],
  }));

  context.job.skuMappings.forEach((mapping, index) => {
    if (mapping.mappingStatus === 'UNRESOLVED') {
      actions.push({
        code: 'RESOLVE_SKU_MAPPING',
        description: `Resolve cabinet family ${mapping.cabinetFamily} against an authoritative workbook SKU.`,
        blocking: true,
        citations: [mappingCitation(context, mapping, index)],
      });
    }
  });
  context.job.takeoffRows.forEach((row, index) => {
    if (row.reviewRequired) {
      actions.push({
        code: 'REVIEW_TAKEOFF_ITEM',
        description: `Review ${row.cabinetFamily} in ${row.unitType} / ${row.room}.`,
        blocking: true,
        citations: [takeoffCitation(context, row, index), planCitation(context, row, index)],
      });
    }
  });
  context.job.qaResult.criticalIssues.forEach((issue, index) => {
    actions.push({
      code: `QA_${issue.code}`,
      description: issue.message,
      blocking: true,
      citations: [qaCitation(context, issue, index)],
    });
  });

  const unique = actions.filter(
    (action, index, all) =>
      all.findIndex((candidate) => candidate.code === action.code && candidate.description === action.description) === index,
  );
  const facts = unique.map((action) => ({ text: action.description, citations: action.citations }));
  const limitations = (context.job.state === 'safe_to_send' || String(context.job.state) === 'cabinet_bid_safe_to_send') && unique.length === 0
    ? ['No blocking action is represented in the persisted BidJob. Export readiness must still be checked by the controlled export service.']
    : [];
  return result(context, 'remaining_actions', unique, facts, limitations);
}

function logText(log: Record<string, unknown>): string {
  const value = log.event ?? log.action ?? log.type ?? log.message ?? 'audit_event';
  return typeof value === 'string' ? value : 'audit_event';
}

function stringField(log: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = log[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

export function queryAuditSummary(
  context: ProjectAssistantContext,
  args: { limit?: number } = {},
): AssistantQueryResult<{ total: number; events: AuditSummaryEvent[] }> {
  const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 20)));
  const start = Math.max(0, context.job.logs.length - limit);
  const events = context.job.logs.slice(start).map((log, offset) => {
    const index = start + offset;
    const event = logText(log);
    const citation: AssistantCitation = {
      id: citationId('audit_event', context.job.id, index),
      kind: 'audit_event',
      projectId: context.project.projectId,
      jobId: context.job.id,
      entityId: `${context.job.id}:log:${index}`,
      label: `BidJob audit event ${index + 1}: ${event}`,
    };
    return {
      index,
      event,
      actor: stringField(log, 'actor', 'user', 'approvedBy', 'overrideUser'),
      timestamp: stringField(log, 'timestamp', 'createdAt', 'at'),
      citations: [citation],
    };
  });
  const facts = events.map((event) => ({
    text: `${event.event}${event.actor ? ` by ${event.actor}` : ''}${event.timestamp ? ` at ${event.timestamp}` : ''}.`,
    citations: event.citations,
  }));
  return result(context, 'audit_summary', { total: context.job.logs.length, events }, facts);
}

export function executeProjectAssistantQuery(
  context: ProjectAssistantContext,
  request: ProjectAssistantToolRequest,
): AssistantQueryResult {
  assertAssistantQueryTool(request.tool);
  switch (request.tool) {
    case 'workflow_status':
      return queryWorkflowStatus(context);
    case 'unresolved_cabinets':
      return queryUnresolvedCabinets(context, request.args);
    case 'mapping_explanation':
      return queryMappingExplanation(context, request.args);
    case 'workbook_rows':
      return queryWorkbookRows(context, request.args);
    case 'qa_blockers':
      return queryQaBlockers(context);
    case 'remaining_actions':
      return queryRemainingActions(context);
    case 'audit_summary':
      return queryAuditSummary(context, request.args);
  }
}
