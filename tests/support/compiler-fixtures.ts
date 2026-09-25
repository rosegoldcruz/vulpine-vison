import type {
  BidJob,
  CabinetInstance,
  CatalogSku,
  EstimateLine,
  PlanSheet,
  SkuMapping,
  SourceDocument,
  TakeoffLine,
  UnitMixEntry,
  UnitType,
  VisionEvidence,
} from '@/types/canonical';

export const timestamp = '2026-09-25T12:00:00.000Z';

export function unitType(overrides: Partial<UnitType> = {}): UnitType {
  return {
    id: 'unit-a',
    projectId: 'project-1',
    code: 'A1',
    name: 'Unit A1',
    accessibility: 'standard',
    aliases: [],
    ...overrides,
  };
}

export function unitMix(overrides: Partial<UnitMixEntry> = {}): UnitMixEntry {
  return {
    id: 'mix-a',
    projectId: 'project-1',
    unitTypeId: 'unit-a',
    extractedCount: 10,
    verifiedCount: 10,
    evidenceIds: ['evidence-unit'],
    status: 'verified',
    approvedBy: 'estimator-1',
    approvedAt: timestamp,
    ...overrides,
  };
}

export function cabinet(overrides: Partial<CabinetInstance> = {}): CabinetInstance {
  return {
    id: 'cabinet-1',
    projectId: 'project-1',
    unitTypeId: 'unit-a',
    room: 'Kitchen',
    category: 'wall',
    interpretedCode: 'W30',
    widthInches: 30,
    heightInches: 30,
    depthInches: 12,
    quantityPerUnit: 2,
    ada: false,
    evidenceIds: ['evidence-cabinet'],
    confidence: 0.98,
    status: 'approved',
    reviewerId: 'estimator-1',
    ...overrides,
  };
}

export function takeoff(overrides: Partial<TakeoffLine> = {}): TakeoffLine {
  return {
    id: 'takeoff-1',
    bidJobId: 'job-1',
    cabinetInstanceId: 'cabinet-1',
    unitTypeId: 'unit-a',
    quantityPerUnit: 2,
    evidenceIds: ['evidence-cabinet'],
    status: 'approved',
    ...overrides,
  };
}

export function catalogSku(overrides: Partial<CatalogSku> = {}): CatalogSku {
  return {
    id: 'sku-row-1',
    workbookId: 'workbook-1',
    sourceWorkbook: 'pricing.xlsx',
    sourceWorksheet: 'Cabinets',
    sourceRow: 42,
    rawValues: { SKU: 'SKU-W30', Code: 'W30', Cost: 95 },
    sku: 'SKU-W30',
    cabinetCode: 'W30',
    description: 'Wall cabinet 30',
    cabinetFamily: 'wall',
    widthInches: 30,
    heightInches: 30,
    depthInches: 12,
    modifiers: [],
    unitCostCents: 9500,
    active: true,
    ...overrides,
  };
}

export function mapping(overrides: Partial<SkuMapping> = {}): SkuMapping {
  return {
    id: 'mapping-1',
    takeoffLineId: 'takeoff-1',
    catalogSkuId: 'sku-row-1',
    outcome: 'exact_match',
    matchMethod: 'authoritative_code_and_dimensions',
    confidence: 1,
    ...overrides,
  };
}

export function estimateLine(overrides: Partial<EstimateLine> = {}): EstimateLine {
  return {
    id: 'estimate-1',
    bidJobId: 'job-1',
    mappingId: 'mapping-1',
    unitMixEntryId: 'mix-a',
    category: 'cabinet',
    description: 'Wall cabinet 30',
    quantityPerUnit: 2,
    verifiedUnitCount: 10,
    projectQuantity: 20,
    unitCostCents: 9500,
    extendedCostCents: 190000,
    currency: 'USD',
    calculationVersion: 'compiler-v1',
    evidenceIds: ['evidence-cabinet', 'evidence-unit'],
    ...overrides,
  };
}

export function bidJob(overrides: Partial<BidJob> = {}): BidJob {
  return {
    id: 'job-1',
    projectId: 'project-1',
    state: 'cabinet_bid_review_required',
    stateHistory: [],
    unresolvedItemIds: [],
    approvalIds: [],
    artifactIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    ...overrides,
  };
}

export function sourceDocument(overrides: Partial<SourceDocument> = {}): SourceDocument {
  return {
    id: 'document-1',
    projectId: 'project-1',
    originalPath: 'plans/a.pdf',
    storageKey: 'documents/a.pdf',
    fileName: 'a.pdf',
    mimeType: 'application/pdf',
    byteSize: 100,
    sha256: 'abc123',
    ingestionOutcome: 'accepted',
    createdAt: timestamp,
    ...overrides,
  };
}

export function planSheet(overrides: Partial<PlanSheet> = {}): PlanSheet {
  return {
    id: 'sheet-1',
    sourceDocumentId: 'document-1',
    pageNumber: 4,
    sheetNumber: 'A-401',
    title: 'Kitchen Elevations',
    rotation: 0,
    reviewRequired: false,
    ...overrides,
  };
}

export function evidence(
  id: string,
  kind: VisionEvidence['kind'] = 'cabinet',
  overrides: Partial<VisionEvidence> = {},
): VisionEvidence {
  return {
    id,
    projectId: 'project-1',
    planSheetId: 'sheet-1',
    kind,
    region: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
    text: kind === 'unit_mix' ? 'A1: 10 units' : 'W30',
    confidence: 0.98,
    createdAt: timestamp,
    ...overrides,
  };
}
