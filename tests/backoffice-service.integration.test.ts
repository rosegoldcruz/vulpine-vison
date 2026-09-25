import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabasesForTests, getDatabase } from '@/lib/autobidder/db/database';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import {
  createOutreachDraft,
  listDeals,
  listProviderSnapshots,
  projectLogistics,
  readBackofficeAnalytics,
  saveDeal,
  saveFreightQuote,
  saveProviderSnapshot,
  sendOutreach,
  type EmailTransport,
} from '@/lib/backoffice/service';
import {
  configuredEmailTransport,
  emailConnectionState,
  enrichCompany,
  refreshMapRoute,
} from '@/lib/backoffice/provider-service';

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'backoffice-service-'));
  process.env.AUTOBIDDER_DATABASE_PATH = path.join(directory, 'test.sqlite');
});

afterEach(() => {
  closeDatabasesForTests();
  delete process.env.AUTOBIDDER_DATABASE_PATH;
  delete process.env.EMAIL_PROVIDER;
  delete process.env.EMAIL_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.EMAIL_API_ENDPOINT;
  delete process.env.COMPANY_INTELLIGENCE_PROVIDER;
  delete process.env.COMPANY_INTELLIGENCE_API_KEY;
  delete process.env.COMPANY_INTELLIGENCE_ENDPOINT;
  delete process.env.MAPS_PROVIDER;
  delete process.env.MAPS_API_KEY;
  delete process.env.MAPS_ROUTE_ENDPOINT;
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

async function fixture() {
  const project = await new ProjectRepository().create('Live Bid');
  const job = await new BidJobRepository().create(project);
  return { project, job };
}

describe('persistent backoffice operations', () => {
  it('persists live deal/event data and computes currency-safe dashboard metrics', async () => {
    const first = await fixture();
    const second = await new ProjectRepository().create('Euro Bid');
    saveDeal({
      projectId: first.project.projectId, companyName: 'Acme', stage: 'bid_sent', approvedBidCents: 125_00,
      expectedRevenueCents: 80_00, currency: 'USD', unitCount: 12, qaStatus: 'passed', market: 'Denver',
    }, 'reviewer-1');
    saveDeal({
      projectId: second.projectId, companyName: 'Europa', stage: 'awarded', approvedBidCents: 200_00,
      realizedRevenueCents: 190_00, currency: 'EUR', unitCount: 4, qaStatus: 'passed', market: 'Berlin',
    }, 'reviewer-1');

    closeDatabasesForTests();
    expect(listDeals()).toHaveLength(2);
    const dashboard = readBackofficeAnalytics({ now: new Date() });
    expect(dashboard.pipeline.submittedValue).toEqual([{ currency: 'USD', amountCents: 125_00 }]);
    expect(dashboard.pipeline.awardedValue).toEqual([{ currency: 'EUR', amountCents: 200_00 }]);
    expect(dashboard.completedBidValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ bidAmount: [{ currency: 'USD', amountCents: 125_00 }] }),
      expect.objectContaining({ realizedRevenue: [{ currency: 'EUR', amountCents: 190_00 }] }),
    ]));
    expect(dashboard.operatingTrend.comparisons.bid_sent.currentCount).toBe(1);
    expect(dashboard.operatingTrend.comparisons.award_recorded.currentCount).toBe(1);
  });

  it('never calls delivery without explicit confirmation and an exact safe-to-send state', async () => {
    const { project, job } = await fixture();
    saveDeal({
      projectId: project.projectId, companyName: 'Acme', stage: 'ready_to_send', approvedBidCents: 500_00,
      currency: 'USD', qaStatus: 'passed',
    }, 'approver-1');
    const draft = createOutreachDraft(project.projectId, {
      recipient: 'buyer@example.com', scope: 'Cabinets', inclusions: ['Casework'], exclusions: ['Counters'],
      assumptions: ['Field dimensions verified by GC'], estimatorSignature: 'Estimator',
    }, 'estimator-1');
    const send = vi.fn(async () => ({ externalId: 'email-1', acceptedAt: new Date().toISOString() }));
    const transport: EmailTransport = { provider: 'company-email', send };

    await expect(sendOutreach({ outreachId: draft.id, actorId: 'approver-1', confirmation: '', transport }))
      .rejects.toMatchObject({ code: 'SEND_CONFIRMATION_REQUIRED' });
    await expect(sendOutreach({
      outreachId: draft.id, actorId: 'approver-1', confirmation: 'SEND_APPROVED_BID_OUTREACH', transport,
    })).rejects.toMatchObject({ code: 'BID_NOT_SAFE_TO_SEND' });
    expect(send).not.toHaveBeenCalled();

    getDatabase().prepare("UPDATE bid_jobs SET workflow_state = 'cabinet_bid_safe_to_send' WHERE id = ?").run(job.id);
    const result = await sendOutreach({
      outreachId: draft.id, projectId: project.projectId, actorId: 'approver-1',
      confirmation: 'SEND_APPROVED_BID_OUTREACH', transport,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.outreach.status).toBe('sent');
    expect(readBackofficeAnalytics().outreachVelocity.currentCount).toBe(1);
  });

  it('reports email unavailable unless every transport setting is present', () => {
    process.env.EMAIL_PROVIDER = 'company-email';
    process.env.EMAIL_API_KEY = 'secret';
    process.env.EMAIL_FROM = 'bids@example.com';
    expect(emailConnectionState()).toMatchObject({ configured: false, status: 'not_configured' });
    expect(() => configuredEmailTransport()).toThrowError(expect.objectContaining({ code: 'PROVIDER_NOT_CONFIGURED' }));

    process.env.EMAIL_API_ENDPOINT = 'https://email.example.test/send';
    expect(emailConnectionState()).toMatchObject({ configured: true, status: 'configured_unverified' });
  });

  it('keeps provider intelligence separate and gives approved freight quotes precedence over map estimates', async () => {
    const { project } = await fixture();
    const before = await new ProjectRepository().get(project.projectId);
    saveProviderSnapshot({
      projectId: project.projectId, providerType: 'company_intelligence', providerName: 'authorized-provider',
      status: 'connected', externalRecordId: 'company-1', retrievedAt: '2026-09-25T10:00:00.000Z',
      payload: { companySize: 120, revenueRange: '$10m-$20m' },
    }, 'admin-1');
    saveProviderSnapshot({
      projectId: project.projectId, providerType: 'maps', providerName: 'maps-provider', status: 'connected',
      retrievedAt: '2026-09-25T11:00:00.000Z',
      payload: {
        provider: 'maps-provider', retrievedAt: '2026-09-25T11:00:00.000Z', originLabel: 'Plant',
        destinationLabel: 'Site', distanceMeters: 42_000, estimatedFreight: { amountCents: 200_00, currency: 'USD' },
      },
    }, 'admin-1');
    saveFreightQuote(project.projectId, {
      status: 'approved', amountCents: 350_00, currency: 'USD', provider: 'Carrier',
    }, 'approver-1');

    expect(listProviderSnapshots(project.projectId, 'company_intelligence')[0]).toMatchObject({
      externalRecordId: 'company-1', payload: { companySize: 120, revenueRange: '$10m-$20m' },
    });
    expect(await new ProjectRepository().get(project.projectId)).toEqual(before);
    expect(projectLogistics(project.projectId).grounding).toMatchObject({
      source: 'approved_quote', authoritative: true, amount: { amountCents: 350_00, currency: 'USD' },
    });
  });

  it('persists only data actually returned by configured enrichment and map providers', async () => {
    const { project } = await fixture();
    process.env.COMPANY_INTELLIGENCE_PROVIDER = 'intel-provider';
    process.env.COMPANY_INTELLIGENCE_API_KEY = 'intel-secret';
    process.env.COMPANY_INTELLIGENCE_ENDPOINT = 'https://intel.example.test/enrich';
    process.env.MAPS_PROVIDER = 'maps-provider';
    process.env.MAPS_API_KEY = 'maps-secret';
    process.env.MAPS_ROUTE_ENDPOINT = 'https://maps.example.test/route';
    const providerFetch = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes('intel')) return Response.json({ id: 'external-company', employeeCount: 84 });
      return Response.json({ distanceMeters: 12_500, durationSeconds: 1_200 });
    });
    vi.stubGlobal('fetch', providerFetch);

    await enrichCompany({ projectId: project.projectId, domain: 'acme.example' }, 'admin-1');
    await refreshMapRoute({ projectId: project.projectId, originLabel: 'Plant', destinationLabel: 'Job' }, 'admin-1');

    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(listProviderSnapshots(project.projectId, 'company_intelligence')[0]).toMatchObject({
      providerName: 'intel-provider', externalRecordId: 'external-company', payload: { id: 'external-company', employeeCount: 84 },
    });
    expect(projectLogistics(project.projectId).grounding).toMatchObject({
      source: 'map_estimate', authoritative: false,
      supportingRoute: { provider: 'maps-provider', distanceMeters: 12_500 },
    });
  });
});
