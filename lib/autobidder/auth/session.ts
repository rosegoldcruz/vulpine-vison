import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Principal, UserRole } from '@/types/canonical';

const COOKIE_NAME = 'vulpine_session';

interface SessionPayload {
  sub: string;
  name: string;
  role: UserRole;
  org: string;
  scopes: string[];
  exp: number;
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signature(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

function sessionSecret(): string | null {
  return process.env.AUTOBIDDER_SESSION_SECRET?.trim() || null;
}

export function issueSession(principal: Principal, ttlSeconds = 8 * 60 * 60): string {
  const secret = sessionSecret();
  if (!secret || secret.length < 32) throw new Error('Authentication is not configured: AUTOBIDDER_SESSION_SECRET must be at least 32 characters.');
  const payload: SessionPayload = {
    sub: principal.id,
    name: principal.displayName,
    role: principal.role,
    org: principal.organizationId,
    scopes: principal.scopes,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = encode(JSON.stringify(payload));
  return `${body}.${signature(body, secret)}`;
}

export function verifySession(token: string | undefined): Principal | null {
  const secret = sessionSecret();
  if (!token || !secret || secret.length < 32) return null;
  const [body, candidate] = token.split('.');
  if (!body || !candidate) return null;
  const expected = signature(body, secret);
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  if (candidateBytes.length !== expectedBytes.length || !timingSafeEqual(candidateBytes, expectedBytes)) return null;
  try {
    const payload = JSON.parse(decode(body)) as SessionPayload;
    if (!payload.sub || !payload.org || !payload.role || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return {
      id: payload.sub,
      kind: 'user',
      displayName: payload.name,
      role: payload.role,
      organizationId: payload.org,
      scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
    };
  } catch {
    return null;
  }
}

export function readSessionToken(request: Request): string | undefined {
  const cookie = request.headers.get('cookie') || '';
  return cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
}

export function sessionCookie(token: string, secure = process.env.NODE_ENV === 'production'): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure = process.env.NODE_ENV === 'production'): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

