import 'server-only';

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export function ok<T>(data: T, status = 200) {
  return Response.json({ ok: true, data }, { status });
}

export function fail(error: ApiError, status = 400) {
  const publicError = status >= 500
    ? { code: error.code, message: 'The request could not be completed.' }
    : error;
  return Response.json({ ok: false, error: publicError }, { status });
}
