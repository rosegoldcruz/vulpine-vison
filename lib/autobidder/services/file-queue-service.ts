import 'server-only';

import { randomUUID } from 'node:crypto';
import { ApiServiceError } from '@/lib/autobidder/api/errors';
import { getDatabase } from '@/lib/autobidder/db/database';

export type FileQueueStatus = 'waiting' | 'validating' | 'uploading' | 'rasterizing' | 'classifying' | 'extracting' | 'completed' | 'retrying' | 'paused' | 'failed' | 'canceled';

export interface FileQueueItem {
  id: string;
  bidJobId: string;
  sourceDocumentId: string;
  fileName: string;
  originalPath: string;
  status: FileQueueStatus;
  stage?: string;
  completedUnits: number;
  totalUnits?: number;
  attempt: number;
  failureCode?: string;
  failureReason?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

type QueueRow = Record<string, unknown>;

function mapRow(row: QueueRow): FileQueueItem {
  return {
    id: String(row.id), bidJobId: String(row.bid_job_id), sourceDocumentId: String(row.source_document_id),
    fileName: String(row.file_name), originalPath: String(row.original_path), status: row.status as FileQueueStatus,
    stage: row.stage ? String(row.stage) : undefined, completedUnits: Number(row.completed_units),
    totalUnits: row.total_units === null ? undefined : Number(row.total_units), attempt: Number(row.attempt),
    failureCode: row.failure_code ? String(row.failure_code) : undefined,
    failureReason: row.failure_reason ? String(row.failure_reason) : undefined,
    startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined, updatedAt: String(row.updated_at),
  };
}

export function initializeFileQueue(bidJobId: string, sourceDocumentIds: string[]): FileQueueItem[] {
  const db = getDatabase();
  const now = new Date().toISOString();
  const job = db.prepare('SELECT id FROM bid_jobs WHERE id=?').get(bidJobId);
  if (!job) throw new ApiServiceError('JOB_NOT_FOUND', 'Bid job not found.', 404, { bidJobId });
  const insert = db.prepare(`INSERT OR IGNORE INTO file_queue_items
    (id, bid_job_id, source_document_id, status, stage, completed_units, total_units, attempt, updated_at)
    VALUES (?, ?, ?, 'waiting', 'waiting', 0, NULL, 1, ?)`);
  for (const sourceDocumentId of [...new Set(sourceDocumentIds)]) {
    const source = db.prepare('SELECT id FROM source_documents WHERE id=? AND project_id=(SELECT project_id FROM bid_jobs WHERE id=?)').get(sourceDocumentId, bidJobId);
    if (!source) throw new ApiServiceError('INVALID_SOURCE_DOCUMENT', 'Queued source document does not belong to the bid job project.', 409, { sourceDocumentId });
    insert.run(randomUUID(), bidJobId, sourceDocumentId, now);
  }
  return listFileQueue(bidJobId);
}

export function listFileQueue(bidJobId: string): FileQueueItem[] {
  const rows = getDatabase().prepare(`SELECT q.*, d.file_name, d.original_path
    FROM file_queue_items q JOIN source_documents d ON d.id=q.source_document_id
    WHERE q.bid_job_id=? AND q.dismissed_at IS NULL ORDER BY q.rowid`).all(bidJobId) as QueueRow[];
  return rows.map(mapRow);
}

export function updateFileQueueItem(
  bidJobId: string,
  sourceDocumentId: string,
  update: { status: FileQueueStatus; stage?: string; completedUnits?: number; totalUnits?: number; failureCode?: string; failureReason?: string },
): FileQueueItem {
  const current = getDatabase().prepare('SELECT * FROM file_queue_items WHERE bid_job_id=? AND source_document_id=?').get(bidJobId, sourceDocumentId) as QueueRow | undefined;
  if (!current) throw new ApiServiceError('FILE_QUEUE_ITEM_NOT_FOUND', 'File queue item not found.', 404, { bidJobId, sourceDocumentId });
  const completed = update.completedUnits ?? Number(current.completed_units);
  const total = update.totalUnits ?? (current.total_units === null ? undefined : Number(current.total_units));
  if (!Number.isSafeInteger(completed) || completed < 0 || (total !== undefined && (!Number.isSafeInteger(total) || total < completed))) {
    throw new ApiServiceError('INVALID_FILE_PROGRESS', 'File progress must use non-negative integer units and completed may not exceed total.', 400);
  }
  const now = new Date().toISOString();
  const retrying = update.status === 'retrying' && current.status !== 'retrying';
  getDatabase().prepare(`UPDATE file_queue_items SET status=?, stage=?, completed_units=?, total_units=?,
    attempt=attempt+?, failure_code=?, failure_reason=?, started_at=COALESCE(started_at,?),
    completed_at=?, updated_at=? WHERE bid_job_id=? AND source_document_id=?`).run(
      update.status, update.stage ?? update.status, completed, total ?? null, retrying ? 1 : 0,
      update.failureCode ?? null, update.failureReason ?? null, now,
      update.status === 'completed' || update.status === 'failed' || update.status === 'canceled' ? now : null,
      now, bidJobId, sourceDocumentId,
    );
  const row = getDatabase().prepare(`SELECT q.*, d.file_name, d.original_path FROM file_queue_items q
    JOIN source_documents d ON d.id=q.source_document_id WHERE q.bid_job_id=? AND q.source_document_id=?`).get(bidJobId, sourceDocumentId) as QueueRow;
  return mapRow(row);
}

export function cancelWaitingFile(bidJobId: string, queueItemId: string): FileQueueItem {
  const row = getDatabase().prepare('SELECT source_document_id, status FROM file_queue_items WHERE id=? AND bid_job_id=?').get(queueItemId, bidJobId) as { source_document_id: string; status: FileQueueStatus } | undefined;
  if (!row) throw new ApiServiceError('FILE_QUEUE_ITEM_NOT_FOUND', 'File queue item not found.', 404, { queueItemId });
  if (row.status === 'completed') {
    const now = new Date().toISOString();
    getDatabase().prepare('UPDATE file_queue_items SET dismissed_at=?, updated_at=? WHERE id=?').run(now, now, queueItemId);
    const item = getDatabase().prepare(`SELECT q.*, d.file_name, d.original_path FROM file_queue_items q
      JOIN source_documents d ON d.id=q.source_document_id WHERE q.id=?`).get(queueItemId) as QueueRow;
    return mapRow(item);
  }
  if (!['waiting', 'retrying', 'paused'].includes(row.status)) throw new ApiServiceError('FILE_QUEUE_ITEM_ACTIVE', 'Only waiting, retrying, paused, or completed files can be removed from the visible queue.', 409, { status: row.status });
  return updateFileQueueItem(bidJobId, row.source_document_id, { status: 'canceled', stage: 'canceled' });
}
