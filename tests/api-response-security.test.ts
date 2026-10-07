import { describe, expect, it } from 'vitest';
import { fail } from '@/lib/autobidder/api/response';

describe('public server errors', () => {
  it('never includes provider details or internal exceptions', async () => {
    const response = fail({ code: 'PROVIDER_FAILED', message: 'Internal provider credential and SQL error', details: { stack: 'internal traceback' } }, 502);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, error: { code: 'PROVIDER_FAILED', message: 'The request could not be completed.' } });
  });
  it('preserves actionable client validation errors', async () => {
    const response = fail({ code: 'VALIDATION_ERROR', message: 'jobId is required.' }, 400);
    expect(await response.json()).toEqual({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'jobId is required.' } });
  });
});
