import type { SourceReference } from './workflow';

export interface UnitMix {
  unitType: string;
  count: number;
  evidence: string;
  confidence: number;
  source: SourceReference;
}

export interface CabinetObservation {
  projectId: string;
  unitType: string;
  room: string;
  sequence: number;
  cabinetFamily: string;
  observedWidth?: number;
  observedHeight?: number;
  observedDepth?: number;
  drawerCount?: number;
  doorCount?: number;
  ada: boolean;
  description: string;
  source: SourceReference;
  reviewRequired: boolean;
}

export interface SkuMapping {
  cabinetFamily: string;
  matchedSku?: string;
  mappingStatus: 'EXACT' | 'NORMALIZED' | 'MANUAL_OVERRIDE' | 'UNRESOLVED';
  unitCostCents?: number;
  sourceWorkbook?: string;
  sourceSheet?: string;
  sourceRow?: number;
  matchReason?: string;
}

export interface PricingLine {
  key: string;
  description: string;
  quantity: number;
  unitCostCents: number;
  totalCostCents: number;
}

export interface ManualOverride {
  field: string;
  originalValue: string;
  overrideValue: string;
  overrideReason: string;
  overrideUser: string;
  overrideTimestamp: string;
}
