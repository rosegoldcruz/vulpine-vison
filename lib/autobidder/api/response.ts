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
  return Response.json({ ok: false, error }, { status });
}
