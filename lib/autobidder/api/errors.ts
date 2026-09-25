import 'server-only';

export class ApiServiceError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(code: string, message: string, status = 400, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function asApiServiceError(error: unknown): ApiServiceError {
  if (error instanceof ApiServiceError) {
    return error;
  }
  if (error instanceof Error && 'code' in error && 'status' in error) {
    const candidate = error as Error & { code: unknown; status: unknown; details?: unknown };
    if (typeof candidate.code === 'string' && typeof candidate.status === 'number') {
      return new ApiServiceError(
        candidate.code,
        candidate.message,
        candidate.status,
        candidate.details && typeof candidate.details === 'object' ? candidate.details as Record<string, unknown> : {},
      );
    }
  }
  if (error instanceof Error) {
    return new ApiServiceError('INTERNAL_ERROR', error.message, 500);
  }
  return new ApiServiceError('INTERNAL_ERROR', 'Unknown error', 500);
}
