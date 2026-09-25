import 'server-only';

import { randomUUID } from 'node:crypto';
import type { Principal } from '@/types/canonical';
import { ApiServiceError } from '@/lib/autobidder/api/errors';
import { getDatabase } from '@/lib/autobidder/db/database';

export type NotificationSeverity = 'information' | 'success' | 'warning' | 'critical';

export interface NotificationRecord {
  id: string;
  principalId: string;
  projectId?: string;
  bidJobId?: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  targetPath?: string;
  occurredAt: string;
  readAt?: string;
  dismissedAt?: string;
}

type NotificationRow = {
  id: string;
  principal_id: string;
  project_id: string | null;
  bid_job_id: string | null;
  type: string;
  severity: string;
  title: string;
  body: string;
  target_path: string | null;
  occurred_at: string;
  read_at: string | null;
  dismissed_at: string | null;
};

function mapNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    principalId: row.principal_id,
    projectId: row.project_id || undefined,
    bidJobId: row.bid_job_id || undefined,
    type: row.type,
    severity: row.severity as NotificationSeverity,
    title: row.title,
    body: row.body,
    targetPath: row.target_path || undefined,
    occurredAt: row.occurred_at,
    readAt: row.read_at || undefined,
    dismissedAt: row.dismissed_at || undefined,
  };
}

function internalTargetPath(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const target = value.trim();
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\0') || /^[a-z]+:/i.test(target)) {
    throw new ApiServiceError('INVALID_DEEP_LINK', 'Notification target must be an application-relative path.', 400);
  }
  return target;
}

export function createNotification(input: {
  principalId: string;
  projectId?: string;
  bidJobId?: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  targetPath?: string;
  occurredAt?: string;
}): NotificationRecord {
  const principalId = input.principalId.trim();
  const title = input.title.trim();
  const body = input.body.trim();
  const type = input.type.trim();
  if (!principalId || !title || !body || !type) throw new ApiServiceError('VALIDATION_ERROR', 'Notification principal, type, title, and body are required.', 400);
  if (!new Set<NotificationSeverity>(['information', 'success', 'warning', 'critical']).has(input.severity)) {
    throw new ApiServiceError('VALIDATION_ERROR', 'Notification severity is invalid.', 400);
  }
  if (input.projectId) {
    const project = getDatabase().prepare('SELECT id FROM projects WHERE id = ?').get(input.projectId);
    if (!project) throw new ApiServiceError('PROJECT_NOT_FOUND', 'Project not found.', 404, { projectId: input.projectId });
  }
  if (input.bidJobId) {
    const job = getDatabase().prepare('SELECT project_id FROM bid_jobs WHERE id = ?').get(input.bidJobId) as { project_id: string } | undefined;
    if (!job) throw new ApiServiceError('JOB_NOT_FOUND', 'Bid job not found.', 404, { bidJobId: input.bidJobId });
    if (input.projectId && job.project_id !== input.projectId) throw new ApiServiceError('PROJECT_JOB_MISMATCH', 'Bid job belongs to another project.', 409);
  }
  const record: NotificationRecord = {
    id: randomUUID(),
    principalId,
    projectId: input.projectId,
    bidJobId: input.bidJobId,
    type,
    severity: input.severity,
    title,
    body,
    targetPath: internalTargetPath(input.targetPath),
    occurredAt: input.occurredAt || new Date().toISOString(),
  };
  getDatabase()
    .prepare(
      `INSERT INTO notifications
       (id, principal_id, project_id, bid_job_id, type, severity, title, body, target_path, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.id,
      record.principalId,
      record.projectId ?? null,
      record.bidJobId ?? null,
      record.type,
      record.severity,
      record.title,
      record.body,
      record.targetPath ?? null,
      record.occurredAt,
    );
  return record;
}

export function createNotificationOnce(input: Parameters<typeof createNotification>[0]): NotificationRecord {
  const existing = getDatabase().prepare(`SELECT * FROM notifications
    WHERE principal_id=? AND type=? AND COALESCE(project_id,'')=COALESCE(?,'') AND COALESCE(bid_job_id,'')=COALESCE(?,'')
      AND dismissed_at IS NULL ORDER BY occurred_at DESC LIMIT 1`)
    .get(input.principalId.trim(), input.type.trim(), input.projectId ?? null, input.bidJobId ?? null) as NotificationRow | undefined;
  return existing ? mapNotification(existing) : createNotification(input);
}

export function listNotifications(
  principal: Principal,
  options: { unreadOnly?: boolean; includeDismissed?: boolean; projectId?: string } = {},
): NotificationRecord[] {
  const clauses = ['principal_id = ?'];
  const parameters: Array<string | number> = [principal.id];
  if (options.unreadOnly) clauses.push('read_at IS NULL');
  if (!options.includeDismissed) clauses.push('dismissed_at IS NULL');
  if (options.projectId) {
    clauses.push('project_id = ?');
    parameters.push(options.projectId);
  }
  const rows = getDatabase()
    .prepare(`SELECT * FROM notifications WHERE ${clauses.join(' AND ')} ORDER BY occurred_at DESC, rowid DESC`)
    .all(...parameters) as NotificationRow[];
  return rows.map(mapNotification);
}

export function updateNotificationState(
  principal: Principal,
  notificationId: string,
  action: 'read' | 'dismiss',
  occurredAt = new Date().toISOString(),
): NotificationRecord {
  const row = getDatabase().prepare('SELECT * FROM notifications WHERE id = ?').get(notificationId) as NotificationRow | undefined;
  if (!row || row.principal_id !== principal.id) {
    throw new ApiServiceError('NOTIFICATION_NOT_FOUND', 'Notification not found.', 404, { notificationId });
  }
  if (action === 'read') {
    getDatabase().prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?').run(occurredAt, notificationId);
  } else if (action === 'dismiss') {
    getDatabase().prepare('UPDATE notifications SET dismissed_at = COALESCE(dismissed_at, ?) WHERE id = ?').run(occurredAt, notificationId);
  } else {
    throw new ApiServiceError('VALIDATION_ERROR', 'Notification action must be read or dismiss.', 400);
  }
  return mapNotification(getDatabase().prepare('SELECT * FROM notifications WHERE id = ?').get(notificationId) as NotificationRow);
}
