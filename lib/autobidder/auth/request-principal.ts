import 'server-only';

import type { Principal } from '@/types/canonical';
import { readSessionToken, verifySession } from '@/lib/autobidder/auth/session';
import {
  constantTimeEqual,
  VISION_TRUSTED_PRINCIPAL_HEADER,
  verifyTrustedVisionPrincipal,
  visionBearerToken,
} from '@/lib/platform/trusted-principal';

export function requestPrincipal(request: Request): Principal | null {
  const authenticated = verifySession(readSessionToken(request));
  if (authenticated) return authenticated;

  const configuredToken = (process.env.VISION_API_TOKEN || '').trim();
  const providedToken = visionBearerToken(request);
  if (constantTimeEqual(providedToken, configuredToken)) {
    const trusted = verifyTrustedVisionPrincipal(
      request.headers.get(VISION_TRUSTED_PRINCIPAL_HEADER) || '',
      configuredToken,
    );
    if (trusted.valid) return trusted.principal;
  }

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
