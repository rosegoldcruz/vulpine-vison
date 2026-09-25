import 'server-only';

import type { Principal, UserRole } from '@/types/canonical';

export type Permission =
  | 'project:read'
  | 'project:upload'
  | 'unit_mix:modify'
  | 'unit_mix:approve'
  | 'sku:override'
  | 'pricing:change'
  | 'qa:approve'
  | 'bid:mark_safe'
  | 'export:create'
  | 'outreach:send'
  | 'settings:admin'
  | 'engineering:inspect';

const rolePermissions: Record<UserRole, ReadonlySet<Permission>> = {
  viewer: new Set(['project:read']),
  estimator: new Set(['project:read', 'project:upload', 'unit_mix:modify', 'sku:override', 'export:create']),
  reviewer: new Set(['project:read', 'unit_mix:modify', 'unit_mix:approve', 'sku:override', 'pricing:change', 'export:create']),
  approver: new Set([
    'project:read',
    'unit_mix:approve',
    'pricing:change',
    'qa:approve',
    'bid:mark_safe',
    'export:create',
    'outreach:send',
  ]),
  admin: new Set([
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
  ]),
  service: new Set(['project:read', 'project:upload']),
};

export function hasPermission(principal: Principal, permission: Permission): boolean {
  return rolePermissions[principal.role].has(permission) || principal.scopes.includes(permission);
}

export function requirePermission(principal: Principal | null, permission: Permission): asserts principal is Principal {
  if (!principal) throw Object.assign(new Error('Authentication required.'), { code: 'UNAUTHENTICATED', status: 401 });
  if (!hasPermission(principal, permission)) {
    throw Object.assign(new Error(`Permission denied: ${permission}`), { code: 'FORBIDDEN', status: 403 });
  }
}

