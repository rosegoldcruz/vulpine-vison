import 'server-only';

import { randomUUID } from 'node:crypto';
import type { Principal } from '@/types/canonical';
import { getDatabase, withTransaction } from '@/lib/autobidder/db/database';
import { assertProjectAccess } from '@/lib/autobidder/auth/resource-access';
import { ApiServiceError } from '@/lib/autobidder/api/errors';

export interface ProjectComment {
  id: string; projectId: string; authorId: string; body: string; context: string;
  resourceType?: string; resourceId?: string; createdAt: string; updatedAt: string;
}

function map(row: Record<string, unknown>): ProjectComment {
  return { id: String(row.id), projectId: String(row.project_id), authorId: String(row.author_id), body: String(row.body),
    context: String(row.context), resourceType: row.resource_type ? String(row.resource_type) : undefined,
    resourceId: row.resource_id ? String(row.resource_id) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function listProjectComments(projectId: string, principal: Principal): ProjectComment[] {
  assertProjectAccess(projectId, principal);
  return (getDatabase().prepare('SELECT * FROM project_comments WHERE project_id=? ORDER BY created_at DESC').all(projectId) as Array<Record<string, unknown>>).map(map);
}

export function createProjectComment(projectId: string, input: { body: string; context?: string; resourceType?: string; resourceId?: string }, principal: Principal): ProjectComment {
  assertProjectAccess(projectId, principal);
  const body = input.body?.trim();
  if (!body || body.length > 5000) throw new ApiServiceError('VALIDATION_ERROR', 'Comment body is required and must be at most 5,000 characters.', 400);
  const context = input.context?.trim() || 'review';
  if (context.length > 80) throw new ApiServiceError('VALIDATION_ERROR', 'Comment context is too long.', 400);
  const id = randomUUID(); const now = new Date().toISOString();
  withTransaction((db) => {
    db.prepare(`INSERT INTO project_comments (id, project_id, author_id, body, context, resource_type, resource_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, principal.id, body, context, input.resourceType?.trim() || null, input.resourceId?.trim() || null, now, now);
    db.prepare(`INSERT INTO audit_events
      (id, organization_id, project_id, actor_id, actor_kind, action, resource_type, resource_id, after_json, outcome, occurred_at)
      VALUES (?, ?, ?, ?, ?, 'project_comment.created', 'project_comment', ?, ?, 'accepted', ?)`)
      .run(randomUUID(), principal.organizationId, projectId, principal.id, principal.kind, id, JSON.stringify({ body, context, resourceType: input.resourceType, resourceId: input.resourceId }), now);
  });
  return map(getDatabase().prepare('SELECT * FROM project_comments WHERE id=?').get(id) as Record<string, unknown>);
}
