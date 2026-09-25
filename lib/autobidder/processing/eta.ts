import 'server-only';

import type { ExecutionStatus, ProgressEvent } from '@/types/canonical';

export interface EtaEstimate {
  lowerSeconds: number;
  upperSeconds: number;
  samplesUsed: number;
  unitsPerSecond: { slow: number; fast: number };
  label: string;
}

export interface EtaOptions {
  stage: ExecutionStatus;
  unit: string;
  status: ExecutionStatus;
  nowMs?: number;
  staleAfterMs?: number;
  minimumIntervals?: number;
  maximumIntervals?: number;
  stalled?: boolean;
}

const ETA_SUPPRESSED_STATUSES = new Set<ExecutionStatus>([
  'waiting',
  'retry_wait',
  'pause_requested',
  'paused',
  'cancel_requested',
  'canceled',
  'stalled',
  'failed',
  'completed',
]);

function rangeLabel(lowerSeconds: number, upperSeconds: number): string {
  if (upperSeconds < 90) {
    const lower = Math.max(5, Math.floor(lowerSeconds / 5) * 5);
    const upper = Math.max(lower, Math.ceil(upperSeconds / 5) * 5);
    return lower === upper ? `about ${lower} seconds` : `about ${lower}–${upper} seconds`;
  }
  const lower = Math.max(1, Math.floor(lowerSeconds / 60));
  const upper = Math.max(lower, Math.ceil(upperSeconds / 60));
  return lower === upper ? `about ${lower} minute${lower === 1 ? '' : 's'}` : `about ${lower}–${upper} minutes`;
}

export function estimateRollingEta(events: readonly ProgressEvent[], options: EtaOptions): EtaEstimate | null {
  if (options.stalled || ETA_SUPPRESSED_STATUSES.has(options.status)) return null;

  const nowMs = options.nowMs ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? 120_000;
  const minimumIntervals = options.minimumIntervals ?? 2;
  const maximumIntervals = options.maximumIntervals ?? 5;
  if (minimumIntervals < 1 || maximumIntervals < minimumIntervals || staleAfterMs <= 0) {
    throw new RangeError('Invalid ETA sampling options.');
  }

  const relevant = events
    .filter((event) => event.stage === options.stage && event.unit === options.unit)
    .map((event) => ({ event, time: Date.parse(event.occurredAt) }))
    .filter((sample) => Number.isFinite(sample.time))
    .sort((a, b) => a.time - b.time || a.event.sequence - b.event.sequence);

  if (relevant.length < minimumIntervals + 1) return null;
  const latest = relevant[relevant.length - 1];
  if (nowMs - latest.time >= staleAfterMs) return null;
  if (latest.event.total === undefined || latest.event.total <= latest.event.completed) return null;

  const rates: number[] = [];
  for (let index = 1; index < relevant.length; index += 1) {
    const previous = relevant[index - 1];
    const current = relevant[index];
    const units = current.event.completed - previous.event.completed;
    const elapsedSeconds = (current.time - previous.time) / 1000;
    if (units > 0 && elapsedSeconds > 0) rates.push(units / elapsedSeconds);
  }

  const recentRates = rates.slice(-maximumIntervals);
  if (recentRates.length < minimumIntervals) return null;
  const slow = Math.min(...recentRates);
  const fast = Math.max(...recentRates);
  if (!Number.isFinite(slow) || slow <= 0 || !Number.isFinite(fast) || fast <= 0) return null;

  const remaining = latest.event.total - latest.event.completed;
  const lowerSeconds = Math.max(1, Math.ceil(remaining / fast));
  const upperSeconds = Math.max(lowerSeconds, Math.ceil(remaining / slow));
  return {
    lowerSeconds,
    upperSeconds,
    samplesUsed: recentRates.length,
    unitsPerSecond: { slow, fast },
    label: rangeLabel(lowerSeconds, upperSeconds),
  };
}

