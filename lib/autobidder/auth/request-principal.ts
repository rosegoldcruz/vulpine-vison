import 'server-only';

import type { Principal } from '@/types/canonical';
import { readSessionToken, verifySession } from '@/lib/autobidder/auth/session';

export function requestPrincipal(request: Request): Principal | null {
  const authenticated = verifySession(readSessionToken(request));
  if (authenticated) return authenticated;

  const url = new URL(request.url);
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (process.env.NODE_ENV !== 'production' && isLoopback) {
    return {
      id: 'local-development-user',
      kind: 'user',
      displayName: 'Local Estimator',
      role: 'admin',
      organizationId: 'local',
      scopes: [],
    };
  }
  return null;
}

