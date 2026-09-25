import { describe, expect, it } from 'vitest';
import type { BidJob } from '@/types/canonical';
import { applyTransition, canTransition, WorkflowTransitionError } from '@/lib/autobidder/domain/canonical-workflow';

function job(): BidJob {
  return {
    id: 'job-1',
    projectId: 'project-1',
    state: 'project_created',
    stateHistory: [],
    unresolvedItemIds: [],
    approvalIds: [],
    artifactIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
  };
}

describe('canonical workflow', () => {
  it('permits only explicit prerequisite transitions', () => {
    expect(canTransition('project_created', 'source_files_ingested')).toBe(true);
    expect(canTransition('project_created', 'cabinet_bid_safe_to_send')).toBe(false);
    expect(canTransition('cabinet_bid_safe_to_send', 'exported')).toBe(true);
  });

  it('records accepted transition history', () => {
    const result = applyTransition(job(), 'source_files_ingested', 'user-1', 'plans accepted', '2026-01-02T00:00:00.000Z');
    expect(result.job.state).toBe('source_files_ingested');
    expect(result.job.stateHistory).toHaveLength(1);
    expect(result.attempt.accepted).toBe(true);
  });

  it('returns a rejected attempt for durable audit when a transition is invalid', () => {
    try {
      applyTransition(job(), 'cabinet_bid_safe_to_send', 'user-1');
      throw new Error('expected transition error');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowTransitionError);
      const typed = error as WorkflowTransitionError & { attempt: { accepted: boolean }; attemptedJob: BidJob };
      expect(typed.attempt.accepted).toBe(false);
      expect(typed.attemptedJob.stateHistory).toHaveLength(1);
      expect(typed.attemptedJob.state).toBe('project_created');
    }
  });
});

