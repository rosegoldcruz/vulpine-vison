import { beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '@/types/canonical';
import { hasPermission, requirePermission } from '@/lib/autobidder/auth/authorization';
import { issueSession, verifySession } from '@/lib/autobidder/auth/session';

const estimator: Principal = {
  id: 'user-1',
  kind: 'user',
  displayName: 'Estimator',
  role: 'estimator',
  organizationId: 'org-1',
  scopes: [],
};

describe('authorization', () => {
  beforeEach(() => {
    process.env.AUTOBIDDER_SESSION_SECRET = '0123456789abcdef0123456789abcdef';
  });

  it('enforces role permissions', () => {
    expect(hasPermission(estimator, 'project:upload')).toBe(true);
    expect(hasPermission(estimator, 'bid:mark_safe')).toBe(false);
    expect(() => requirePermission(estimator, 'bid:mark_safe')).toThrow(/Permission denied/);
  });

  it('issues and verifies an expiring signed session without trusting caller actor fields', () => {
    const token = issueSession(estimator, 60);
    expect(verifySession(token)).toEqual(estimator);
    expect(verifySession(`${token}tampered`)).toBeNull();
  });
});

