import 'server-only';

export class CompilerInvariantError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'CompilerInvariantError';
    this.code = code;
    this.details = details;
  }
}

export function requireNonNegativeSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CompilerInvariantError('INVALID_INTEGER', `${field} must be a non-negative safe integer.`, {
      field,
      value,
    });
  }
  return value;
}

export function safeMultiply(left: number, right: number, field: string): number {
  requireNonNegativeSafeInteger(left, `${field}.left`);
  requireNonNegativeSafeInteger(right, `${field}.right`);
  const result = left * right;
  if (!Number.isSafeInteger(result)) {
    throw new CompilerInvariantError('INTEGER_OVERFLOW', `${field} exceeds JavaScript safe integer precision.`, {
      left,
      right,
    });
  }
  return result;
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
