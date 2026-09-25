import 'server-only';

import { randomUUID } from 'node:crypto';
import type { BidJob, EntityId, WorkflowState, WorkflowTransition } from '@/types/canonical';

const transitions: Readonly<Record<WorkflowState, readonly WorkflowState[]>> = {
  project_created: ['source_files_ingested'],
  source_files_ingested: ['workbook_ingested'],
  workbook_ingested: ['cabinet_pages_classified'],
  cabinet_pages_classified: ['cabinet_pages_extracted'],
  cabinet_pages_extracted: ['cabinet_takeoff_draft'],
  cabinet_takeoff_draft: ['unit_mix_required'],
  unit_mix_required: ['unit_mix_verified'],
  unit_mix_verified: ['sku_mapping_required'],
  sku_mapping_required: ['pricing_mapping_required'],
  pricing_mapping_required: ['cabinet_bid_review_required'],
  cabinet_bid_review_required: ['qa_failed', 'cabinet_bid_safe_to_send'],
  qa_failed: ['cabinet_bid_review_required'],
  cabinet_bid_safe_to_send: ['exported'],
  exported: [],
};

export class WorkflowTransitionError extends Error {
  readonly code = 'INVALID_WORKFLOW_TRANSITION';

  constructor(
    readonly from: WorkflowState,
    readonly to: WorkflowState,
  ) {
    super(`Invalid workflow transition: ${from} -> ${to}`);
  }
}

export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  return transitions[from].includes(to);
}

export function createTransitionAttempt(args: {
  bidJobId: EntityId;
  from: WorkflowState;
  to: WorkflowState;
  actorId: EntityId;
  reason?: string;
  now?: string;
}): WorkflowTransition {
  const accepted = canTransition(args.from, args.to);
  return {
    id: randomUUID(),
    bidJobId: args.bidJobId,
    from: args.from,
    to: args.to,
    accepted,
    reason: accepted ? args.reason : args.reason || `Transition ${args.from} -> ${args.to} is not allowed.`,
    actorId: args.actorId,
    occurredAt: args.now || new Date().toISOString(),
  };
}

export function applyTransition(
  job: BidJob,
  to: WorkflowState,
  actorId: EntityId,
  reason?: string,
  now?: string,
): { job: BidJob; attempt: WorkflowTransition } {
  const attempt = createTransitionAttempt({ bidJobId: job.id, from: job.state, to, actorId, reason, now });
  const next: BidJob = {
    ...job,
    stateHistory: [...job.stateHistory, attempt],
    updatedAt: attempt.occurredAt,
    version: job.version + 1,
  };

  if (!attempt.accepted) throw Object.assign(new WorkflowTransitionError(job.state, to), { attemptedJob: next, attempt });
  return { job: { ...next, state: to }, attempt };
}

export function requiredNextStates(state: WorkflowState): readonly WorkflowState[] {
  return transitions[state];
}

