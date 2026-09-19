import 'server-only';

export interface SourceTrace {
  document: string;
  pageNumber: number;
  sheetNumber?: string;
  sheetTitle?: string;
  sourceView?: string;
  confidence?: number;
}

export interface ObservedCabinet {
  id: string;
  projectId: string;
  unitType?: string;
  room?: string;
  sequence?: number;
  observedLabel?: string;
  observedWidth?: number;
  observedHeight?: number;
  observedDepth?: number;
  observedDoorCount?: number;
  observedDrawerCount?: number;
  observedAda?: boolean;
  trace: SourceTrace;
}

export interface ObservedUnitTag {
  id: string;
  projectId: string;
  unitType: string;
  quantity?: number;
  trace: SourceTrace;
}
