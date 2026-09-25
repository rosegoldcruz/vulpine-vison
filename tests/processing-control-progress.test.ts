import { describe, expect, it } from 'vitest';
import type { ProgressEvent } from '@/types/canonical';
import {
  acknowledgeExecutionControl,
  InvalidExecutionControlTransition,
  requestExecutionControl,
} from '@/lib/autobidder/processing/execution-control';
import {
  appendMonotonicProgress,
  knownProgressPercent,
  ProgressValidationError,
  validateProgressEvent,
} from '@/lib/autobidder/processing/progress';

function progress(overrides: Partial<ProgressEvent> = {}): ProgressEvent {
  return {
    id: 'progress-1',
    runId: 'run-1',
    sequence: 1,
    stage: 'rasterizing',
    unit: 'pages',
    completed: 1,
    total: 10,
    occurredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('processing execution controls', () => {
  it('requests pause at a safe point and acknowledges it', () => {
    const requested = requestExecutionControl('extracting', 'pause');
    expect(requested).toEqual({ action: 'pause', from: 'extracting', to: 'pause_requested', changed: true });
    expect(acknowledgeExecutionControl(requested.to)).toBe('paused');
    expect(requestExecutionControl('paused', 'resume').to).toBe('waiting');
  });

  it('cancels inactive work immediately and active work cooperatively', () => {
    expect(requestExecutionControl('waiting', 'cancel').to).toBe('canceled');
    expect(requestExecutionControl('mapping', 'cancel').to).toBe('cancel_requested');
    expect(acknowledgeExecutionControl('cancel_requested')).toBe('canceled');
  });

  it('allows explicit retries only from recoverable stopped states', () => {
    expect(requestExecutionControl('failed', 'retry').to).toBe('waiting');
    expect(requestExecutionControl('stalled', 'retry').to).toBe('waiting');
    expect(() => requestExecutionControl('completed', 'retry')).toThrow(InvalidExecutionControlTransition);
    expect(() => requestExecutionControl('canceled', 'resume')).toThrow(InvalidExecutionControlTransition);
  });

  it('makes repeated pause and cancel requests idempotent', () => {
    expect(requestExecutionControl('pause_requested', 'pause').changed).toBe(false);
    expect(requestExecutionControl('canceled', 'cancel').changed).toBe(false);
  });
});

describe('monotonic processing progress', () => {
  it('accepts increasing completed and discovered totals', () => {
    const first = progress();
    const next = progress({ id: 'progress-2', sequence: 2, completed: 4, total: 12, occurredAt: '2026-01-01T00:00:10.000Z' });
    expect(validateProgressEvent(next, first)).toBe(next);
    expect(knownProgressPercent(next)).toBeCloseTo(33.33, 2);
  });

  it('rejects decreasing sequence, time, completed work, or known totals', () => {
    const first = progress({ completed: 4, total: 10 });
    expect(() => validateProgressEvent(progress({ sequence: 1, completed: 5 }), first)).toThrow(ProgressValidationError);
    expect(() =>
      validateProgressEvent(
        progress({ sequence: 2, completed: 5, occurredAt: '2025-12-31T23:59:59.000Z' }),
        first,
      ),
    ).toThrowError(/timestamps cannot move backward/i);
    expect(() =>
      validateProgressEvent(progress({ sequence: 2, completed: 3, occurredAt: '2026-01-01T00:00:01.000Z' }), first),
    ).toThrowError(/cannot decrease/i);
    expect(() =>
      validateProgressEvent(progress({ sequence: 2, completed: 5, total: 9, occurredAt: '2026-01-01T00:00:01.000Z' }), first),
    ).toThrowError(/total work cannot decrease/i);
  });

  it('tracks monotonic work across interleaved stage streams', () => {
    const history = [
      progress({ completed: 4 }),
      progress({ id: 'progress-2', sequence: 2, stage: 'classifying', completed: 1, occurredAt: '2026-01-01T00:00:01.000Z' }),
    ];
    const regressed = progress({ id: 'progress-3', sequence: 3, completed: 3, occurredAt: '2026-01-01T00:00:02.000Z' });
    expect(() => appendMonotonicProgress(history, regressed)).toThrowError(/cannot decrease/i);
  });

  it('does not invent a percentage when the denominator is unknown', () => {
    expect(knownProgressPercent(progress({ total: undefined }))).toBeNull();
    expect(() => validateProgressEvent(progress({ completed: 11, total: 10 }))).toThrowError(/cannot exceed total/i);
  });
});

