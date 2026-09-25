import 'server-only';

import { buildProvenanceIndex, traceProjectEvidence } from '@/lib/autobidder/compiler/provenance';
import type { EntityId, EstimateCategory } from '@/types/canonical';
import {
  EXPORT_SNAPSHOT_SCHEMA_VERSION,
  ExportSnapshotError,
  type BuildExportSnapshotInput,
  type CabinetExportSnapshotV1,
  type ExportProvenanceLink,
} from './contracts';

const INTERNAL_REVIEW_STATES = new Set([
  'cabinet_bid_review_required',
  'qa_failed',
  'cabinet_bid_safe_to_send',
  'exported',
]);
const CUSTOMER_STATES = new Set(['cabinet_bid_safe_to_send', 'exported']);

function byId<T extends { id: EntityId }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function requireValue(value: string, field: string): void {
  if (!value.trim()) {
    throw new ExportSnapshotError('INVALID_EXPORT_INPUT', `${field} is required.`, { field });
  }
}

function assertEntityOwnership(input: BuildExportSnapshotInput): void {
  if (input.bidJob.projectId !== input.project.id) {
    throw new ExportSnapshotError('PROJECT_JOB_MISMATCH', 'Bid job does not belong to the supplied project.');
  }
  if (input.qaResult.bidJobId !== input.bidJob.id) {
    throw new ExportSnapshotError('QA_JOB_MISMATCH', 'QA result does not belong to the supplied bid job.');
  }

  const invalidProjectEntities = [
    ...input.sourceDocuments,
    ...input.evidence,
    ...input.unitTypes,
    ...input.unitMixEntries,
    ...input.cabinetInstances,
  ].filter((entity) => entity.projectId !== input.project.id);
  if (invalidProjectEntities.length > 0) {
    throw new ExportSnapshotError('ENTITY_PROJECT_MISMATCH', 'Export entities span more than one project.', {
      entityIds: invalidProjectEntities.map((entity) => entity.id),
    });
  }

  const invalidJobEntities = [...input.takeoffLines, ...input.estimateLines].filter(
    (entity) => entity.bidJobId !== input.bidJob.id,
  );
  if (invalidJobEntities.length > 0) {
    throw new ExportSnapshotError('ENTITY_JOB_MISMATCH', 'Export entities span more than one bid job.', {
      entityIds: invalidJobEntities.map((entity) => entity.id),
    });
  }
}

function assertExportApproval(input: BuildExportSnapshotInput): void {
  const approval = input.approvals.find(
    (candidate) =>
      candidate.type === 'export' &&
      candidate.decision === 'approved' &&
      candidate.projectId === input.project.id &&
      candidate.bidJobId === input.bidJob.id &&
      (candidate.targetId === input.bidJob.id || candidate.targetId === input.project.id),
  );
  if (!approval) {
    throw new ExportSnapshotError('EXPORT_APPROVAL_REQUIRED', 'An explicit export approval is required.');
  }
}

function assertAudienceGate(input: BuildExportSnapshotInput): void {
  const states = input.audience === 'customer' ? CUSTOMER_STATES : INTERNAL_REVIEW_STATES;
  if (!states.has(input.bidJob.state)) {
    throw new ExportSnapshotError('EXPORT_STATE_BLOCKED', `Workflow state ${input.bidJob.state} cannot be exported for ${input.audience}.`, {
      state: input.bidJob.state,
      audience: input.audience,
    });
  }
  if (input.audience === 'customer' && !input.qaResult.safeToSend) {
    throw new ExportSnapshotError('QA_BLOCK', 'Customer exports require a safe-to-send QA result.', {
      qaResultId: input.qaResult.id,
    });
  }
}

function buildTotals(input: BuildExportSnapshotInput): CabinetExportSnapshotV1['totals'] {
  const totalsByCategory: Partial<Record<EstimateCategory, number>> = {};
  let projectQuantity = 0;
  let grandTotalCents = 0;
  for (const line of input.estimateLines) {
    projectQuantity += line.projectQuantity;
    grandTotalCents += line.extendedCostCents;
    totalsByCategory[line.category] = (totalsByCategory[line.category] ?? 0) + line.extendedCostCents;
  }
  if (![projectQuantity, grandTotalCents, ...Object.values(totalsByCategory)].every(Number.isSafeInteger)) {
    throw new ExportSnapshotError('EXPORT_INTEGER_OVERFLOW', 'Export totals exceed safe integer precision.');
  }
  return {
    currency: input.project.currency,
    lineCount: input.estimateLines.length,
    projectQuantity,
    grandTotalCents,
    totalsByCategory,
  };
}

function buildProvenance(input: BuildExportSnapshotInput): ExportProvenanceLink[] {
  const traces = traceProjectEvidence(
    input.estimateLines.map((line) => line.id),
    buildProvenanceIndex({
      estimateLines: input.estimateLines,
      mappings: input.skuMappings,
      takeoffLines: input.takeoffLines,
      cabinetInstances: input.cabinetInstances,
      unitMixEntries: input.unitMixEntries,
      catalogSkus: input.catalogSkus,
      evidence: input.evidence,
      planSheets: input.planSheets,
      sourceDocuments: input.sourceDocuments,
    }),
  );

  return traces
    .map((trace): ExportProvenanceLink => ({
      estimateLineId: trace.estimateLine.id,
      mappingId: trace.mapping?.id,
      takeoffLineId: trace.takeoffLine?.id,
      cabinetInstanceId: trace.cabinetInstance?.id,
      unitMixEntryId: trace.unitMixEntry?.id,
      catalogSkuId: trace.catalogSku?.id,
      workbookSource: trace.workbookSource,
      evidence: trace.evidence
        .map((item) => ({
          evidenceId: item.evidence.id,
          planSheetId: item.planSheet?.id,
          sourceDocumentId: item.sourceDocument?.id,
          sourceDocumentSha256: item.sourceDocument?.sha256,
          pageNumber: item.planSheet?.pageNumber,
          sheetNumber: item.planSheet?.sheetNumber,
          region: item.evidence.region,
        }))
        .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
      missing: uniqueSorted(trace.missing),
      complete: trace.complete,
    }))
    .sort((left, right) => left.estimateLineId.localeCompare(right.estimateLineId));
}

export function buildExportSnapshot(input: BuildExportSnapshotInput): CabinetExportSnapshotV1 {
  requireValue(input.snapshotId, 'snapshotId');
  requireValue(input.createdAt, 'createdAt');
  requireValue(input.createdBy, 'createdBy');
  assertEntityOwnership(input);
  assertExportApproval(input);
  assertAudienceGate(input);

  const provenance = buildProvenance(input);
  const incompleteLineIds = provenance.filter((trace) => !trace.complete).map((trace) => trace.estimateLineId);
  if (input.audience === 'customer' && incompleteLineIds.length > 0) {
    throw new ExportSnapshotError('PROVENANCE_INCOMPLETE', 'Customer exports require complete estimate provenance.', {
      estimateLineIds: incompleteLineIds,
    });
  }

  const warnings = uniqueSorted([
    ...(input.qaResult.safeToSend ? [] : ['INTERNAL REVIEW ONLY — QA has not marked this bid safe to send.']),
    ...(incompleteLineIds.length > 0
      ? [`Incomplete provenance for estimate lines: ${incompleteLineIds.sort().join(', ')}`]
      : []),
  ]);

  return structuredClone({
    schemaVersion: EXPORT_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: input.snapshotId,
    audience: input.audience,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    project: input.project,
    bidJob: input.bidJob,
    qaResult: input.qaResult,
    approvals: byId(input.approvals),
    assumptions: uniqueSorted(input.assumptions ?? []),
    warnings,
    totals: buildTotals(input),
    entities: {
      sourceDocuments: byId(input.sourceDocuments),
      planSheets: byId(input.planSheets),
      evidence: byId(input.evidence),
      unitTypes: byId(input.unitTypes),
      unitMixEntries: byId(input.unitMixEntries),
      cabinetInstances: byId(input.cabinetInstances),
      takeoffLines: byId(input.takeoffLines),
      catalogSkus: byId(input.catalogSkus),
      skuMappings: byId(input.skuMappings),
      estimateLines: byId(input.estimateLines),
    },
    provenance,
  } satisfies CabinetExportSnapshotV1);
}
