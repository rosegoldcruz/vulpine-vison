import 'server-only';

import { randomUUID } from 'node:crypto';
import type { ExecutionStatus, JobRun, ProgressEvent } from '@/types/canonical';
import { getDatabase } from '@/lib/autobidder/db/database';
import { ApiServiceError } from '@/lib/autobidder/api/errors';
import { appendMonotonicProgress } from '@/lib/autobidder/processing/progress';
import { requestExecutionControl, type ExecutionControlAction } from '@/lib/autobidder/processing/execution-control';
import {
  normalizeProcessingSettings,
  restoreProcessingDefaults,
  type ProcessingSettings,
} from '@/lib/autobidder/processing/settings';
import { detectStalledRun } from '@/lib/autobidder/processing/stall-detection';
import { estimateRollingEta } from '@/lib/autobidder/processing/eta';
import { createNotification } from '@/lib/autobidder/services/notification-service';
import { boundedExponentialBackoffMs, shouldAutomaticallyRetry, type RetryFailureInput } from '@/lib/autobidder/processing/retry-policy';

type RunRow = {
  id: string;
  bid_job_id: string;
  status: ExecutionStatus;
  current_stage: string | null;
  last_progress_at: string | null;
  heartbeat_at: string | null;
  checkpoint_json: string | null;
  attempt: number;
  next_attempt_at: string | null;
  control_reason: string | null;
  started_at: string | null;
  completed_at: string | null;
  version: number;
};

function mapRun(row: RunRow): JobRun {
  return {
    id: row.id,
    bidJobId: row.bid_job_id,
    status: row.status,
    currentStage: row.current_stage || undefined,
    lastProgressAt: row.last_progress_at || undefined,
    heartbeatAt: row.heartbeat_at || undefined,
    checkpoint: row.checkpoint_json ? JSON.parse(row.checkpoint_json) : undefined,
    attempt: row.attempt,
    nextAttemptAt: row.next_attempt_at || undefined,
    controlReason: row.control_reason || undefined,
    startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
    version: row.version,
  };
}

function runRow(runId: string): RunRow | undefined {
  return getDatabase().prepare('SELECT * FROM job_runs WHERE id = ?').get(runId) as RunRow | undefined;
}

export function getJobRun(runId: string): JobRun | null {
  const row = runRow(runId);
  return row ? mapRun(row) : null;
}

export function createJobRun(bidJobId: string): JobRun {
  const job = getDatabase().prepare('SELECT id FROM bid_jobs WHERE id = ?').get(bidJobId);
  if (!job) throw new ApiServiceError('JOB_NOT_FOUND', 'Job not found.', 404, { bidJobId });
  const id = randomUUID();
  getDatabase()
    .prepare('INSERT INTO job_runs (id, bid_job_id, status, attempt, version) VALUES (?, ?, ?, 1, 1)')
    .run(id, bidJobId, 'waiting');
  return mapRun(runRow(id)!);
}

export function latestJobRun(bidJobId: string): JobRun | null {
  const row = getDatabase()
    .prepare('SELECT * FROM job_runs WHERE bid_job_id = ? AND dismissed_at IS NULL ORDER BY rowid DESC LIMIT 1')
    .get(bidJobId) as RunRow | undefined;
  return row ? mapRun(row) : null;
}

export function listProgressEvents(runId: string): ProgressEvent[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM progress_events WHERE run_id = ? ORDER BY sequence')
    .all(runId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    runId: String(row.run_id),
    sequence: Number(row.sequence),
    stage: row.stage as ExecutionStatus,
    unit: String(row.unit),
    completed: Number(row.completed),
    total: row.total === null ? undefined : Number(row.total),
    message: row.message === null ? undefined : String(row.message),
    occurredAt: String(row.occurred_at),
  }));
}

export function recordProgress(input: Omit<ProgressEvent, 'id' | 'sequence' | 'occurredAt'> & { occurredAt?: string }): ProgressEvent {
  const run = runRow(input.runId);
  if (!run) throw new ApiServiceError('RUN_NOT_FOUND', 'Processing run not found.', 404, { runId: input.runId });
  const history = listProgressEvents(input.runId);
  const event: ProgressEvent = {
    ...input,
    id: randomUUID(),
    sequence: (history.at(-1)?.sequence || 0) + 1,
    occurredAt: input.occurredAt || new Date().toISOString(),
  };
  appendMonotonicProgress(history, event);
  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO progress_events (id, run_id, sequence, stage, unit, completed, total, message, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(event.id, event.runId, event.sequence, event.stage, event.unit, event.completed, event.total ?? null, event.message ?? null, event.occurredAt);
    db.prepare(
      `UPDATE job_runs SET status = ?, current_stage = ?, last_progress_at = ?, heartbeat_at = ?,
       started_at = COALESCE(started_at, ?), version = version + 1 WHERE id = ?`,
    ).run(event.stage, event.stage, event.occurredAt, event.occurredAt, event.occurredAt, event.runId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return event;
}

export function controlJobRun(runId: string, action: ExecutionControlAction, reason?: string): JobRun {
  const row = runRow(runId);
  if (!row) throw new ApiServiceError('RUN_NOT_FOUND', 'Processing run not found.', 404, { runId });
  let transition;
  try {
    transition = requestExecutionControl(row.status, action);
  } catch (error) {
    throw new ApiServiceError('INVALID_EXECUTION_CONTROL', error instanceof Error ? error.message : 'Invalid control.', 409, {
      runId,
      status: row.status,
      action,
    });
  }
  const isRetry = action === 'retry' && transition.changed;
  getDatabase()
    .prepare('UPDATE job_runs SET status = ?, control_reason = ?, next_attempt_at=NULL, attempt=attempt+?, completed_at=?, version = version + 1 WHERE id = ?')
    .run(transition.to, reason || null, isRetry ? 1 : 0, isRetry ? null : row.completed_at, runId);
  return mapRun(runRow(runId)!);
}

export function scheduleAutomaticRetry(runId: string, failure: RetryFailureInput, principalId: string, nowMs = Date.now()) {
  const row = runRow(runId);
  if (!row) throw new ApiServiceError('RUN_NOT_FOUND', 'Processing run not found.', 404, { runId });
  const settings = getProcessingSettings(principalId);
  const decision = shouldAutomaticallyRetry(failure, row.attempt, settings);
  if (!decision.retryable) return { scheduled: false as const, decision, run: mapRun(row), delayMs: 0 };
  const delayMs = boundedExponentialBackoffMs(row.attempt, settings.retryBaseDelayMs, settings.retryMaximumDelayMs);
  const nextAttemptAt = new Date(nowMs + delayMs).toISOString();
  getDatabase().prepare(`UPDATE job_runs SET status='retry_wait', next_attempt_at=?, control_reason=?, version=version+1 WHERE id=?`)
    .run(nextAttemptAt, decision.reason, runId);
  return { scheduled: true as const, decision, run: mapRun(runRow(runId)!), delayMs };
}

export function completeJobRun(runId: string, message = 'Processing completed.'): JobRun {
  const row = runRow(runId);
  if (!row) throw new ApiServiceError('RUN_NOT_FOUND', 'Processing run not found.', 404, { runId });
  if (row.status === 'canceled') {
    throw new ApiServiceError('INVALID_EXECUTION_CONTROL', 'A canceled run cannot be completed.', 409, { runId });
  }
  const now = new Date().toISOString();
  getDatabase().prepare(
    `UPDATE job_runs SET status='completed', current_stage='completed', heartbeat_at=?, last_progress_at=?,
     completed_at=?, control_reason=?, next_attempt_at=NULL, version=version+1 WHERE id=?`,
  ).run(now, now, now, message, runId);
  return mapRun(runRow(runId)!);
}

export function failJobRun(runId: string, reason: string): JobRun {
  const row = runRow(runId);
  if (!row) throw new ApiServiceError('RUN_NOT_FOUND', 'Processing run not found.', 404, { runId });
  const now = new Date().toISOString();
  getDatabase().prepare(
    `UPDATE job_runs SET status='failed', heartbeat_at=?, completed_at=?, control_reason=?,
     next_attempt_at=NULL, version=version+1 WHERE id=?`,
  ).run(now, now, reason, runId);
  return mapRun(runRow(runId)!);
}

export function checkpointJobRun(runId: string): JobRun {
  const row = runRow(runId);
  if (!row) throw new ApiServiceError('RUN_NOT_FOUND', 'Processing run not found.', 404, { runId });
  if (row.status === 'pause_requested') {
    getDatabase().prepare(`UPDATE job_runs SET status='paused', heartbeat_at=?, version=version+1 WHERE id=?`)
      .run(new Date().toISOString(), runId);
    throw new ApiServiceError('RUN_PAUSED', 'Processing paused at a durable stage boundary.', 409, { runId });
  }
  if (row.status === 'cancel_requested') {
    const now = new Date().toISOString();
    getDatabase().prepare(`UPDATE job_runs SET status='canceled', heartbeat_at=?, completed_at=?, version=version+1 WHERE id=?`)
      .run(now, now, runId);
    throw new ApiServiceError('RUN_CANCELED', 'Processing canceled at a durable stage boundary.', 409, { runId });
  }
  if (row.status === 'paused') throw new ApiServiceError('RUN_PAUSED', 'Processing is paused.', 409, { runId });
  if (row.status === 'canceled') throw new ApiServiceError('RUN_CANCELED', 'Processing is canceled.', 409, { runId });
  return mapRun(row);
}

export function removeJobRun(runId: string): { id: string; removed: true; disposition: 'dismissed' | 'deleted' } {
  const row = runRow(runId);
  if (!row) throw new ApiServiceError('RUN_NOT_FOUND', 'Processing run not found.', 404, { runId });
  const removable = new Set<ExecutionStatus>(['waiting', 'paused', 'canceled', 'failed', 'stalled', 'completed']);
  if (!removable.has(row.status)) {
    throw new ApiServiceError(
      'RUN_NOT_REMOVABLE',
      `Run must be queued, paused, canceled, failed, stalled, or completed before removal; current status is ${row.status}.`,
      409,
      { runId, status: row.status },
    );
  }
  if (row.status === 'completed') {
    getDatabase().prepare('UPDATE job_runs SET dismissed_at=?, version=version+1 WHERE id=?').run(new Date().toISOString(), runId);
    return { id: runId, removed: true, disposition: 'dismissed' };
  }
  getDatabase().prepare('DELETE FROM job_runs WHERE id = ?').run(runId);
  return { id: runId, removed: true, disposition: 'deleted' };
}

export function getProcessingSettings(principalId: string): ProcessingSettings {
  const row = getDatabase()
    .prepare('SELECT settings_json FROM processing_settings WHERE principal_id = ?')
    .get(principalId) as { settings_json: string } | undefined;
  return row ? normalizeProcessingSettings(JSON.parse(row.settings_json)) : restoreProcessingDefaults();
}

export function saveProcessingSettings(principalId: string, input: Partial<ProcessingSettings>): ProcessingSettings {
  const settings = normalizeProcessingSettings(input);
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO processing_settings
       (principal_id, automatic_retries, max_attempts, retry_delay_ms, retry_server_errors, worker_concurrency, stall_threshold_ms, updated_at, settings_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(principal_id) DO UPDATE SET automatic_retries=excluded.automatic_retries,
       max_attempts=excluded.max_attempts, retry_delay_ms=excluded.retry_delay_ms,
       retry_server_errors=excluded.retry_server_errors, worker_concurrency=excluded.worker_concurrency,
       stall_threshold_ms=excluded.stall_threshold_ms, updated_at=excluded.updated_at, settings_json=excluded.settings_json`,
    )
    .run(
      principalId,
      settings.automaticRetries ? 1 : 0,
      settings.maximumRetryAttempts,
      settings.retryBaseDelayMs,
      settings.retryServerErrors ? 1 : 0,
      settings.workerConcurrency,
      settings.stallThresholdMs,
      now,
      JSON.stringify(settings),
    );
  return settings;
}

export function getRunDiagnostics(runId: string, principalId: string, nowMs = Date.now()) {
  const initial = getJobRun(runId);
  if (!initial) throw new ApiServiceError('RUN_NOT_FOUND', 'Processing run not found.', 404, { runId });
  const settings = getProcessingSettings(principalId);
  const stall = detectStalledRun(initial, { thresholdMs: settings.stallThresholdMs, nowMs });
  let run = initial;
  if (stall.stalled && initial.status !== 'stalled') {
    getDatabase().prepare(`UPDATE job_runs SET status='stalled', control_reason=?, version=version+1 WHERE id=?`).run(
      stall.reason === 'progress_timeout' ? `No measurable progress for ${stall.elapsedMs}ms.` : 'No valid progress timestamp.',
      runId,
    );
    run = getJobRun(runId)!;
    const ownership = getDatabase().prepare(`SELECT b.project_id, b.id AS bid_job_id FROM bid_jobs b JOIN job_runs r ON r.bid_job_id=b.id WHERE r.id=?`).get(runId) as
      | { project_id: string; bid_job_id: string }
      | undefined;
    const existing = getDatabase().prepare(`SELECT id FROM notifications WHERE principal_id=? AND bid_job_id=? AND type='processing_stalled' AND dismissed_at IS NULL LIMIT 1`).get(principalId, ownership?.bid_job_id || '') as { id: string } | undefined;
    if (ownership && !existing) createNotification({
      principalId, projectId: ownership.project_id, bidJobId: ownership.bid_job_id, type: 'processing_stalled', severity: 'critical',
      title: 'Processing stalled', body: run.controlReason || 'The processing run stopped reporting measurable progress.',
      targetPath: `/?job=${encodeURIComponent(ownership.bid_job_id)}&run=${encodeURIComponent(runId)}`,
    });
  }
  const events = listProgressEvents(runId);
  const latest = events.at(-1);
  const eta = latest ? estimateRollingEta(events, {
    stage: latest.stage, unit: latest.unit, status: run.status, nowMs,
    staleAfterMs: settings.stallThresholdMs, stalled: stall.stalled,
  }) : null;
  return {
    run,
    stall,
    eta,
    retry: { automatic: settings.automaticRetries, maximumAttempts: settings.maximumRetryAttempts, attempt: run.attempt, nextAttemptAt: run.nextAttemptAt },
    controls: {
      canPause: ['waiting', 'retry_wait', 'validating', 'uploading', 'rasterizing', 'classifying', 'extracting', 'mapping', 'qa_checking'].includes(run.status),
      canResume: run.status === 'paused',
      canCancel: !['canceled', 'completed', 'failed'].includes(run.status),
      canRetry: ['failed', 'stalled', 'retry_wait'].includes(run.status),
      canRemove: ['waiting', 'paused', 'canceled', 'failed', 'stalled', 'completed'].includes(run.status),
    },
    failureCause: ['failed', 'stalled'].includes(run.status) ? run.controlReason : undefined,
  };
}
