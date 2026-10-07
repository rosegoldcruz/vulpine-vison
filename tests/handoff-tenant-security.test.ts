import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ repository: vi.fn() }));
vi.mock('@/lib/autobidder/repositories/project-repository', () => ({ ProjectRepository: mocks.repository }));
import { POST } from '@/app/api/integrations/leads/handoff/route';

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe('legacy lead handoff containment', () => {
  it('never parses or creates a project when only the legacy shared credential is present', async () => {
    vi.stubEnv('LEADS_INTEGRATION_KEY', 'test-only-integration-key');
    const request = new Request('https://vision.example.test/api/integrations/leads/handoff', { method: 'POST', headers: { 'x-integration-key': 'test-only-integration-key', 'x-organization-id': 'forged-tenant' }, body: '{}' });
    const parse = vi.spyOn(request, 'json');
    const response = await POST(request);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'HANDOFF_AUTH_NOT_CONFIGURED' } });
    expect(parse).not.toHaveBeenCalled();
    expect(mocks.repository).not.toHaveBeenCalled();
  });
});
