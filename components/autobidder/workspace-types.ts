export interface WorkspaceProject {
  projectId: string;
  projectName: string;
  pageCount: number;
  processingStatus: string;
  files?: Array<{ id: string; name: string; path: string; size: number; mimeType: string }>;
  pdfFiles?: Array<{ id: string; name: string; path: string; size: number; mimeType: string }>;
  workbookFiles?: Array<{ id: string; name: string; path: string; size: number; mimeType: string }>;
}

export interface WorkspaceJob {
  id: string;
  state: string;
  classifiedPages?: Array<{ document: string; pageNumber: number; classification: string; confidence: number; reason: string }>;
  unitMix?: Array<{ unitType: string; count: number; confidence: number; evidence: string }>;
  takeoffRows?: Array<{
    unitType: string;
    room: string;
    cabinetFamily: string;
    observedWidth?: number;
    observedHeight?: number;
    observedDepth?: number;
    description: string;
    reviewRequired: boolean;
  }>;
  skuMappings?: Array<{ cabinetFamily: string; matchedSku?: string; mappingStatus: string; unitCostCents?: number; sourceSheet?: string; sourceRow?: number }>;
  pricingLines?: Array<{ key: string; description: string; quantity: number; unitCostCents: number; totalCostCents: number }>;
  qaResult: {
    safeToSend: boolean;
    criticalIssues: Array<{ code: string; message: string }>;
    warnings: string[];
    assumptions: string[];
  };
  manifest: {
    pageCount: number;
    files: Array<{ id?: string; name: string; size?: number; mimeType?: string }>;
    pdfFiles: Array<{ name: string }>;
    workbookFiles: Array<{ name: string }>;
  };
}

export interface WorkspaceRun {
  id: string;
  status: string;
  currentStage?: string;
  lastProgressAt?: string;
}

export interface WorkspaceRunDiagnostics {
  stall: { stalled: boolean; reason?: string; elapsedMs?: number };
  eta: { lowerSeconds: number; upperSeconds: number; samplesUsed: number } | null;
  retry: { automatic: boolean; maximumAttempts: number; attempt: number; nextAttemptAt?: string };
  controls: { canPause: boolean; canResume: boolean; canCancel: boolean; canRetry: boolean; canRemove: boolean };
  failureCause?: string;
}

export interface WorkspaceProgressEvent {
  id: string;
  sequence: number;
  stage: string;
  unit: string;
  completed: number;
  total?: number;
  message?: string;
  occurredAt: string;
}

export interface WorkspacePlanSheet {
  id: string;
  sourceDocumentId: string;
  sourceFileName: string;
  pageNumber: number;
  sheetNumber?: string;
  title?: string;
  classification?: string;
  classificationConfidence?: number;
  reviewRequired: boolean;
  renderStorageKey?: string;
  renderWidthPx?: number;
  renderHeightPx?: number;
}

export interface WorkspaceFileQueueItem {
  id: string;
  sourceDocumentId: string;
  fileName: string;
  originalPath: string;
  status: string;
  stage?: string;
  completedUnits: number;
  totalUnits?: number;
  attempt: number;
  failureCode?: string;
  failureReason?: string;
}

export interface WorkspaceIngestionManifest {
  manifestId: string;
  entries: Array<{ entryId: string; ordinal: number; originalPath: string; normalizedPath: string; baseName: string; kind: string; outcome: string; reasonCode?: string; reason?: string; sizeBytes: number }>;
  summary: { total: number; supported: number; rejected: number; duplicate: number; failed: number };
}

export interface WorkspaceCanonicalSnapshot {
  job: { id: string; projectId: string; state: string; unresolvedItemIds: string[]; stateHistory: Array<{ id: string; from?: string; to: string; accepted: boolean; actorId: string; occurredAt: string }> };
  unitTypes: Array<{ id: string; code: string; name: string; accessibility: string }>;
  unitMixEntries: Array<{ id: string; unitTypeId: string; extractedCount: number; verifiedCount?: number; status: string; evidenceIds: string[]; discrepancy?: string; resolutionNote?: string; approvedBy?: string; approvedAt?: string }>;
  cabinetInstances: Array<{ id: string; unitTypeId: string; room: string; category: string; interpretedCode?: string; widthInches?: number; heightInches?: number; depthInches?: number; quantityPerUnit: number; evidenceIds: string[]; status: string }>;
  takeoffLines: Array<{ id: string; cabinetInstanceId: string; unitTypeId: string; quantityPerUnit: number; status: string; evidenceIds: string[] }>;
  catalogSkus: Array<{ id: string; sku: string; cabinetCode: string; description?: string; sourceWorkbook: string; sourceWorksheet: string; sourceRow: number; unitCostCents?: number }>;
  mappings: Array<{ id: string; takeoffLineId: string; catalogSkuId?: string; outcome: string; matchMethod: string; resolutionNote?: string }>;
  estimateLines: Array<{ id: string; mappingId?: string; unitMixEntryId?: string; description: string; projectQuantity: number; unitCostCents: number; extendedCostCents: number; currency: string; evidenceIds: string[] }>;
  qaResults: Array<{ id: string; safeToSend: boolean; issues: Array<{ id: string; code: string; severity: string; message: string; resolved: boolean; evidenceIds: string[] }>; reviewerRequirements: string[]; executedAt: string }>;
  approvals: Array<{ id: string; type: string; decision: string; actorId: string; occurredAt: string }>;
  visionEvidence: Array<{ id: string; planSheetId: string; kind: string; region?: { x: number; y: number; width: number; height: number }; text?: string; confidence?: number; createdAt: string }>;
}
