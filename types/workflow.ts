export type WorkflowState =
  | 'created'
  | 'files_ingested'
  | 'workbook_ingested'
  | 'pages_classified'
  | 'unit_mix_drafted'
  | 'unit_mix_review_required'
  | 'takeoff_drafted'
  | 'sku_mapping_required'
  | 'pricing_ready'
  | 'bid_review_required'
  | 'safe_to_send'
  | 'failed';

export interface SourceReference {
  sourceDocument: string;
  sourcePage: number;
  sourceSheet?: string;
  sourceView?: string;
  confidence?: number;
}

export interface CriticalIssue {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface QaResult {
  safeToSend: boolean;
  criticalIssues: CriticalIssue[];
  warnings: string[];
  assumptions: string[];
  reviewedBy?: string;
  reviewedAt?: string;
}
