import 'server-only';

import type { ExecutionStatus, JobRun } from '@/types/canonical';
import { ACTIVE_EXECUTION_STATUSES } from '@/lib/autobidder/processing/execution-control';

export interface StallAssessment {
  stalled: boolean;
  reason?: 'already_stalled' | 'missing_progress_timestamp' | 'progress_timeout';
  lastProgressAt?: string;
  elapsedMs?: number;
}

export interface StallDetectionOptions {
  nowMs?: number;
  thresholdMs: number;
}

function isActivelyExpectedToProgress(status: ExecutionStatus): boolean {
  return ACTIVE_EXECUTION_STATUSES.has(status);
}

export function detectStalledRun(run: JobRun, options: StallDetectionOptions): StallAssessment {
  if (!Number.isFinite(options.thresholdMs) || options.thresholdMs <= 0) {
    throw new RangeError('thresholdMs must be a positive finite number.');
  }
  if (run.status === 'stalled') return { stalled: true, reason: 'already_stalled', lastProgressAt: run.lastProgressAt };
  if (!isActivelyExpectedToProgress(run.status)) return { stalled: false, lastProgressAt: run.lastProgressAt };

  const activityTimestamp = run.lastProgressAt || run.startedAt;
  if (!activityTimestamp) return { stalled: true, reason: 'missing_progress_timestamp' };
  const activityMs = Date.parse(activityTimestamp);
  if (!Number.isFinite(activityMs)) return { stalled: true, reason: 'missing_progress_timestamp' };

  const elapsedMs = Math.max(0, (options.nowMs ?? Date.now()) - activityMs);
  if (elapsedMs >= options.thresholdMs) {
    return {
      stalled: true,
      reason: 'progress_timeout',
      lastProgressAt: activityTimestamp,
      elapsedMs,
    };
  }
  return { stalled: false, lastProgressAt: activityTimestamp, elapsedMs };
}

