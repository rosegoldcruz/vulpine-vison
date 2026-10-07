import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@/types/canonical';

const mocks = vi.hoisted(() => ({ principal: vi.fn(), catalog: vi.fn() }));
vi.mock('@/lib/autobidder/auth/request-principal', () => ({ requestPrincipal: mocks.principal }));
vi.mock('@/lib/autobidder/llm/model-catalog', () => ({ buildProviderCatalog: mocks.catalog }));
import { GET } from '@/app/api/chat/models/route';

afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('provider discovery authorization', () => {
  it('rejects anonymous requests before catalog construction or credentialed provider requests', async () => {
    mocks.principal.mockReturnValue(null);
    mocks.catalog.mockReturnValue([{ id: 'openai', apiKeyEnvVar: 'TEST_PROVIDER_KEY', keyConfigured: true, models: [], baseUrlDefault: 'https://provider.example.test/v1' }]);
    vi.stubEnv('TEST_PROVIDER_KEY', 'test-only-key');
    const fetch = vi.fn(async () => Response.json({ data: [] }));
    vi.stubGlobal('fetch', fetch);
    const response = await GET(new Request('https://vision.example.test/api/chat/models'));
    expect(response.status).toBe(401);
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves discovery for an authorized reader', async () => {
    const principal: Principal = { id: 'reader', kind: 'user', displayName: 'Reader', role: 'viewer', organizationId: 'tenant-a', scopes: [] };
    mocks.principal.mockReturnValue(principal);
    mocks.catalog.mockReturnValue([{ id: 'openai', keyConfigured: false, models: [] }]);
    const response = await GET(new Request('https://vision.example.test/api/chat/models'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { providers: [{ id: 'openai', source: 'static' }] } });
  });
});
