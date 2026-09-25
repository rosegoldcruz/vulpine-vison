export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { fail, ok } from '@/lib/autobidder/api/response';
import { clearSessionCookie, issueSession, readSessionToken, sessionCookie, verifySession } from '@/lib/autobidder/auth/session';
import type { Principal, UserRole } from '@/types/canonical';

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const principal = verifySession(readSessionToken(request));
  if (!principal) return fail({ code: 'UNAUTHENTICATED', message: 'No valid session.' }, 401);
  return ok({ principal });
}

export async function POST(request: Request) {
  const configuredEmail = process.env.AUTOBIDDER_ADMIN_EMAIL?.trim();
  const configuredPassword = process.env.AUTOBIDDER_ADMIN_PASSWORD;
  if (!configuredEmail || !configuredPassword || !process.env.AUTOBIDDER_SESSION_SECRET) {
    return fail({ code: 'AUTH_NOT_CONFIGURED', message: 'Local authentication provider is not configured.' }, 503);
  }

  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!body.email || !body.password || !safeEqual(body.email, configuredEmail) || !safeEqual(body.password, configuredPassword)) {
    return fail({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.' }, 401);
  }

  const role = (process.env.AUTOBIDDER_ADMIN_ROLE || 'admin') as UserRole;
  const principal: Principal = {
    id: `local:${configuredEmail}`,
    kind: 'user',
    displayName: configuredEmail,
    role,
    organizationId: process.env.AUTOBIDDER_ORGANIZATION_ID || 'local',
    scopes: [],
  };
  const response = ok({ principal });
  response.headers.set('Set-Cookie', sessionCookie(issueSession(principal)));
  return response;
}

export async function DELETE() {
  const response = ok({ signedOut: true });
  response.headers.set('Set-Cookie', clearSessionCookie());
  return response;
}

