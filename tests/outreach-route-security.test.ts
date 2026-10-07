import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock('@/lib/autobidder/auth/request-principal', () => ({ requestPrincipal: () => null }));
vi.mock('@/lib/autobidder/auth/resource-access', () => ({ assertProjectAccess: mocks.access }));
vi.mock('@/lib/backoffice/service', () => ({ createOutreachDraft: vi.fn(), listProjectOutreach: vi.fn(), sendOutreach: vi.fn(), syncApprovedDealFromBid: vi.fn() }));
vi.mock('@/lib/backoffice/provider-service', () => ({ configuredEmailTransport: vi.fn(), emailConnectionState: vi.fn() }));
import { POST } from '@/app/api/backoffice/projects/[id]/outreach/route';

afterEach(() => vi.clearAllMocks());
describe('outreach authentication ordering', () => {
  it('rejects anonymous callers before looking up project existence', async () => {
    const response = await POST(new Request('https://vision.example.test/api/backoffice/projects/project-1/outreach', { method: 'POST', body: '{}' }), { params: Promise.resolve({ id: 'project-1' }) });
    expect(response.status).toBe(401);
    expect(mocks.access).not.toHaveBeenCalled();
  });
});
