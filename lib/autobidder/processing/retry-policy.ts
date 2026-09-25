import 'server-only';

export type RetryFailureCategory =
  | 'validation'
  | 'network'
  | 'server'
  | 'worker_restart'
  | 'provider_temporary'
  | 'canceled'
  | 'unknown';

export interface RetryFailureInput {
  code?: string;
  name?: string;
  message?: string;
  status?: number;
  retryable?: boolean;
}

export interface RetryClassification {
  retryable: boolean;
  category: RetryFailureCategory;
  reason: string;
}

export interface RetryDecisionSettings {
  automaticRetries: boolean;
  maximumRetryAttempts: number;
  retryServerErrors: boolean;
}

const VALIDATION_CODES = new Set([
  'VALIDATION_ERROR',
  'INVALID_STATE_TRANSITION',
  'WORKBOOK_SCHEMA_UNSUPPORTED',
  'CORRUPT_WORKBOOK',
  'CORRUPT_PDF',
  'PDF_PAGE_READ_FAILED',
  'PDF_TEXT_EXTRACTION_FAILED',
  'UNSUPPORTED_FILE_TYPE',
  'ZIP_PATH_TRAVERSAL',
  'INVALID_ZIP',
  'EMPTY_ZIP',
  'ZIP_WITHOUT_PDFS',
  'WORKBOOK_REQUIRED',
  'PDF_REQUIRED',
]);

const NETWORK_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'NETWORK_ERROR',
]);

const WORKER_CODES = new Set(['LEASE_EXPIRED', 'WORKER_LOST', 'WORKER_RESTARTED', 'WORKER_SHUTDOWN']);
const PROVIDER_CODES = new Set([
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TEMPORARILY_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
]);

function normalizedCode(input: RetryFailureInput): string {
  return (input.code || input.name || '').trim().toUpperCase();
}

export function classifyRetryFailure(input: RetryFailureInput): RetryClassification {
  const code = normalizedCode(input);
  const message = (input.message || '').toLowerCase();

  if (code === 'ABORT_ERROR' || code === 'ABORTERROR' || code === 'CANCELED' || code === 'CANCELLED') {
    return { retryable: false, category: 'canceled', reason: 'The operation was intentionally canceled.' };
  }

  if (VALIDATION_CODES.has(code) || input.status === 400 || input.status === 409 || input.status === 422) {
    return { retryable: false, category: 'validation', reason: 'Deterministic validation failures require input or workflow changes.' };
  }

  if (input.retryable === false) {
    return { retryable: false, category: 'unknown', reason: 'The failure was explicitly marked non-retryable.' };
  }

  if (NETWORK_CODES.has(code)) {
    return { retryable: true, category: 'network', reason: `Transient network failure${code ? ` (${code})` : ''}.` };
  }

  if (WORKER_CODES.has(code)) {
    return { retryable: true, category: 'worker_restart', reason: `Worker interruption${code ? ` (${code})` : ''}.` };
  }

  if (PROVIDER_CODES.has(code) || input.status === 408 || input.status === 425 || input.status === 429) {
    return { retryable: true, category: 'provider_temporary', reason: 'The provider or upstream service is temporarily unavailable.' };
  }

  if (input.status && input.status >= 500 && input.status <= 599 && input.status !== 501 && input.status !== 505) {
    return { retryable: true, category: 'server', reason: `Temporary server response (${input.status}).` };
  }

  const looksTransient = [
    'connection reset',
    'connection closed',
    'failed to fetch',
    'network interruption',
    'network error',
    'socket hang up',
    'temporarily unavailable',
    'timed out',
    'timeout',
  ].some((fragment) => message.includes(fragment));

  if (looksTransient) {
    return { retryable: true, category: 'network', reason: 'The failure message indicates a transient connection problem.' };
  }

  if (input.retryable === true) {
    return { retryable: true, category: 'unknown', reason: 'The failure was explicitly marked retryable.' };
  }

  return { retryable: false, category: 'unknown', reason: 'The failure is not known to be safely recoverable.' };
}

export function shouldAutomaticallyRetry(
  failure: RetryFailureInput,
  retryAttempt: number,
  settings: RetryDecisionSettings,
): RetryClassification {
  const classification = classifyRetryFailure(failure);
  if (!settings.automaticRetries) {
    return { ...classification, retryable: false, reason: 'Automatic retries are disabled.' };
  }
  if (!Number.isInteger(retryAttempt) || retryAttempt < 1 || retryAttempt > settings.maximumRetryAttempts) {
    return { ...classification, retryable: false, reason: 'The configured retry limit has been reached.' };
  }
  if (classification.category === 'server' && !settings.retryServerErrors) {
    return { ...classification, retryable: false, reason: 'Retries for server errors are disabled.' };
  }
  return classification;
}

export function boundedExponentialBackoffMs(
  retryAttempt: number,
  baseDelayMs: number,
  maximumDelayMs: number,
): number {
  if (!Number.isInteger(retryAttempt) || retryAttempt < 1) {
    throw new RangeError('retryAttempt must be a positive integer.');
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new RangeError('baseDelayMs must be a non-negative finite number.');
  }
  if (!Number.isFinite(maximumDelayMs) || maximumDelayMs < baseDelayMs) {
    throw new RangeError('maximumDelayMs must be finite and at least baseDelayMs.');
  }

  const exponent = Math.min(retryAttempt - 1, 52);
  return Math.min(maximumDelayMs, baseDelayMs * 2 ** exponent);
}

