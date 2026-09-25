import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROCESSING_SETTINGS,
  normalizeProcessingSettings,
  ProcessingSettingsValidationError,
  restoreProcessingDefaults,
} from '@/lib/autobidder/processing/settings';

describe('processing settings', () => {
  it('returns independent default values for restore defaults', () => {
    const first = restoreProcessingDefaults();
    const second = restoreProcessingDefaults();
    expect(first).toEqual(DEFAULT_PROCESSING_SETTINGS);
    expect(first).not.toBe(second);
    expect(first.processingDefaults).not.toBe(second.processingDefaults);
  });

  it('clamps retry, delay, concurrency, and stall values to safety limits', () => {
    const settings = normalizeProcessingSettings(
      {
        maximumRetryAttempts: 99,
        retryBaseDelayMs: 1,
        retryMaximumDelayMs: 99_000_000,
        workerConcurrency: 200,
        stallThresholdMs: 1,
      },
      { maximumWorkerConcurrency: 6 },
    );

    expect(settings.maximumRetryAttempts).toBe(10);
    expect(settings.retryBaseDelayMs).toBe(250);
    expect(settings.retryMaximumDelayMs).toBe(15 * 60_000);
    expect(settings.workerConcurrency).toBe(6);
    expect(settings.stallThresholdMs).toBe(10_000);
  });

  it('also clamps the default concurrency to a lower infrastructure cap', () => {
    expect(normalizeProcessingSettings({}, { maximumWorkerConcurrency: 1 }).workerConcurrency).toBe(1);
  });

  it('preserves valid user preferences and processing defaults', () => {
    expect(
      normalizeProcessingSettings({
        automaticRetries: false,
        maximumRetryAttempts: 0,
        retryServerErrors: false,
        workerConcurrency: 3,
        processingDefaults: { autoStart: true, resumeFromCheckpoint: false },
      }),
    ).toMatchObject({
      automaticRetries: false,
      maximumRetryAttempts: 0,
      retryServerErrors: false,
      workerConcurrency: 3,
      processingDefaults: { autoStart: true, resumeFromCheckpoint: false },
    });
  });

  it('rejects malformed setting types and invalid infrastructure limits', () => {
    expect(() => normalizeProcessingSettings({ automaticRetries: 'yes' } as never)).toThrow(
      ProcessingSettingsValidationError,
    );
    expect(() => normalizeProcessingSettings({ workerConcurrency: Number.NaN })).toThrow(/finite number/i);
    expect(() => normalizeProcessingSettings({ processingDefaults: [] } as never)).toThrow(/must be an object/i);
    expect(() => normalizeProcessingSettings({}, { maximumWorkerConcurrency: 0 })).toThrow(/positive integer/i);
  });
});

