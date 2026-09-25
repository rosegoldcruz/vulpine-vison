import 'server-only';

import type {
  BidJob,
  CabinetInstance,
  CatalogSku,
  EntityId,
  EstimateLine,
  IsoTimestamp,
  QAIssue,
  QAResult,
  SkuMapping,
  TakeoffLine,
  UnitMixEntry,
} from '@/types/canonical';
import { uniqueStrings } from './invariants';

export const QA_HARD_STOP_CODES = [
  'UNIT_MIX_NOT_VERIFIED',
  'UNRESOLVED_CABINET_ITEM',
  'UNMAPPED_SKU',
  'INVALID_WORKBOOK_REFERENCE',
  'MISSING_UNIT_COST',
  'QUANTITY_INCONSISTENCY',
  'CONFLICTING_PROJECT_COUNTS',
  'UNSUPPORTED_NORMALIZATION',
  'UNRESOLVED_ADA_CONDITION',
  'MISSING_SOURCE_EVIDENCE',
  'ARITHMETIC_RECONCILIATION_FAILED',
  'INCOMPLETE_PROJECT_SCOPE',
] as const;

export type QaHardStopCode = (typeof QA_HARD_STOP_CODES)[number];

export interface RunQaInput {
  qaResultId: EntityId;
  bidJob: BidJob;
  executedAt: IsoTimestamp;
  calculationVersion: string;
  unitMixEntries: readonly UnitMixEntry[];
  takeoffLines: readonly TakeoffLine[];
  cabinetInstances: readonly CabinetInstance[];
  mappings: readonly SkuMapping[];
  catalogSkus: readonly CatalogSku[];
  estimateLines: readonly EstimateLine[];
  authoritativeWorkbookIds: readonly EntityId[];
  approvedNormalizationRuleIds?: readonly EntityId[];
  availableEvidenceIds: readonly EntityId[];
  scopeComplete: boolean;
}

function issue(
  input: RunQaInput,
  code: QaHardStopCode,
  message: string,
  entityType?: string,
  entityId?: EntityId,
  evidenceIds: EntityId[] = [],
): QAIssue {
  return {
    id: `${input.qaResultId}:${code}:${entityId ?? 'job'}`,
    code,
    severity: 'critical',
    message,
    entityType,
    entityId,
    evidenceIds: uniqueStrings(evidenceIds),
    resolved: false,
  };
}

export function runCabinetQa(input: RunQaInput): QAResult {
  const issues: QAIssue[] = [];
  const unitMixById = new Map(input.unitMixEntries.map((entry) => [entry.id, entry]));
  const takeoffById = new Map(input.takeoffLines.map((line) => [line.id, line]));
  const cabinetById = new Map(input.cabinetInstances.map((cabinet) => [cabinet.id, cabinet]));
  const mappingById = new Map(input.mappings.map((mapping) => [mapping.id, mapping]));
  const mappingByTakeoff = new Map(input.mappings.map((mapping) => [mapping.takeoffLineId, mapping]));
  const skuById = new Map(input.catalogSkus.map((sku) => [sku.id, sku]));
  const authoritativeWorkbookIds = new Set(input.authoritativeWorkbookIds);
  const approvedRules = new Set(input.approvedNormalizationRuleIds ?? []);
  const availableEvidence = new Set(input.availableEvidenceIds);

  if (input.unitMixEntries.length === 0) {
    issues.push(issue(input, 'UNIT_MIX_NOT_VERIFIED', 'No verified unit mix entries exist.'));
  }
  if (input.takeoffLines.length === 0 || input.cabinetInstances.length === 0) {
    issues.push(issue(input, 'UNRESOLVED_CABINET_ITEM', 'No approved cabinet takeoff exists.'));
  }

  for (const entry of input.unitMixEntries) {
    if (
      entry.status !== 'verified' ||
      entry.verifiedCount === undefined ||
      !Number.isSafeInteger(entry.verifiedCount) ||
      entry.verifiedCount < 0 ||
      !entry.approvedBy ||
      !entry.approvedAt
    ) {
      issues.push(issue(input, 'UNIT_MIX_NOT_VERIFIED', 'Unit mix entry is not fully verified.', 'UnitMixEntry', entry.id, entry.evidenceIds));
    }
    if (
      (entry.status === 'disputed' || entry.discrepancy || entry.verifiedCount !== entry.extractedCount) &&
      !entry.resolutionNote?.trim()
    ) {
      issues.push(issue(input, 'CONFLICTING_PROJECT_COUNTS', 'Conflicting project counts remain unresolved.', 'UnitMixEntry', entry.id, entry.evidenceIds));
    }
    if (entry.evidenceIds.length === 0 || entry.evidenceIds.some((id) => !availableEvidence.has(id))) {
      issues.push(issue(input, 'MISSING_SOURCE_EVIDENCE', 'Unit mix source evidence is missing.', 'UnitMixEntry', entry.id, entry.evidenceIds));
    }
  }

  for (const cabinet of input.cabinetInstances) {
    if (cabinet.ada && cabinet.status !== 'approved') {
      const alreadyReported = issues.some(
        (candidate) => candidate.code === 'UNRESOLVED_ADA_CONDITION' && candidate.entityId === cabinet.id,
      );
      if (!alreadyReported) {
        issues.push(issue(input, 'UNRESOLVED_ADA_CONDITION', 'ADA cabinet condition requires explicit review.', 'CabinetInstance', cabinet.id, cabinet.evidenceIds));
      }
    }
  }

  for (const takeoff of input.takeoffLines) {
    const cabinet = cabinetById.get(takeoff.cabinetInstanceId);
    if (takeoff.status !== 'approved' || !cabinet || cabinet.status !== 'approved') {
      issues.push(issue(input, 'UNRESOLVED_CABINET_ITEM', 'Cabinet takeoff item has not been approved.', 'TakeoffLine', takeoff.id, takeoff.evidenceIds));
    }
    if (cabinet && (takeoff.quantityPerUnit !== cabinet.quantityPerUnit || takeoff.unitTypeId !== cabinet.unitTypeId)) {
      issues.push(issue(input, 'QUANTITY_INCONSISTENCY', 'Takeoff quantity or unit type disagrees with its cabinet instance.', 'TakeoffLine', takeoff.id, takeoff.evidenceIds));
    }
    const referencedEvidence = [...takeoff.evidenceIds, ...(cabinet?.evidenceIds ?? [])];
    if (referencedEvidence.length === 0 || referencedEvidence.some((id) => !availableEvidence.has(id))) {
      issues.push(issue(input, 'MISSING_SOURCE_EVIDENCE', 'Cabinet takeoff evidence is missing.', 'TakeoffLine', takeoff.id, referencedEvidence));
    }

    const mapping = mappingByTakeoff.get(takeoff.id);
    if (!mapping || mapping.outcome === 'unresolved' || !mapping.catalogSkuId) {
      issues.push(issue(input, 'UNMAPPED_SKU', 'Takeoff item does not have a resolved catalog mapping.', 'TakeoffLine', takeoff.id, takeoff.evidenceIds));
      continue;
    }
    const sku = skuById.get(mapping.catalogSkuId);
    if (!sku || !sku.active || !authoritativeWorkbookIds.has(sku.workbookId)) {
      issues.push(issue(input, 'INVALID_WORKBOOK_REFERENCE', 'Mapping does not reference an active SKU in an authoritative workbook.', 'SkuMapping', mapping.id));
    } else if (sku.unitCostCents === undefined || !Number.isSafeInteger(sku.unitCostCents) || sku.unitCostCents < 0) {
      issues.push(issue(input, 'MISSING_UNIT_COST', 'Mapped SKU does not have a valid integer unit cost.', 'CatalogSku', sku.id));
    }

    if (
      mapping.outcome === 'normalized_match' &&
      (!mapping.normalizationRuleId || !approvedRules.has(mapping.normalizationRuleId) || !mapping.approvedBy || !mapping.approvedAt)
    ) {
      issues.push(issue(input, 'UNSUPPORTED_NORMALIZATION', 'Normalized mapping lacks an approved normalization rule.', 'SkuMapping', mapping.id));
    }
    if (mapping.outcome === 'approved_substitution' && (!mapping.approvedBy || !mapping.approvedAt)) {
      issues.push(issue(input, 'UNSUPPORTED_NORMALIZATION', 'Substitution lacks explicit approval.', 'SkuMapping', mapping.id));
    }
  }

  const reconciliation: QAResult['reconciliation'] = {};
  for (const line of input.estimateLines) {
    const mapping = line.mappingId ? mappingById.get(line.mappingId) : undefined;
    const takeoff = mapping ? takeoffById.get(mapping.takeoffLineId) : undefined;
    const unitMix = line.unitMixEntryId ? unitMixById.get(line.unitMixEntryId) : undefined;
    const expectedQuantity =
      takeoff && unitMix?.verifiedCount !== undefined
        ? takeoff.quantityPerUnit * unitMix.verifiedCount
        : Number.NaN;
    const quantityPassed = Number.isSafeInteger(expectedQuantity) && line.projectQuantity === expectedQuantity;
    reconciliation[`quantity:${line.id}`] = {
      expected: Number.isFinite(expectedQuantity) ? expectedQuantity : -1,
      actual: line.projectQuantity,
      passed: quantityPassed,
    };
    if (!quantityPassed) {
      issues.push(issue(input, 'QUANTITY_INCONSISTENCY', 'Estimate project quantity does not reconcile to takeoff × verified units.', 'EstimateLine', line.id, line.evidenceIds));
    }

    const expectedCost = line.projectQuantity * line.unitCostCents;
    const arithmeticPassed = Number.isSafeInteger(expectedCost) && line.extendedCostCents === expectedCost;
    reconciliation[`cost:${line.id}`] = {
      expected: Number.isSafeInteger(expectedCost) ? expectedCost : -1,
      actual: line.extendedCostCents,
      passed: arithmeticPassed,
    };
    if (!arithmeticPassed) {
      issues.push(issue(input, 'ARITHMETIC_RECONCILIATION_FAILED', 'Estimate extended cost failed deterministic reconciliation.', 'EstimateLine', line.id, line.evidenceIds));
    }
    const mappedSku = mapping?.catalogSkuId ? skuById.get(mapping.catalogSkuId) : undefined;
    const pricePassed = mappedSku?.unitCostCents !== undefined && line.unitCostCents === mappedSku.unitCostCents;
    reconciliation[`price:${line.id}`] = {
      expected: mappedSku?.unitCostCents ?? -1,
      actual: line.unitCostCents,
      passed: pricePassed,
    };
    if (!pricePassed) {
      issues.push(issue(input, 'ARITHMETIC_RECONCILIATION_FAILED', 'Estimate unit cost does not match its authoritative catalog row.', 'EstimateLine', line.id, line.evidenceIds));
    }
    if (line.evidenceIds.length === 0 || line.evidenceIds.some((id) => !availableEvidence.has(id))) {
      issues.push(issue(input, 'MISSING_SOURCE_EVIDENCE', 'Estimate line evidence is missing.', 'EstimateLine', line.id, line.evidenceIds));
    }
  }

  if (
    !input.scopeComplete ||
    input.estimateLines.length === 0 ||
    !['cabinet_bid_review_required', 'qa_failed'].includes(input.bidJob.state)
  ) {
    issues.push(issue(input, 'INCOMPLETE_PROJECT_SCOPE', 'Project scope has not been declared complete.'));
  }

  const criticalIssues = issues.filter((candidate) => candidate.severity === 'critical' && !candidate.resolved);
  return {
    id: input.qaResultId,
    bidJobId: input.bidJob.id,
    safeToSend: criticalIssues.length === 0,
    issues,
    warnings: [],
    informationalNotes: [
      `Checked ${input.takeoffLines.length} takeoff line(s), ${input.estimateLines.length} estimate line(s), and ${input.unitMixEntries.length} unit mix entry/entries.`,
      `Calculation version ${input.calculationVersion}.`,
    ],
    reconciliation,
    reviewerRequirements: uniqueStrings(criticalIssues.map((candidate) => candidate.message)),
    executedAt: input.executedAt,
    executedBy: 'cabinet_qa_agent',
    calculationVersion: input.calculationVersion,
  };
}
