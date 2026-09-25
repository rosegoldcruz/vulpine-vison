import 'server-only';

import type {
  Approval,
  BidJob,
  CabinetInstance,
  CatalogSku,
  EntityId,
  EstimateCategory,
  EstimateLine,
  IsoTimestamp,
  PlanSheet,
  Project,
  QAResult,
  SkuMapping,
  SourceDocument,
  TakeoffLine,
  UnitMixEntry,
  UnitType,
  VisionEvidence,
} from '@/types/canonical';

export const EXPORT_SNAPSHOT_SCHEMA_VERSION = 'cabinet-export-snapshot/v1' as const;

export type ExportSnapshotSchemaVersion = typeof EXPORT_SNAPSHOT_SCHEMA_VERSION;
export type ExportAudience = 'internal_review' | 'customer';

export interface ExportEvidenceReference {
  evidenceId: EntityId;
  planSheetId?: EntityId;
  sourceDocumentId?: EntityId;
  sourceDocumentSha256?: string;
  pageNumber?: number;
  sheetNumber?: string;
  region?: VisionEvidence['region'];
}

export interface ExportProvenanceLink {
  estimateLineId: EntityId;
  mappingId?: EntityId;
  takeoffLineId?: EntityId;
  cabinetInstanceId?: EntityId;
  unitMixEntryId?: EntityId;
  catalogSkuId?: EntityId;
  workbookSource?: {
    workbook: string;
    worksheet: string;
    row: number;
  };
  evidence: ExportEvidenceReference[];
  missing: string[];
  complete: boolean;
}

export interface ExportSnapshotTotals {
  currency: string;
  lineCount: number;
  projectQuantity: number;
  grandTotalCents: number;
  totalsByCategory: Partial<Record<EstimateCategory, number>>;
}

export interface CabinetExportSnapshotV1 {
  schemaVersion: ExportSnapshotSchemaVersion;
  snapshotId: EntityId;
  audience: ExportAudience;
  createdAt: IsoTimestamp;
  createdBy: EntityId;
  project: Project;
  bidJob: BidJob;
  qaResult: QAResult;
  approvals: Approval[];
  assumptions: string[];
  warnings: string[];
  totals: ExportSnapshotTotals;
  entities: {
    sourceDocuments: SourceDocument[];
    planSheets: PlanSheet[];
    evidence: VisionEvidence[];
    unitTypes: UnitType[];
    unitMixEntries: UnitMixEntry[];
    cabinetInstances: CabinetInstance[];
    takeoffLines: TakeoffLine[];
    catalogSkus: CatalogSku[];
    skuMappings: SkuMapping[];
    estimateLines: EstimateLine[];
  };
  provenance: ExportProvenanceLink[];
}

export interface BuildExportSnapshotInput {
  snapshotId: EntityId;
  audience: ExportAudience;
  createdAt: IsoTimestamp;
  createdBy: EntityId;
  project: Project;
  bidJob: BidJob;
  qaResult: QAResult;
  approvals: readonly Approval[];
  assumptions?: readonly string[];
  sourceDocuments: readonly SourceDocument[];
  planSheets: readonly PlanSheet[];
  evidence: readonly VisionEvidence[];
  unitTypes: readonly UnitType[];
  unitMixEntries: readonly UnitMixEntry[];
  cabinetInstances: readonly CabinetInstance[];
  takeoffLines: readonly TakeoffLine[];
  catalogSkus: readonly CatalogSku[];
  skuMappings: readonly SkuMapping[];
  estimateLines: readonly EstimateLine[];
}

export class ExportSnapshotError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ExportSnapshotError';
  }
}
