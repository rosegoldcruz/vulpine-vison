export const PIPELINE_STAGES = [
  'lead_received',
  'plans_received',
  'ingestion',
  'takeoff',
  'review',
  'ready_to_send',
  'bid_sent',
  'follow_up',
  'awarded',
  'lost',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface MoneyValue {
  amountCents: number;
  currency: string;
}

export interface DealRecord {
  id: string;
  projectId: string;
  stage: PipelineStage;
  stageEnteredAt: string;
  bidAmount?: MoneyValue | null;
  unitCount?: number | null;
  qaStatus?: 'pending' | 'passed' | 'failed' | null;
  submittedAt?: string | null;
  awardedAt?: string | null;
  lostAt?: string | null;
}

export const OPERATING_EVENT_TYPES = [
  'lead_received',
  'plan_package_ingested',
  'takeoff_completed',
  'review_completed',
  'bid_ready',
  'bid_sent',
  'outreach_activity',
  'award_recorded',
] as const;

export type OperatingEventType = (typeof OPERATING_EVENT_TYPES)[number];

export interface OperatingEvent {
  id: string;
  type: OperatingEventType;
  occurredAt: string;
  projectId?: string;
  dealId?: string;
}

export type CompletedBidStatus = 'approved' | 'submitted' | 'awarded' | 'lost';

export interface CompletedBidRecord {
  id: string;
  projectId: string;
  projectName: string;
  customerId?: string | null;
  customerName?: string | null;
  status: CompletedBidStatus;
  effectiveAt: string;
  bidAmount: MoneyValue;
  expectedRevenue?: MoneyValue | null;
  realizedRevenue?: MoneyValue | null;
  market?: string | null;
  consultant?: string | null;
  cabinetLine?: string | null;
}

export interface FreightQuote {
  id: string;
  status: 'draft' | 'approved' | 'rejected' | 'expired';
  amount: MoneyValue;
  approvedAt?: string | null;
  provider?: string | null;
}

export interface MapRouteEstimate {
  provider: string;
  retrievedAt: string;
  originLabel: string;
  destinationLabel: string;
  distanceMeters: number;
  durationSeconds?: number | null;
  estimatedFreight?: MoneyValue | null;
}
