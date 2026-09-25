import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabasesForTests } from '@/lib/autobidder/db/database';
import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { withVisionUserOrIntegration } from '@/lib/platform/integration-auth';
import type { TrustedPrincipalPayload } from '@/lib/platform/trusted-principal';
import { GET as getJob } from '@/app/api/jobs/[id]/route';
import { POST as discoverWorkbook } from '@/app/api/workbook/route';
import { POST as approveLegacyUnitMix } from '@/app/api/jobs/[id]/approve-unit-mix/route';
import { POST as resolveLegacyMapping } from '@/app/api/jobs/[id]/resolve/route';

const secret = 'vision-route-test-secret-with-sufficient-entropy';
let directory = '';

function signedPrincipal(overrides: Partial<TrustedPrincipalPayload> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TrustedPrincipalPayload = {
    v: 1,
    sub: 'backoffice-user-1',
    org: 'tenant-a',
    role: 'admin',
    scopes: [],
    iat: now - 5,
    exp: now + 120,
    nonce: 'route-nonce-1234',
    ...overrides,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(encoded, 'utf8').digest('base64url')}`;
}

function externalRequest(url: string, principal = signedPrincipal(), init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: {
      authorization: `Bearer ${secret}`,
      'x-vulpine-principal': principal,
      'x-vulpine-actor': 'forged-actor',
      'x-organization-id': 'forged-tenant',
      ...init.headers,
    },
  });
}

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'vision-integration-auth-'));
  process.env.AUTOBIDDER_DATABASE_PATH = path.join(directory, 'test.sqlite');
  process.env.VISION_API_TOKEN = secret;
});

afterEach(() => {
  closeDatabasesForTests();
  delete process.env.AUTOBIDDER_DATABASE_PATH;
  delete process.env.VISION_API_TOKEN;
  rmSync(directory, { recursive: true, force: true });
});

describe('Vision user-or-integration routes', () => {
  it('uses only signed actor and organization claims', async () => {
    const route = withVisionUserOrIntegration('project:read', 'GET /test', async (_request, principal) =>
      Response.json(principal),
    );
    const response = await route(externalRequest('https://vision.example.test/test'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 'backoffice-user-1',
      organizationId: 'tenant-a',
      role: 'admin',
    });
  });

  it('requires both the bearer token and a valid, unexpired signed principal', async () => {
    const route = withVisionUserOrIntegration('project:read', 'GET /test', async () => Response.json({ ok: true }));
    const expired = signedPrincipal({ iat: Math.floor(Date.now() / 1000) - 120, exp: Math.floor(Date.now() / 1000) - 1 });
    const expiredResponse = await route(externalRequest('https://vision.example.test/test', expired));
    expect(expiredResponse.status).toBe(401);
    await expect(expiredResponse.json()).resolves.toMatchObject({ error: { code: 'TRUSTED_PRINCIPAL_EXPIRED' } });

    const missingResponse = await route(new Request('https://vision.example.test/test', {
      headers: { authorization: `Bearer ${secret}` },
    }));
    expect(missingResponse.status).toBe(401);
    await expect(missingResponse.json()).resolves.toMatchObject({ error: { code: 'TRUSTED_PRINCIPAL_INVALID' } });

    const wrongTokenResponse = await route(new Request('https://vision.example.test/test', {
      headers: {
        authorization: 'Bearer wrong-secret',
        'x-vulpine-principal': signedPrincipal(),
      },
    }));
    expect(wrongTokenResponse.status).toBe(401);
    await expect(wrongTokenResponse.json()).resolves.toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('does not grant direct loopback access in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const route = withVisionUserOrIntegration('project:read', 'GET /test', async () => Response.json({ ok: true }));
      const response = await route(new Request('http://127.0.0.1/test'));
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('prevents a signed principal from reading another organization job or workbook', async () => {
    const project = await new ProjectRepository().create('Tenant A Project', 'tenant-a');
    const job = await new BidJobRepository().create(project);
    const outsider = signedPrincipal({ org: 'tenant-b', nonce: 'outsider-nonce-1' });

    const jobResponse = await getJob(externalRequest(`https://vision.example.test/api/jobs/${job.id}`, outsider), {
      params: Promise.resolve({ id: job.id }),
    });
    expect(jobResponse.status).toBe(404);

    const workbookResponse = await discoverWorkbook(externalRequest('https://vision.example.test/api/workbook', outsider, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.projectId }),
    }));
    expect(workbookResponse.status).toBe(404);
  });

  it('keeps quarantined legacy mutation routes disabled for authenticated callers', async () => {
    const approve = await approveLegacyUnitMix(externalRequest('https://vision.example.test/api/jobs/job-1/approve-unit-mix', signedPrincipal(), {
      method: 'POST',
    }));
    expect(approve.status).toBe(410);
    await expect(approve.json()).resolves.toMatchObject({ error: { code: 'LEGACY_ROUTE_DISABLED' } });

    const resolve = await resolveLegacyMapping(externalRequest('https://vision.example.test/api/jobs/job-1/resolve', signedPrincipal(), {
      method: 'POST',
    }));
    expect(resolve.status).toBe(410);
    await expect(resolve.json()).resolves.toMatchObject({ error: { code: 'LEGACY_ROUTE_DISABLED' } });
  });
});
