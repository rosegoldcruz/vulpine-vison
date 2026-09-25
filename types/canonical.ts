export type EntityId = string;
export type IsoTimestamp = string;

export type WorkflowState =
  | 'project_created'
  | 'source_files_ingested'
  | 'workbook_ingested'
  | 'cabinet_pages_classified'
  | 'cabinet_pages_extracted'
  | 'cabinet_takeoff_draft'
  | 'unit_mix_required'
  | 'unit_mix_verified'
  | 'sku_mapping_required'
  | 'pricing_mapping_required'
  | 'cabinet_bid_review_required'
  | 'qa_failed'
  | 'cabinet_bid_safe_to_send'
  | 'exported';

export type ExecutionStatus =
  | 'waiting'
  | 'validating'
  | 'uploading'
  | 'rasterizing'
  | 'classifying'
  | 'extracting'
  | 'mapping'
  | 'qa_checking'
  | 'retry_wait'
  | 'pause_requested'
  | 'paused'
  | 'cancel_requested'
  | 'canceled'
  | 'stalled'
  | 'failed'
  | 'completed';

export type UserRole = 'estimator' | 'reviewer' | 'approver' | 'admin' | 'viewer' | 'service';

export interface Principal {
  id: EntityId;
  kind: 'user' | 'service';
  displayName: string;
  role: UserRole;
  organizationId: EntityId;
  scopes: string[];
}

export interface Project {
  id: EntityId;
  organizationId: EntityId;
  name: string;
  customerName?: string;
  projectAddress?: string;
  currency: string;
  createdBy: EntityId;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  version: number;
}

export interface WorkflowTransition {
  id: EntityId;
  bidJobId: EntityId;
  from: WorkflowState | null;
  to: WorkflowState;
  accepted: boolean;
  reason?: string;
  actorId: EntityId;
  occurredAt: IsoTimestamp;
}

export interface BidJob {
  id: EntityId;
  projectId: EntityId;
  state: WorkflowState;
  stateHistory: WorkflowTransition[];
  unresolvedItemIds: EntityId[];
  approvalIds: EntityId[];
  artifactIds: EntityId[];
  currentRunId?: EntityId;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  version: number;
}

export interface SourceDocument {
  id: EntityId;
  projectId: EntityId;
  originalPath: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  ingestionOutcome: 'accepted' | 'rejected' | 'duplicate' | 'failed';
  duplicateOfId?: EntityId;
  createdAt: IsoTimestamp;
}

export interface PlanSheet {
  id: EntityId;
  sourceDocumentId: EntityId;
  pageNumber: number;
  sheetNumber?: string;
  title?: string;
  widthPoints?: number;
  heightPoints?: number;
  rotation: 0 | 90 | 180 | 270;
  renderStorageKey?: string;
  thumbnailStorageKey?: string;
  renderDpi?: number;
  renderWidthPx?: number;
  renderHeightPx?: number;
  classification?: string;
  classificationConfidence?: number;
  classificationEvidence?: string;
  reviewRequired: boolean;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface NormalizedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisionEvidence {
  id: EntityId;
  projectId: EntityId;
  planSheetId: EntityId;
  kind: 'classification' | 'cabinet' | 'unit_mix' | 'dimension' | 'note' | 'measurement' | 'snippet';
  region?: NormalizedRegion;
  text?: string;
  confidence?: number;
  extractionProvider?: string;
  extractionModel?: string;
  createdAt: IsoTimestamp;
}

export interface UnitType {
  id: EntityId;
  projectId: EntityId;
  code: string;
  name: string;
  accessibility: 'standard' | 'ada' | 'type_a' | 'unknown';
  aliases: string[];
}

export interface UnitMixEntry {
  id: EntityId;
  projectId: EntityId;
  unitTypeId: EntityId;
  extractedCount: number;
  verifiedCount?: number;
  evidenceIds: EntityId[];
  discrepancy?: string;
  resolutionNote?: string;
  status: 'unverified' | 'disputed' | 'verified';
  approvedBy?: EntityId;
  approvedAt?: IsoTimestamp;
}

export type CabinetCategory =
  | 'base'
  | 'sink_base'
  | 'drawer_base'
  | 'wall'
  | 'refrigerator_wall'
  | 'microwave_wall'
  | 'tall_pantry'
  | 'vanity'
  | 'ada'
  | 'filler'
  | 'finished_panel'
  | 'toe_kick'
  | 'molding'
  | 'accessory';

export interface CabinetInstance {
  id: EntityId;
  projectId: EntityId;
  unitTypeId: EntityId;
  room: string;
  category: CabinetCategory;
  interpretedCode?: string;
  widthInches?: number;
  heightInches?: number;
  depthInches?: number;
  configuration?: string;
  quantityPerUnit: number;
  ada: boolean;
  evidenceIds: EntityId[];
  confidence?: number;
  planNote?: string;
  status: 'unresolved' | 'review_required' | 'approved';
  reviewerId?: EntityId;
}

export interface TakeoffLine {
  id: EntityId;
  bidJobId: EntityId;
  cabinetInstanceId: EntityId;
  unitTypeId: EntityId;
  quantityPerUnit: number;
  evidenceIds: EntityId[];
  status: 'unresolved' | 'approved' | 'rejected';
}

export interface CatalogSku {
  id: EntityId;
  workbookId: EntityId;
  sourceWorkbook: string;
  sourceWorksheet: string;
  sourceRow: number;
  rawValues: Record<string, unknown>;
  sku: string;
  cabinetCode: string;
  description?: string;
  cabinetFamily?: string;
  widthInches?: number;
  heightInches?: number;
  depthInches?: number;
  finish?: string;
  constructionFamily?: string;
  modifiers: string[];
  unitCostCents?: number;
  sellPriceCents?: number;
  accessoryClassification?: string;
  availability?: string;
  active: boolean;
}

export interface SkuMapping {
  id: EntityId;
  takeoffLineId: EntityId;
  catalogSkuId?: EntityId;
  outcome: 'exact_match' | 'normalized_match' | 'approved_substitution' | 'unresolved';
  matchMethod: string;
  confidence?: number;
  normalizationRuleId?: EntityId;
  approvedBy?: EntityId;
  approvedAt?: IsoTimestamp;
  resolutionNote?: string;
}

export type EstimateCategory =
  | 'cabinet'
  | 'accessory'
  | 'filler'
  | 'panel'
  | 'hardware'
  | 'assembly'
  | 'freight'
  | 'installation'
  | 'tax'
  | 'approved_charge';

export interface EstimateLine {
  id: EntityId;
  bidJobId: EntityId;
  mappingId?: EntityId;
  unitMixEntryId?: EntityId;
  category: EstimateCategory;
  description: string;
  quantityPerUnit?: number;
  verifiedUnitCount?: number;
  projectQuantity: number;
  unitCostCents: number;
  extendedCostCents: number;
  currency: string;
  calculationVersion: string;
  evidenceIds: EntityId[];
}

export interface QAIssue {
  id: EntityId;
  code: string;
  severity: 'critical' | 'warning' | 'information';
  message: string;
  entityType?: string;
  entityId?: EntityId;
  evidenceIds: EntityId[];
  resolved: boolean;
}

export interface QAResult {
  id: EntityId;
  bidJobId: EntityId;
  safeToSend: boolean;
  issues: QAIssue[];
  warnings?: string[];
  informationalNotes?: string[];
  reconciliation: Record<string, { expected: number; actual: number; passed: boolean }>;
  reviewerRequirements: string[];
  executedAt: IsoTimestamp;
  executedBy: 'cabinet_qa_agent';
  calculationVersion: string;
}

export interface Approval {
  id: EntityId;
  projectId: EntityId;
  bidJobId: EntityId;
  type: 'unit_mix' | 'normalization' | 'sku_substitution' | 'pricing' | 'qa' | 'export' | 'outreach';
  targetType: string;
  targetId: EntityId;
  decision: 'approved' | 'rejected' | 'revoked';
  note?: string;
  actorId: EntityId;
  occurredAt: IsoTimestamp;
}

export interface AuditEvent {
  id: EntityId;
  organizationId: EntityId;
  projectId?: EntityId;
  actorId: EntityId;
  actorKind: Principal['kind'];
  action: string;
  resourceType: string;
  resourceId: EntityId;
  correlationId?: string;
  before?: unknown;
  after?: unknown;
  outcome: 'accepted' | 'rejected' | 'failed';
  reason?: string;
  occurredAt: IsoTimestamp;
}

export interface ExportArtifact {
  id: EntityId;
  projectId: EntityId;
  bidJobId: EntityId;
  snapshotId: EntityId;
  format: 'json' | 'csv' | 'xlsx' | 'review_pdf';
  audience: 'internal_review' | 'customer';
  schemaVersion: string;
  status: 'queued' | 'generating' | 'ready' | 'failed';
  storageKey?: string;
  mimeType?: string;
  byteSize?: number;
  sha256?: string;
  generatedBy: EntityId;
  generatedAt?: IsoTimestamp;
  qaResultId?: EntityId;
  warnings: string[];
}

export interface ProgressEvent {
  id: EntityId;
  runId: EntityId;
  sequence: number;
  stage: ExecutionStatus;
  unit: string;
  completed: number;
  total?: number;
  message?: string;
  occurredAt: IsoTimestamp;
}

export interface JobRun {
  id: EntityId;
  bidJobId: EntityId;
  status: ExecutionStatus;
  currentStage?: string;
  lastProgressAt?: IsoTimestamp;
  heartbeatAt?: IsoTimestamp;
  checkpoint?: Record<string, unknown>;
  attempt: number;
  nextAttemptAt?: IsoTimestamp;
  controlReason?: string;
  startedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  version: number;
}
