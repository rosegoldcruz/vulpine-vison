import 'server-only';

import type { ProgressEvent } from '@/types/canonical';

export class ProgressValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProgressValidationError';
    this.code = code;
  }
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ProgressValidationError('INVALID_TIMESTAMP', 'Progress event occurredAt must be a valid ISO timestamp.');
  }
  return parsed;
}

function validateShape(event: ProgressEvent) {
  if (!event.id.trim() || !event.runId.trim() || !event.unit.trim()) {
    throw new ProgressValidationError('MISSING_IDENTITY', 'Progress events require non-empty id, runId, and unit values.');
  }
  if (!Number.isInteger(event.sequence) || event.sequence < 1) {
    throw new ProgressValidationError('INVALID_SEQUENCE', 'Progress sequence must be a positive integer.');
  }
  if (!Number.isInteger(event.completed) || event.completed < 0) {
    throw new ProgressValidationError('INVALID_COMPLETED', 'Progress completed must be a non-negative integer.');
  }
  if (event.total !== undefined && (!Number.isInteger(event.total) || event.total < 0)) {
    throw new ProgressValidationError('INVALID_TOTAL', 'Progress total must be a non-negative integer when provided.');
  }
  if (event.total !== undefined && event.completed > event.total) {
    throw new ProgressValidationError('COMPLETED_EXCEEDS_TOTAL', 'Progress completed cannot exceed total.');
  }
  timestampMs(event.occurredAt);
}

export function validateProgressEvent(next: ProgressEvent, previous?: ProgressEvent): ProgressEvent {
  validateShape(next);
  if (!previous) return next;
  validateShape(previous);

  if (next.runId !== previous.runId) {
    throw new ProgressValidationError('RUN_MISMATCH', 'Progress events from different runs cannot share a stream.');
  }
  if (next.sequence <= previous.sequence) {
    throw new ProgressValidationError('NON_MONOTONIC_SEQUENCE', 'Progress sequence must strictly increase.');
  }
  if (timestampMs(next.occurredAt) < timestampMs(previous.occurredAt)) {
    throw new ProgressValidationError('NON_MONOTONIC_TIME', 'Progress timestamps cannot move backward.');
  }

  if (next.stage === previous.stage && next.unit === previous.unit) {
    if (next.completed < previous.completed) {
      throw new ProgressValidationError('NON_MONOTONIC_COMPLETED', 'Completed work cannot decrease within a stage and unit.');
    }
    if (previous.total !== undefined && next.total === undefined) {
      throw new ProgressValidationError('TOTAL_REMOVED', 'A known total cannot be removed from a progress stream.');
    }
    if (previous.total !== undefined && next.total !== undefined && next.total < previous.total) {
      throw new ProgressValidationError('NON_MONOTONIC_TOTAL', 'Discovered total work cannot decrease.');
    }
  }

  return next;
}

export function appendMonotonicProgress(history: readonly ProgressEvent[], next: ProgressEvent): ProgressEvent[] {
  const latest = history.length ? history[history.length - 1] : undefined;
  validateProgressEvent(next, latest);

  const previousForUnit = [...history]
    .reverse()
    .find((event) => event.runId === next.runId && event.stage === next.stage && event.unit === next.unit);
  if (previousForUnit && previousForUnit !== latest) {
    if (next.completed < previousForUnit.completed) {
      throw new ProgressValidationError('NON_MONOTONIC_COMPLETED', 'Completed work cannot decrease within a stage and unit.');
    }
    if (previousForUnit.total !== undefined && next.total === undefined) {
      throw new ProgressValidationError('TOTAL_REMOVED', 'A known total cannot be removed from a progress stream.');
    }
    if (previousForUnit.total !== undefined && next.total !== undefined && next.total < previousForUnit.total) {
      throw new ProgressValidationError('NON_MONOTONIC_TOTAL', 'Discovered total work cannot decrease.');
    }
  }
  return [...history, next];
}

export function knownProgressPercent(event: ProgressEvent): number | null {
  if (event.total === undefined || event.total <= 0) return null;
  return Math.round((event.completed / event.total) * 10000) / 100;
}

