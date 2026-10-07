import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@/types/canonical';

const mocks = vi.hoisted(() => ({ principal: vi.fn(), chat: vi.fn(), env: vi.fn() }));
vi.mock('@/lib/autobidder/auth/request-principal', () => ({ requestPrincipal: mocks.principal }));
vi.mock('@/lib/autobidder/services/chat-service', () => ({ runChat: mocks.chat }));
vi.mock('@/lib/autobidder/env/server-env', () => ({ getServerEnv: mocks.env }));
const principal: Principal = { id: 'reader', kind: 'user', displayName: 'Reader', role: 'viewer', organizationId: 'tenant-a', scopes: [] };

let clockWindow = 0;
beforeEach(() => {
  vi.resetModules();
  clockWindow += 1;
  vi.spyOn(Date, 'now').mockReturnValue(1_900_000_000_000 + clockWindow * 60001);
  mocks.principal.mockReturnValue(principal);
});
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const request = (body: unknown) => new Request('https://vision.example.test/api/chat', { method: 'POST', body: JSON.stringify(body) });

describe('paid AI request boundaries', () => {
  it('rejects oversized JSON, message and conversation inputs before calling a provider', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const largeMessage = await POST(request({ message: 'a'.repeat(20001) }));
    expect(largeMessage.status).toBe(400);
    const largeHistory = await POST(request({ message: 'hello', history: Array.from({ length: 41 }, () => ({ role: 'user', text: 'hello' })) }));
    expect(largeHistory.status).toBe(400);
    const largeBody = await POST(request({ message: 'hello', extra: 'a'.repeat(128 * 1024) }));
    expect(largeBody.status).toBe(413);
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it('rejects anonymous requests before provider calls or parsing large bodies', async () => {
    mocks.principal.mockReturnValue(null);
    const { POST } = await import('@/app/api/chat/route');
    const response = await POST(request({ message: 'a'.repeat(128 * 1024) }));
    expect(response.status).toBe(401);
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it('limits in-flight calls and releases capacity after provider completion', async () => {
    const completed: Array<(text: string) => void> = [];
    mocks.chat.mockImplementation(() => new Promise<string>(resolve => completed.push(resolve)));
    const { POST } = await import('@/app/api/chat/route');
    const first = POST(request({ message: 'hello' }));
    const second = POST(request({ message: 'hello' }));
    await vi.waitFor(() => expect(mocks.chat).toHaveBeenCalledTimes(2));
    expect((await POST(request({ message: 'hello' }))).status).toBe(429);
    completed.forEach(resolve => resolve('done'));
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    mocks.chat.mockResolvedValue('done');
    expect((await POST(request({ message: 'hello' }))).status).toBe(200);
  });

  it('enforces request windows, tenant separation and total process concurrency', async () => {
    const { acquireAiRequest } = await import('@/lib/autobidder/services/ai-request-limit');
    for (let index = 0; index < 20; index += 1) acquireAiRequest(principal)();
    expect(() => acquireAiRequest(principal)).toThrow(/limit/i);
    acquireAiRequest({ ...principal, organizationId: 'tenant-b' })();
    vi.mocked(Date.now).mockReturnValue(1_900_000_000_000 + clockWindow * 60001 + 60000);
    const releases = [acquireAiRequest(principal), acquireAiRequest(principal), acquireAiRequest({ ...principal, id: 'second' }), acquireAiRequest({ ...principal, id: 'second' })];
    expect(() => acquireAiRequest({ ...principal, id: 'third' })).toThrow(/limit/i);
    vi.resetModules();
    const separateRouteModule = await import('@/lib/autobidder/services/ai-request-limit');
    expect(() => separateRouteModule.acquireAiRequest({ ...principal, id: 'third' })).toThrow(/limit/i);
    releases[0]();
    acquireAiRequest({ ...principal, id: 'third' })();
    releases.forEach(release => release());
  });

  it('bounds generation output and attaches a provider cancellation deadline', async () => {
    mocks.env.mockReturnValue({ LLM_MODE: 'text', LLM_MODEL: 'muse-spark-1.3-contributor', OPENAI_VOICE_MODEL: 'gpt-4o-mini', METAMUSE_API_KEY: 'test', METAMUSE_BASE_URL: 'https://provider.example.test/v1' });
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ choices: [{ message: { content: 'bounded response' } }] }));
    vi.stubGlobal('fetch', fetch);
    const { generateChatCompletion } = await import('@/lib/autobidder/services/llm-service');
    expect(await generateChatCompletion({ history: [], message: 'hello' })).toBe('bounded response');
    const options = fetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(options.body as string).max_tokens).toBeLessThanOrEqual(4096);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    await expect(generateChatCompletion({ history: Array.from({ length: 6 }, () => ({ role: 'user', text: 'a'.repeat(20000) })), message: 'hello' })).rejects.toThrow(/context exceeds/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
