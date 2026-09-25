import 'server-only';

export interface ProcessingDefaults {
  autoStart: boolean;
  resumeFromCheckpoint: boolean;
}

export interface ProcessingSettings {
  automaticRetries: boolean;
  maximumRetryAttempts: number;
  retryBaseDelayMs: number;
  retryMaximumDelayMs: number;
  retryServerErrors: boolean;
  workerConcurrency: number;
  stallThresholdMs: number;
  processingDefaults: ProcessingDefaults;
}

export const DEFAULT_PROCESSING_SETTINGS: Readonly<ProcessingSettings> = Object.freeze({
  automaticRetries: true,
  maximumRetryAttempts: 3,
  retryBaseDelayMs: 2_000,
  retryMaximumDelayMs: 60_000,
  retryServerErrors: true,
  workerConcurrency: 2,
  stallThresholdMs: 120_000,
  processingDefaults: Object.freeze({ autoStart: false, resumeFromCheckpoint: true }),
});

export interface ProcessingSettingLimits {
  maximumWorkerConcurrency: number;
}

export class ProcessingSettingsValidationError extends Error {
  field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'ProcessingSettingsValidationError';
    this.field = field;
  }
}

function booleanValue(value: unknown, fallback: boolean, field: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new ProcessingSettingsValidationError(field, `${field} must be a boolean.`);
  return value;
}

function integerValue(value: unknown, fallback: number, field: string, minimum: number, maximum: number): number {
  if (value === undefined) return Math.min(maximum, Math.max(minimum, fallback));
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProcessingSettingsValidationError(field, `${field} must be a finite number.`);
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function restoreProcessingDefaults(): ProcessingSettings {
  return {
    ...DEFAULT_PROCESSING_SETTINGS,
    processingDefaults: { ...DEFAULT_PROCESSING_SETTINGS.processingDefaults },
  };
}

export function normalizeProcessingSettings(
  input: Partial<ProcessingSettings> | Record<string, unknown>,
  limits: ProcessingSettingLimits = { maximumWorkerConcurrency: 4 },
): ProcessingSettings {
  if (!Number.isInteger(limits.maximumWorkerConcurrency) || limits.maximumWorkerConcurrency < 1) {
    throw new ProcessingSettingsValidationError(
      'maximumWorkerConcurrency',
      'maximumWorkerConcurrency must be a positive integer.',
    );
  }

  const source = input as Record<string, unknown>;
  const nested = source.processingDefaults;
  if (nested !== undefined && (typeof nested !== 'object' || nested === null || Array.isArray(nested))) {
    throw new ProcessingSettingsValidationError('processingDefaults', 'processingDefaults must be an object.');
  }
  const processingDefaults = (nested || {}) as Record<string, unknown>;

  const retryBaseDelayMs = integerValue(
    source.retryBaseDelayMs,
    DEFAULT_PROCESSING_SETTINGS.retryBaseDelayMs,
    'retryBaseDelayMs',
    250,
    60_000,
  );
  const retryMaximumDelayMs = integerValue(
    source.retryMaximumDelayMs,
    DEFAULT_PROCESSING_SETTINGS.retryMaximumDelayMs,
    'retryMaximumDelayMs',
    retryBaseDelayMs,
    15 * 60_000,
  );

  return {
    automaticRetries: booleanValue(
      source.automaticRetries,
      DEFAULT_PROCESSING_SETTINGS.automaticRetries,
      'automaticRetries',
    ),
    maximumRetryAttempts: integerValue(
      source.maximumRetryAttempts,
      DEFAULT_PROCESSING_SETTINGS.maximumRetryAttempts,
      'maximumRetryAttempts',
      0,
      10,
    ),
    retryBaseDelayMs,
    retryMaximumDelayMs,
    retryServerErrors: booleanValue(
      source.retryServerErrors,
      DEFAULT_PROCESSING_SETTINGS.retryServerErrors,
      'retryServerErrors',
    ),
    workerConcurrency: integerValue(
      source.workerConcurrency,
      DEFAULT_PROCESSING_SETTINGS.workerConcurrency,
      'workerConcurrency',
      1,
      limits.maximumWorkerConcurrency,
    ),
    stallThresholdMs: integerValue(
      source.stallThresholdMs,
      DEFAULT_PROCESSING_SETTINGS.stallThresholdMs,
      'stallThresholdMs',
      10_000,
      30 * 60_000,
    ),
    processingDefaults: {
      autoStart: booleanValue(
        processingDefaults.autoStart,
        DEFAULT_PROCESSING_SETTINGS.processingDefaults.autoStart,
        'processingDefaults.autoStart',
      ),
      resumeFromCheckpoint: booleanValue(
        processingDefaults.resumeFromCheckpoint,
        DEFAULT_PROCESSING_SETTINGS.processingDefaults.resumeFromCheckpoint,
        'processingDefaults.resumeFromCheckpoint',
      ),
    },
  };
}
