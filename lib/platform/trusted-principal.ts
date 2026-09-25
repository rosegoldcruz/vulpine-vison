import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Permission } from '@/lib/autobidder/auth/authorization';
import type { Principal, UserRole } from '@/types/canonical';

export const VISION_TRUSTED_PRINCIPAL_HEADER = 'x-vulpine-principal';
export const VISION_INTEGRATION_AUTH_HEADER = 'authorization';

const USER_ROLES = new Set<UserRole>(['viewer', 'estimator', 'reviewer', 'approver', 'admin']);
const ALLOWED_SCOPES = new Set<Permission>([
  'project:read',
  'project:upload',
  'unit_mix:modify',
  'unit_mix:approve',
  'sku:override',
  'pricing:change',
  'qa:approve',
  'bid:mark_safe',
  'export:create',
  'outreach:send',
  'settings:admin',
  'engineering:inspect',
]);

const SUBJECT_PATTERN = /^[a-zA-Z0-9@._:-]{1,160}$/;
const ORGANIZATION_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/;
const NONCE_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/;
const BASE64URL_PATTERN = /^[a-zA-Z0-9_-]+$/;
const CLOCK_SKEW_SECONDS = 60;

export function constantTimeEqual(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export function visionBearerToken(request: Request): string {
  const authorization = request.headers.get(VISION_INTEGRATION_AUTH_HEADER)?.trim() || '';
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  return match?.[1] || '';
}

export interface TrustedPrincipalPayload {
  v: 1;
  sub: string;
  org: string;
  role: Exclude<UserRole, 'service'>;
  scopes: Permission[];
  iat: number;
  exp: number;
  nonce: string;
}

export type TrustedPrincipalVerification =
  | { valid: true; payload: TrustedPrincipalPayload; principal: Principal }
  | {
      valid: false;
      code: 'TRUSTED_PRINCIPAL_INVALID' | 'TRUSTED_PRINCIPAL_EXPIRED';
      message: string;
    };

function invalid(message: string): TrustedPrincipalVerification {
  return { valid: false, code: 'TRUSTED_PRINCIPAL_INVALID', message };
}

function decodeBase64Url(segment: string): Buffer | null {
  if (!BASE64URL_PATTERN.test(segment)) return null;
  try {
    const decoded = Buffer.from(segment, 'base64url');
    return decoded.toString('base64url') === segment ? decoded : null;
  } catch {
    return null;
  }
}

function signatureMatches(payloadSegment: string, signatureSegment: string, secret: string): boolean {
  const provided = decodeBase64Url(signatureSegment) ?? Buffer.alloc(0);
  const expected = createHmac('sha256', secret).update(payloadSegment, 'utf8').digest();
  const comparable = Buffer.alloc(expected.length);
  provided.copy(comparable, 0, 0, expected.length);
  const equal = timingSafeEqual(comparable, expected);
  return provided.length === expected.length && equal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePayload(value: unknown): TrustedPrincipalPayload | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  const expectedKeys = ['exp', 'iat', 'nonce', 'org', 'role', 'scopes', 'sub', 'v'];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return null;
  if (value.v !== 1) return null;
  if (typeof value.sub !== 'string' || !SUBJECT_PATTERN.test(value.sub)) return null;
  if (typeof value.org !== 'string' || !ORGANIZATION_PATTERN.test(value.org)) return null;
  if (typeof value.role !== 'string' || !USER_ROLES.has(value.role as UserRole)) return null;
  if (!Array.isArray(value.scopes) || !value.scopes.every((scope) => typeof scope === 'string' && ALLOWED_SCOPES.has(scope as Permission))) return null;
  if (new Set(value.scopes).size !== value.scopes.length) return null;
  if (!Number.isSafeInteger(value.iat) || !Number.isSafeInteger(value.exp)) return null;
  if (typeof value.nonce !== 'string' || !NONCE_PATTERN.test(value.nonce)) return null;
  return value as unknown as TrustedPrincipalPayload;
}

export function verifyTrustedVisionPrincipal(
  compactPrincipal: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): TrustedPrincipalVerification {
  if (!secret || !compactPrincipal) return invalid('A signed trusted principal is required.');
  const segments = compactPrincipal.split('.');
  if (segments.length !== 2 || !segments[0] || !segments[1]) return invalid('The trusted principal format is invalid.');
  const [payloadSegment, signatureSegment] = segments;
  const payloadBytes = decodeBase64Url(payloadSegment);
  if (!payloadBytes || !signatureMatches(payloadSegment, signatureSegment, secret)) {
    return invalid('The trusted principal signature is invalid.');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    return invalid('The trusted principal payload is invalid.');
  }
  const payload = parsePayload(decoded);
  if (!payload) return invalid('The trusted principal claims are invalid.');
  if (payload.iat > nowSeconds + CLOCK_SKEW_SECONDS || payload.exp <= payload.iat) {
    return invalid('The trusted principal time claims are invalid.');
  }
  if (payload.exp <= nowSeconds) {
    return { valid: false, code: 'TRUSTED_PRINCIPAL_EXPIRED', message: 'The trusted principal has expired.' };
  }

  return {
    valid: true,
    payload,
    principal: {
      id: payload.sub,
      kind: 'user',
      displayName: payload.sub,
      role: payload.role,
      organizationId: payload.org,
      scopes: [...payload.scopes],
    },
  };
}
