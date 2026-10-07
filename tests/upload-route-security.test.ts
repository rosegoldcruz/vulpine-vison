import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ access: vi.fn(), parse: vi.fn(), reserve: vi.fn() }));
vi.mock('@/lib/platform/integration-auth', () => ({ withVisionUserOrIntegration: (_permission: string, _route: string, handler: Function) => (request: Request) => handler(request, { id: 'test-estimator', organizationId: 'tenant-a' }) }));
vi.mock('@/lib/autobidder/auth/resource-access', () => ({ assertProjectAccess: mocks.access }));
vi.mock('@/lib/autobidder/ingestion/upload-limits', () => ({ readLimitedUploadFormData: mocks.parse, reserveUpload: mocks.reserve }));
vi.mock('@/lib/autobidder/services/upload-ingestion', () => ({ ingestUploads: vi.fn() }));
import { POST } from '@/app/api/uploads/route';

afterEach(() => vi.clearAllMocks());
describe('upload authorization ordering', () => {
  it('rejects a foreign project before parsing or reserving memory', async () => {
    mocks.access.mockImplementation(() => { throw Object.assign(new Error('Project not found.'), { code: 'NOT_FOUND', status: 404 }); });
    const response = await POST(new Request('https://vision.example.test/api/uploads', { method: 'POST', headers: { 'x-project-id': 'foreign-project' }, body: 'unparsed' }));
    expect(response.status).toBe(404);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
  });
});
