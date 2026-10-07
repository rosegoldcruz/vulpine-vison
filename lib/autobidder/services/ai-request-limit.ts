import 'server-only';
import type { Principal } from '@/types/canonical';
import { ApiServiceError } from '@/lib/autobidder/api/errors';

type Usage = { started: number; requests: number; active: number };
type LimitState = { usage: Map<string, Usage>; activeRequests: number };
const stateKey = Symbol.for('vulpine.vision.ai-request-limits');
const processState = globalThis as unknown as Record<symbol, LimitState | undefined>;
const state = processState[stateKey] ??= { usage: new Map<string, Usage>(), activeRequests: 0 };

export function acquireAiRequest(principal: Principal): () => void {
  const now = Date.now();
  for (const [key, item] of state.usage) {
    if (now - item.started >= 60_000 && item.active === 0) state.usage.delete(key);
  }
  const key = JSON.stringify([principal.organizationId, principal.id]);
  let item = state.usage.get(key);
  if (!item) {
    if (state.usage.size >= 1000) throw new ApiServiceError('RATE_LIMITED', 'AI capacity is temporarily full.', 429);
    item = { started: now, requests: 0, active: 0 };
    state.usage.set(key, item);
  }
  if (now - item.started >= 60_000) {
    item.started = now;
    item.requests = 0;
  }
  if (item.requests >= 20 || item.active >= 2 || state.activeRequests >= 4) {
    throw new ApiServiceError('RATE_LIMITED', 'AI request limit reached. Please retry later.', 429);
  }
  item.requests += 1;
  item.active += 1;
  state.activeRequests += 1;
  const claimed = item;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claimed.active -= 1;
    state.activeRequests -= 1;
  };
}
