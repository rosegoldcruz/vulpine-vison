import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  verifyTrustedVisionPrincipal,
  type TrustedPrincipalPayload,
} from '@/lib/platform/trusted-principal';

const secret = 'vision-test-secret-with-sufficient-entropy';
const now = 1_800_000_000;

function sign(payload: TrustedPrincipalPayload, signingSecret = secret): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', signingSecret).update(encoded, 'utf8').digest('base64url');
  return `${encoded}.${signature}`;
}

function payload(overrides: Partial<TrustedPrincipalPayload> = {}): TrustedPrincipalPayload {
  return {
    v: 1,
    sub: 'reviewer@example.test',
    org: 'organization-42',
    role: 'reviewer',
    scopes: ['project:read', 'unit_mix:approve'],
    iat: now - 10,
    exp: now + 120,
    nonce: 'nonce-12345678',
    ...overrides,
  };
}

describe('trusted Vision principals', () => {
  it('verifies a signed v1 payload and derives the real user and tenant', () => {
    const result = verifyTrustedVisionPrincipal(sign(payload()), secret, now);
    expect(result).toMatchObject({
      valid: true,
      principal: {
        id: 'reviewer@example.test',
        kind: 'user',
        role: 'reviewer',
        organizationId: 'organization-42',
        scopes: ['project:read', 'unit_mix:approve'],
      },
    });
  });

  it('rejects a payload changed after signing', () => {
    const compact = sign(payload());
    const [, signature] = compact.split('.');
    const changedPayload = Buffer.from(JSON.stringify(payload({ org: 'attacker-org' })), 'utf8').toString('base64url');
    expect(verifyTrustedVisionPrincipal(`${changedPayload}.${signature}`, secret, now)).toMatchObject({
      valid: false,
      code: 'TRUSTED_PRINCIPAL_INVALID',
    });
  });

  it('rejects expired and future-issued principals', () => {
    expect(verifyTrustedVisionPrincipal(sign(payload({ iat: now - 120, exp: now - 1 })), secret, now)).toMatchObject({
      valid: false,
      code: 'TRUSTED_PRINCIPAL_EXPIRED',
    });
    expect(verifyTrustedVisionPrincipal(sign(payload({ iat: now + 61, exp: now + 180 })), secret, now)).toMatchObject({
      valid: false,
      code: 'TRUSTED_PRINCIPAL_INVALID',
    });
  });

  it('rejects service roles, unknown scopes, and malformed identity claims', () => {
    const base = payload() as unknown as Record<string, unknown>;
    for (const claims of [
      { ...base, role: 'service' },
      { ...base, scopes: ['project:read', 'tenant:impersonate'] },
      { ...base, org: '' },
      { ...base, sub: '../other-user' },
      { ...base, nonce: 'short' },
    ]) {
      expect(verifyTrustedVisionPrincipal(sign(claims as unknown as TrustedPrincipalPayload), secret, now)).toMatchObject({
        valid: false,
        code: 'TRUSTED_PRINCIPAL_INVALID',
      });
    }
  });
});
