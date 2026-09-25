import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { issueSession } from '@/lib/autobidder/auth/session';
import type { Principal } from '@/types/canonical';
import type { TrustedPrincipalPayload } from '@/lib/platform/trusted-principal';
import { POST as chatRoute } from '@/app/api/chat/route';

const secret = 'request-principal-test-secret-with-sufficient-entropy';
const signedPrincipal: Principal = {
  id: 'backoffice-reviewer',
  kind: 'user',
  displayName: 'backoffice-reviewer',
  role: 'reviewer',
  organizationId: 'tenant-signed',
  scopes: ['project:read'],
};

function sign(overrides: Partial<TrustedPrincipalPayload> = {}, signingSecret = secret): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TrustedPrincipalPayload = {
    v: 1,
    sub: signedPrincipal.id,
    org: signedPrincipal.organizationId,
    role: signedPrincipal.role as 'reviewer',
    scopes: ['project:read'],
    iat: now - 5,
    exp: now + 120,
    nonce: 'principal-nonce-1234',
    ...overrides,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', signingSecret).update(encoded, 'utf8').digest('base64url');
  return `${encoded}.${signature}`;
}

function request(principal = sign(), bearer = secret, url = 'https://vision.example.test/api/jobs/job-1'): Request {
  return new Request(url, {
    headers: {
      authorization: `Bearer ${bearer}`,
      'x-vulpine-principal': principal,
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requestPrincipal trusted integration authentication', () => {
  it('accepts a valid trusted principal with the matching bearer secret', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VISION_API_TOKEN', secret);
    expect(requestPrincipal(request())).toEqual(signedPrincipal);
  });

  it('rejects an otherwise valid principal when the bearer token is wrong', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VISION_API_TOKEN', secret);
    expect(requestPrincipal(request(sign(), 'wrong-secret'))).toBeNull();
  });

  it('rejects tampered and expired signed principals', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VISION_API_TOKEN', secret);
    const compact = sign();
    const [encoded, signature] = compact.split('.');
    const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TrustedPrincipalPayload;
    const tampered = `${Buffer.from(JSON.stringify({ ...claims, org: 'attacker-tenant' }), 'utf8').toString('base64url')}.${signature}`;
    expect(requestPrincipal(request(tampered))).toBeNull();

    const now = Math.floor(Date.now() / 1000);
    expect(requestPrincipal(request(sign({ iat: now - 120, exp: now - 1 })))).toBeNull();
  });

  it('rejects unauthenticated production loopback requests', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VISION_API_TOKEN', secret);
    expect(requestPrincipal(new Request('http://127.0.0.1/api/jobs/job-1'))).toBeNull();
  });

  it('prefers an authenticated cookie session over integration headers', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VISION_API_TOKEN', secret);
    vi.stubEnv('AUTOBIDDER_SESSION_SECRET', 'request-principal-cookie-secret-longer-than-32-characters');
    const sessionPrincipal: Principal = {
      id: 'session-user',
      kind: 'user',
      displayName: 'Session User',
      role: 'viewer',
      organizationId: 'tenant-session',
      scopes: [],
    };
    const authenticated = request(sign(), secret);
    authenticated.headers.set('cookie', `vulpine_session=${issueSession(sessionPrincipal)}`);
    expect(requestPrincipal(authenticated)).toEqual(sessionPrincipal);
  });

  it('requires authentication for generic chat without a job id', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VISION_API_TOKEN', secret);
    const response = await chatRoute(new Request('https://vision.example.test/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Hello', history: [] }),
    }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });
});
