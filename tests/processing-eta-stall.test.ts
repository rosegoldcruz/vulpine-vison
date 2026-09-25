import { describe, expect, it } from 'vitest';
import type { JobRun, ProgressEvent } from '@/types/canonical';
import { estimateRollingEta } from '@/lib/autobidder/processing/eta';
import { detectStalledRun } from '@/lib/autobidder/processing/stall-detection';

const BASE_TIME = Date.parse('2026-01-01T00:00:00.000Z');

function sample(sequence: number, seconds: number, completed: number, total = 90): ProgressEvent {
  return {
    id: `progress-${sequence}`,
    runId: 'run-1',
    sequence,
    stage: 'extracting',
    unit: 'pages',
    completed,
    total,
    occurredAt: new Date(BASE_TIME + seconds * 1_000).toISOString(),
  };
}

function run(overrides: Partial<JobRun> = {}): JobRun {
  return {
    id: 'run-1',
    bidJobId: 'job-1',
    status: 'extracting',
    attempt: 1,
    version: 1,
    startedAt: new Date(BASE_TIME).toISOString(),
    lastProgressAt: new Date(BASE_TIME + 10_000).toISOString(),
    ...overrides,
  };
}

describe('rolling throughput ETA', () => {
  it('uses recent completed work to return an observed range', () => {
    const estimate = estimateRollingEta([sample(1, 0, 0), sample(2, 10, 10), sample(3, 20, 30)], {
      stage: 'extracting',
      unit: 'pages',
      status: 'extracting',
      nowMs: BASE_TIME + 25_000,
    });

    expect(estimate).toMatchObject({ lowerSeconds: 30, upperSeconds: 60, samplesUsed: 2 });
    expect(estimate?.label).toBe('about 30–60 seconds');
  });

  it('returns null with insufficient observations or an unknown denominator', () => {
    expect(
      estimateRollingEta([sample(1, 0, 0), sample(2, 10, 10)], {
        stage: 'extracting',
        unit: 'pages',
        status: 'extracting',
        nowMs: BASE_TIME + 10_000,
      }),
    ).toBeNull();
    expect(
      estimateRollingEta(
        [sample(1, 0, 0, undefined as unknown as number), sample(2, 10, 10, undefined as unknown as number), sample(3, 20, 30, undefined as unknown as number)].map(
          (event) => ({ ...event, total: undefined }),
        ),
        { stage: 'extracting', unit: 'pages', status: 'extracting', nowMs: BASE_TIME + 20_000 },
      ),
    ).toBeNull();
  });

  it('suppresses ETA while paused or stalled and when progress is stale', () => {
    const events = [sample(1, 0, 0), sample(2, 10, 10), sample(3, 20, 30)];
    expect(
      estimateRollingEta(events, { stage: 'extracting', unit: 'pages', status: 'paused', nowMs: BASE_TIME + 20_000 }),
    ).toBeNull();
    expect(
      estimateRollingEta(events, {
        stage: 'extracting',
        unit: 'pages',
        status: 'extracting',
        stalled: true,
        nowMs: BASE_TIME + 20_000,
      }),
    ).toBeNull();
    expect(
      estimateRollingEta(events, {
        stage: 'extracting',
        unit: 'pages',
        status: 'extracting',
        nowMs: BASE_TIME + 200_000,
        staleAfterMs: 30_000,
      }),
    ).toBeNull();
  });
});

describe('stalled run detection', () => {
  it('marks an active run stalled at the configured threshold', () => {
    expect(detectStalledRun(run(), { nowMs: BASE_TIME + 39_999, thresholdMs: 30_000 }).stalled).toBe(false);
    expect(detectStalledRun(run(), { nowMs: BASE_TIME + 40_000, thresholdMs: 30_000 })).toMatchObject({
      stalled: true,
      reason: 'progress_timeout',
      elapsedMs: 30_000,
    });
  });

  it('does not classify paused, waiting, or completed work as stalled', () => {
    for (const status of ['paused', 'waiting', 'completed'] as const) {
      expect(detectStalledRun(run({ status }), { nowMs: BASE_TIME + 1_000_000, thresholdMs: 30_000 }).stalled).toBe(false);
    }
  });

  it('fails safe when an active run has no valid progress timestamp', () => {
    expect(detectStalledRun(run({ lastProgressAt: undefined, startedAt: undefined }), { thresholdMs: 30_000 })).toMatchObject({
      stalled: true,
      reason: 'missing_progress_timestamp',
    });
  });
});

