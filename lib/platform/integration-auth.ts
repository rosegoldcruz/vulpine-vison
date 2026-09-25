import 'server-only';

import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import type { Principal } from '@/types/canonical';
import type { Permission } from '@/lib/autobidder/auth/authorization';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';

export const VISION_INTEGRATION_AUTH_HEADER = 'x-vulpine-integration-key';

type AuthDecision =
  | { allowed: true; actor: string }
  | { allowed: false; status: 401 | 503; code: 'UNAUTHORIZED' | 'INTEGRATION_NOT_CONFIGURED'; message: string };

export function constantTimeEqual(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export function authenticateVisionRequest(input: {
  configuredToken: string;
  providedToken: string;
  directLoopback?: boolean;
}): AuthDecision {
  if (input.directLoopback) return { allowed: true, actor: 'server-local' };
  if (!input.configuredToken) {
    return {
      allowed: false,
      status: 503,
      code: 'INTEGRATION_NOT_CONFIGURED',
      message: 'Vision integration authentication is not configured.',
    };
  }
  if (!constantTimeEqual(input.providedToken, input.configuredToken)) {
    return { allowed: false, status: 401, code: 'UNAUTHORIZED', message: 'Invalid integration credentials.' };
  }
  return { allowed: true, actor: 'backoffice-service' };
}

function normalizeCorrelationId(value: string | null): string {
  const candidate = value?.trim() || '';
  return /^[a-zA-Z0-9._:-]{8,128}$/.test(candidate) ? candidate : randomUUID();
}

function isDirectLoopback(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  const loopbackHost = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
  if (!loopbackHost) return false;
  const forwarded = request.headers.get('x-forwarded-for');
  if (!forwarded) return true;
  return forwarded
    .split(',')
    .map((address) => address.trim())
    .every((address) => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1');
}

function normalizedActor(request: Request, fallback: string): string {
  const actor = request.headers.get('x-vulpine-actor') || '';
  return /^[a-zA-Z0-9@._:-]{1,160}$/.test(actor) ? actor : fallback;
}

function finishResponse(response: Response, input: {
  actor: string;
  correlationId: string;
  method: string;
  route: string;
  startedAt: number;
}): Response {
  response.headers.set('x-correlation-id', input.correlationId);
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'vision',
    method: input.method,
    route: input.route,
    status: response.status,
    correlationId: input.correlationId,
    actor: input.actor,
    durationMs: Date.now() - input.startedAt,
  }));
  return response;
}

export function withVisionIntegration<TArgs extends unknown[]>(
  route: string,
  handler: (request: Request, ...args: TArgs) => Promise<Response> | Response,
) {
  return async (request: Request, ...args: TArgs): Promise<Response> => {
    const startedAt = Date.now();
    const correlationId = normalizeCorrelationId(request.headers.get('x-correlation-id'));
    const decision = authenticateVisionRequest({
      configuredToken: (process.env.VISION_API_TOKEN || '').trim(),
      providedToken: request.headers.get(VISION_INTEGRATION_AUTH_HEADER) || '',
      directLoopback: isDirectLoopback(request),
    });
    const actor = normalizedActor(request, decision.allowed ? decision.actor : 'unknown');

    if (decision.allowed === false) {
      return finishResponse(
        Response.json(
          {
            ok: false,
            error: { code: decision.code, message: decision.message, details: {} },
            meta: { correlationId },
          },
          { status: decision.status },
        ),
        { actor, correlationId, method: request.method, route, startedAt },
      );
    }

    try {
      const response = await handler(request, ...args);
      return finishResponse(response, { actor, correlationId, method: request.method, route, startedAt });
    } catch (error) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        service: 'vision',
        method: request.method,
        route,
        status: 500,
        correlationId,
        actor,
        error: error instanceof Error ? error.name : 'UnknownError',
      }));
      throw error;
    }
  };
}

export function withVisionUserOrIntegration<TArgs extends unknown[]>(
  permission: Permission,
  route: string,
  handler: (request: Request, principal: Principal, ...args: TArgs) => Promise<Response> | Response,
) {
  return async (request: Request, ...args: TArgs): Promise<Response> => {
    const startedAt = Date.now();
    const correlationId = normalizeCorrelationId(request.headers.get('x-correlation-id'));
    const user = requestPrincipal(request);
    if (user) {
      try {
        requirePermission(user, permission);
        const response = await handler(request, user, ...args);
        return finishResponse(response, { actor: user.id, correlationId, method: request.method, route, startedAt });
      } catch (error: any) {
        return finishResponse(Response.json({ ok: false, error: { code: error.code || 'FORBIDDEN', message: error.message || 'Permission denied.', details: error.details || {} }, meta: { correlationId } }, { status: error.status || 403 }), { actor: user.id, correlationId, method: request.method, route, startedAt });
      }
    }
    const decision = authenticateVisionRequest({
      configuredToken: (process.env.VISION_API_TOKEN || '').trim(),
      providedToken: request.headers.get(VISION_INTEGRATION_AUTH_HEADER) || '',
      directLoopback: isDirectLoopback(request),
    });
    const actor = normalizedActor(request, decision.allowed ? decision.actor : 'unknown');
    if (decision.allowed === false) {
      return finishResponse(Response.json({ ok: false, error: { code: decision.code, message: decision.message, details: {} }, meta: { correlationId } }, { status: decision.status }), { actor, correlationId, method: request.method, route, startedAt });
    }
    const service: Principal = { id: actor, kind: 'service', displayName: actor, role: 'service', organizationId: 'local', scopes: [permission] };
    const response = await handler(request, service, ...args);
    return finishResponse(response, { actor, correlationId, method: request.method, route, startedAt });
  };
}
