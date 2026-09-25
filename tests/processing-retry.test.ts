import { describe, expect, it } from 'vitest';
import {
  boundedExponentialBackoffMs,
  classifyRetryFailure,
  shouldAutomaticallyRetry,
} from '@/lib/autobidder/processing/retry-policy';

describe('processing retry policy', () => {
  it('classifies only recoverable failures as retryable', () => {
    expect(classifyRetryFailure({ code: 'ECONNRESET' })).toMatchObject({ retryable: true, category: 'network' });
    expect(classifyRetryFailure({ code: 'WORKER_RESTARTED' })).toMatchObject({
      retryable: true,
      category: 'worker_restart',
    });
    expect(classifyRetryFailure({ status: 503 })).toMatchObject({ retryable: true, category: 'server' });
    expect(classifyRetryFailure({ status: 429 })).toMatchObject({
      retryable: true,
      category: 'provider_temporary',
    });
  });

  it('never retries deterministic validation or intentional cancellation', () => {
    expect(classifyRetryFailure({ code: 'VALIDATION_ERROR', retryable: true })).toMatchObject({
      retryable: false,
      category: 'validation',
    });
    expect(classifyRetryFailure({ status: 422 })).toMatchObject({ retryable: false, category: 'validation' });
    expect(classifyRetryFailure({ name: 'AbortError' })).toMatchObject({ retryable: false, category: 'canceled' });
    expect(classifyRetryFailure({ status: 501 })).toMatchObject({ retryable: false });
  });

  it('honors automatic retry settings and attempt limits', () => {
    const enabled = { automaticRetries: true, maximumRetryAttempts: 3, retryServerErrors: true };
    expect(shouldAutomaticallyRetry({ status: 503 }, 3, enabled).retryable).toBe(true);
    expect(shouldAutomaticallyRetry({ status: 503 }, 4, enabled).retryable).toBe(false);
    expect(
      shouldAutomaticallyRetry({ status: 503 }, 1, { ...enabled, retryServerErrors: false }).retryable,
    ).toBe(false);
    expect(
      shouldAutomaticallyRetry({ code: 'ECONNRESET' }, 1, { ...enabled, automaticRetries: false }).retryable,
    ).toBe(false);
  });

  it('uses bounded exponential backoff without overflow', () => {
    expect([1, 2, 3, 4, 5].map((attempt) => boundedExponentialBackoffMs(attempt, 1_000, 8_000))).toEqual([
      1_000,
      2_000,
      4_000,
      8_000,
      8_000,
    ]);
    expect(boundedExponentialBackoffMs(500, 1_000, 60_000)).toBe(60_000);
    expect(() => boundedExponentialBackoffMs(0, 1_000, 8_000)).toThrow(RangeError);
    expect(() => boundedExponentialBackoffMs(1, 10_000, 1_000)).toThrow(RangeError);
  });
});

