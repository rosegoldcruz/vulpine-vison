import 'server-only';
import type { WorkflowState } from '@/types';

const allowedTransitions: Record<WorkflowState, WorkflowState[]> = {
  created: ['files_ingested', 'failed'],
  files_ingested: ['workbook_ingested', 'failed'],
  workbook_ingested: ['pages_classified', 'failed'],
  pages_classified: ['unit_mix_drafted', 'failed'],
  unit_mix_drafted: ['unit_mix_review_required', 'failed'],
  unit_mix_review_required: ['takeoff_drafted', 'failed'],
  takeoff_drafted: ['sku_mapping_required', 'failed'],
  sku_mapping_required: ['pricing_ready', 'failed'],
  pricing_ready: ['bid_review_required', 'failed'],
  bid_review_required: ['safe_to_send', 'failed'],
  safe_to_send: [],
  failed: [],
};

export function assertTransition(from: WorkflowState, to: WorkflowState) {
  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`Invalid workflow transition: ${from} -> ${to}`);
  }
}

export function nextState(current: WorkflowState, target: WorkflowState): WorkflowState {
  assertTransition(current, target);
  return target;
}
