import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabasesForTests } from '@/lib/autobidder/db/database';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { GET as analyticsGET } from '@/app/api/backoffice/analytics/route';
import { POST as dealPOST } from '@/app/api/backoffice/deals/route';

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'backoffice-routes-'));
  process.env.AUTOBIDDER_DATABASE_PATH = path.join(directory, 'test.sqlite');
});

afterEach(() => {
  closeDatabasesForTests();
  delete process.env.AUTOBIDDER_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe('authenticated backoffice routes', () => {
  it('rejects an unauthenticated non-loopback analytics request', async () => {
    const response = await analyticsGET(new Request('https://cabinet.example/api/backoffice/analytics'));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('persists a deal through an authorized local route and returns live analytics', async () => {
    const project = await new ProjectRepository().create('Route Fixture');
    const response = await dealPOST(new Request('http://localhost/api/backoffice/deals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.projectId, companyName: 'Acme', stage: 'ready_to_send', approvedBidCents: 100_00,
        currency: 'USD', unitCount: 3, qaStatus: 'passed',
      }),
    }));
    expect(response.status).toBe(201);

    const analytics = await analyticsGET(new Request('http://localhost/api/backoffice/analytics?groupBy=customer'));
    expect(analytics.status).toBe(200);
    expect(await analytics.json()).toMatchObject({
      ok: true,
      data: { pipeline: { projectCount: 1, unitsRepresented: 3, totalActiveBidValue: [{ currency: 'USD', amountCents: 100_00 }] } },
    });
  });
});
