import 'server-only';

import type {
  CabinetInstance,
  CatalogSku,
  EntityId,
  EstimateLine,
  PlanSheet,
  SkuMapping,
  SourceDocument,
  TakeoffLine,
  UnitMixEntry,
  VisionEvidence,
} from '@/types/canonical';
import { uniqueStrings } from './invariants';

export interface ProvenanceEntities {
  estimateLines: readonly EstimateLine[];
  mappings: readonly SkuMapping[];
  takeoffLines: readonly TakeoffLine[];
  cabinetInstances: readonly CabinetInstance[];
  unitMixEntries: readonly UnitMixEntry[];
  catalogSkus: readonly CatalogSku[];
  evidence: readonly VisionEvidence[];
  planSheets: readonly PlanSheet[];
  sourceDocuments: readonly SourceDocument[];
}

export interface EvidenceTrace {
  evidence: VisionEvidence;
  planSheet?: PlanSheet;
  sourceDocument?: SourceDocument;
}

export interface EstimateProvenanceTrace {
  estimateLine: EstimateLine;
  mapping?: SkuMapping;
  takeoffLine?: TakeoffLine;
  cabinetInstance?: CabinetInstance;
  unitMixEntry?: UnitMixEntry;
  catalogSku?: CatalogSku;
  evidence: EvidenceTrace[];
  missing: string[];
  complete: boolean;
  workbookSource?: {
    workbook: string;
    worksheet: string;
    row: number;
  };
}

export interface ProvenanceIndex {
  estimateLines: ReadonlyMap<EntityId, EstimateLine>;
  mappings: ReadonlyMap<EntityId, SkuMapping>;
  takeoffLines: ReadonlyMap<EntityId, TakeoffLine>;
  cabinetInstances: ReadonlyMap<EntityId, CabinetInstance>;
  unitMixEntries: ReadonlyMap<EntityId, UnitMixEntry>;
  catalogSkus: ReadonlyMap<EntityId, CatalogSku>;
  evidence: ReadonlyMap<EntityId, VisionEvidence>;
  planSheets: ReadonlyMap<EntityId, PlanSheet>;
  sourceDocuments: ReadonlyMap<EntityId, SourceDocument>;
}

function indexById<T extends { id: EntityId }>(items: readonly T[]): ReadonlyMap<EntityId, T> {
  return new Map(items.map((item) => [item.id, item]));
}

export function buildProvenanceIndex(entities: ProvenanceEntities): ProvenanceIndex {
  return {
    estimateLines: indexById(entities.estimateLines),
    mappings: indexById(entities.mappings),
    takeoffLines: indexById(entities.takeoffLines),
    cabinetInstances: indexById(entities.cabinetInstances),
    unitMixEntries: indexById(entities.unitMixEntries),
    catalogSkus: indexById(entities.catalogSkus),
    evidence: indexById(entities.evidence),
    planSheets: indexById(entities.planSheets),
    sourceDocuments: indexById(entities.sourceDocuments),
  };
}

export function traceEstimateLine(estimateLineId: EntityId, index: ProvenanceIndex): EstimateProvenanceTrace {
  const estimateLine = index.estimateLines.get(estimateLineId);
  if (!estimateLine) {
    throw new Error(`Estimate line ${estimateLineId} was not found.`);
  }

  const missing: string[] = [];
  const mapping = estimateLine.mappingId ? index.mappings.get(estimateLine.mappingId) : undefined;
  if (!mapping) missing.push('SkuMapping');
  const takeoffLine = mapping ? index.takeoffLines.get(mapping.takeoffLineId) : undefined;
  if (!takeoffLine) missing.push('TakeoffLine');
  const cabinetInstance = takeoffLine ? index.cabinetInstances.get(takeoffLine.cabinetInstanceId) : undefined;
  if (!cabinetInstance) missing.push('CabinetInstance');
  const unitMixEntry = estimateLine.unitMixEntryId
    ? index.unitMixEntries.get(estimateLine.unitMixEntryId)
    : undefined;
  if (!unitMixEntry) missing.push('UnitMixEntry');
  const catalogSku = mapping?.catalogSkuId ? index.catalogSkus.get(mapping.catalogSkuId) : undefined;
  if (!catalogSku) missing.push('CatalogSku');

  const evidenceIds = uniqueStrings([
    ...estimateLine.evidenceIds,
    ...(takeoffLine?.evidenceIds ?? []),
    ...(cabinetInstance?.evidenceIds ?? []),
    ...(unitMixEntry?.evidenceIds ?? []),
  ]);
  const evidence = evidenceIds.flatMap((evidenceId): EvidenceTrace[] => {
    const item = index.evidence.get(evidenceId);
    if (!item) {
      missing.push(`VisionEvidence:${evidenceId}`);
      return [];
    }
    const planSheet = index.planSheets.get(item.planSheetId);
    if (!planSheet) missing.push(`PlanSheet:${item.planSheetId}`);
    const sourceDocument = planSheet ? index.sourceDocuments.get(planSheet.sourceDocumentId) : undefined;
    if (planSheet && !sourceDocument) missing.push(`SourceDocument:${planSheet.sourceDocumentId}`);
    return [{ evidence: item, planSheet, sourceDocument }];
  });

  if (evidenceIds.length === 0) missing.push('VisionEvidence');

  return {
    estimateLine,
    mapping,
    takeoffLine,
    cabinetInstance,
    unitMixEntry,
    catalogSku,
    evidence,
    missing: uniqueStrings(missing),
    complete: missing.length === 0,
    workbookSource: catalogSku
      ? {
          workbook: catalogSku.sourceWorkbook,
          worksheet: catalogSku.sourceWorksheet,
          row: catalogSku.sourceRow,
        }
      : undefined,
  };
}

export function traceProjectEvidence(
  estimateLineIds: readonly EntityId[],
  index: ProvenanceIndex,
): EstimateProvenanceTrace[] {
  return estimateLineIds.map((id) => traceEstimateLine(id, index));
}
