import type { CabinetObservation, ManualOverride, PricingLine, SkuMapping, UnitMix } from './cabinet';
import type { ProjectManifest } from './project';
import type { QaResult, WorkflowState } from './workflow';
import type { WorkbookRecord } from './workbook';

export interface ProcessingStageTiming {
  stage: string;
  startTime: string;
  endTime: string;
  durationMs: number;
}

export interface ClassifiedPage {
  document: string;
  pageNumber: number;
  sheetNumber?: string;
  sheetTitle?: string;
  classification:
    | 'COVER'
    | 'INDEX'
    | 'GENERAL'
    | 'UNIT_MATRIX'
    | 'FLOOR_PLAN'
    | 'UNIT_PLAN'
    | 'INTERIOR_ELEVATION'
    | 'KITCHEN_ELEVATION'
    | 'BATH_ELEVATION'
    | 'FINISH_SCHEDULE'
    | 'CASEWORK_SCHEDULE'
    | 'APPLIANCE_SCHEDULE'
    | 'ACCESSIBILITY'
    | 'DETAIL'
    | 'IRRELEVANT'
    | 'UNKNOWN';
  confidence: number;
  reason: string;
}

export interface BidJob {
  id: string;
  projectId: string;
  state: WorkflowState;
  createdAt: string;
  updatedAt: string;
  manifest: ProjectManifest;
  workbookRecords: WorkbookRecord[];
  classifiedPages: ClassifiedPage[];
  unitMix: UnitMix[];
  takeoffRows: CabinetObservation[];
  skuMappings: SkuMapping[];
  pricingLines: PricingLine[];
  qaResult: QaResult;
  manualOverrides: ManualOverride[];
  timings: ProcessingStageTiming[];
  logs: Array<Record<string, unknown>>;
  errorMessage?: string;
}
