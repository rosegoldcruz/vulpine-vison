import { describe, expect, it } from 'vitest';
import { authenticateVisionRequest, constantTimeEqual } from '@/lib/platform/integration-auth';

describe('Vision integration authentication', () => {
  it('compares integration tokens without length-dependent comparisons', () => {
    expect(constantTimeEqual('expected-token', 'expected-token')).toBe(true);
    expect(constantTimeEqual('wrong-token', 'expected-token')).toBe(false);
    expect(constantTimeEqual('short', 'a-much-longer-token')).toBe(false);
  });

  it('fails closed for external requests', () => {
    expect(authenticateVisionRequest({ configuredToken: '', providedToken: '' })).toMatchObject({
      allowed: false,
      status: 503,
      code: 'INTEGRATION_NOT_CONFIGURED',
    });
    expect(authenticateVisionRequest({ configuredToken: 'expected-token', providedToken: 'wrong-token' })).toMatchObject({
      allowed: false,
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(authenticateVisionRequest({ configuredToken: 'expected-token', providedToken: 'expected-token' })).toEqual({
      allowed: true,
      actor: 'backoffice-service',
    });
  });

  it('preserves direct loopback maintenance access', () => {
    expect(authenticateVisionRequest({ configuredToken: '', providedToken: '', directLoopback: true })).toEqual({
      allowed: true,
      actor: 'server-local',
    });
  });
});
