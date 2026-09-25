import 'server-only';

import { randomUUID } from 'node:crypto';
import { getDatabase, withTransaction } from '@/lib/autobidder/db/database';
import {
  aggregateCompletedBidValues,
  aggregateOperatingTrend,
  aggregateOutreachVelocity,
  aggregatePipelineLiquidity,
  type CompletedBidFilters,
  type CompletedBidGroup,
} from './analytics';
import {
  OPERATING_EVENT_TYPES,
  PIPELINE_STAGES,
  type CompletedBidRecord,
  type DealRecord,
  type FreightQuote,
  type MapRouteEstimate,
  type OperatingEvent,
  type OperatingEventType,
  type PipelineStage,
} from './domain';
import { selectFreightGrounding } from './logistics';
import { getCanonicalBidSnapshot } from '@/lib/autobidder/services/canonical-bid-service';
import type { Principal } from '@/types/canonical';

type JsonObject = Record<string, unknown>;

function serviceError(code: string, message: string, status = 400): Error {
  return Object.assign(new Error(message), { code, status });
}

function parseJson(value: string | null | undefined): JsonObject {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw serviceError('VALIDATION_FAILED', `${field} is required.`);
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function money(value: unknown, field: string): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw serviceError('VALIDATION_FAILED', `${field} must be a non-negative integer number of cents.`);
  }
  return Number(value);
}

function stringList(value: unknown, field: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw serviceError('VALIDATION_FAILED', `${field} must be an array of strings.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function assertProject(projectId: string) {
  const row = getDatabase().prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!row) throw serviceError('PROJECT_NOT_FOUND', 'Project not found.', 404);
}

function audit(input: {
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  projectId?: string | null;
  before?: unknown;
  after?: unknown;
  outcome?: string;
  reason?: string | null;
}) {
  const organization = input.projectId
    ? getDatabase().prepare('SELECT organization_id FROM projects WHERE id=?').get(input.projectId) as { organization_id: string } | undefined
    : undefined;
  getDatabase().prepare(`
    INSERT INTO audit_events
      (id, organization_id, project_id, actor_id, actor_kind, action, resource_type, resource_id,
       before_json, after_json, outcome, reason, occurred_at)
    VALUES (?, ?, ?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), organization?.organization_id || 'system', input.projectId || null, input.actorId, input.action, input.resourceType, input.resourceId,
    input.before === undefined ? null : JSON.stringify(input.before),
    input.after === undefined ? null : JSON.stringify(input.after),
    input.outcome || 'accepted', input.reason || null, new Date().toISOString(),
  );
}

interface DealRow {
  id: string;
  project_id: string;
  stage: string;
  approved_bid_cents: number | null;
  currency: string;
  payload_json: string;
  updated_at: string;
}

function dealFromRow(row: DealRow): DealRecord {
  const payload = parseJson(row.payload_json);
  return {
    id: row.id,
    projectId: row.project_id,
    stage: row.stage as PipelineStage,
    stageEnteredAt: typeof payload.stageEnteredAt === 'string' ? payload.stageEnteredAt : row.updated_at,
    bidAmount: row.approved_bid_cents == null ? null : { amountCents: row.approved_bid_cents, currency: row.currency },
    unitCount: typeof payload.unitCount === 'number' ? payload.unitCount : null,
    qaStatus: payload.qaStatus === 'passed' || payload.qaStatus === 'failed' || payload.qaStatus === 'pending'
      ? payload.qaStatus : null,
    submittedAt: typeof payload.submittedAt === 'string' ? payload.submittedAt : null,
    awardedAt: typeof payload.awardedAt === 'string' ? payload.awardedAt : null,
    lostAt: typeof payload.lostAt === 'string' ? payload.lostAt : null,
  };
}

export interface SaveDealInput {
  id?: string;
  projectId: string;
  companyName: string;
  stage: PipelineStage;
  approvedBidCents?: number | null;
  expectedRevenueCents?: number | null;
  realizedRevenueCents?: number | null;
  currency?: string;
  unitCount?: number | null;
  qaStatus?: 'pending' | 'passed' | 'failed' | null;
  customerId?: string | null;
  market?: string | null;
  consultant?: string | null;
  cabinetLine?: string | null;
}

export function saveDeal(input: SaveDealInput, actorId: string): DealRecord {
  const projectId = requiredText(input.projectId, 'projectId');
  assertProject(projectId);
  if (!PIPELINE_STAGES.includes(input.stage)) throw serviceError('VALIDATION_FAILED', 'stage is invalid.');
  const companyName = requiredText(input.companyName, 'companyName');
  const currency = requiredText(input.currency || 'USD', 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw serviceError('VALIDATION_FAILED', 'currency must be a three-letter ISO code.');
  const approved = money(input.approvedBidCents, 'approvedBidCents');
  const expected = money(input.expectedRevenueCents, 'expectedRevenueCents');
  const realized = money(input.realizedRevenueCents, 'realizedRevenueCents');
  const unitCount = money(input.unitCount, 'unitCount');
  const now = new Date().toISOString();
  const id = input.id?.trim() || randomUUID();
  const existing = getDatabase().prepare('SELECT * FROM deals WHERE id = ?').get(id) as unknown as (DealRow & { payload_json: string }) | undefined;
  if (existing && existing.project_id !== projectId) throw serviceError('DEAL_PROJECT_IMMUTABLE', 'A deal cannot be moved to another project.', 409);
  const previousPayload = existing ? parseJson(existing.payload_json) : {};
  const payload = {
    ...previousPayload,
    stageEnteredAt: !existing || existing.stage !== input.stage ? now : previousPayload.stageEnteredAt || existing.updated_at,
    unitCount,
    qaStatus: input.qaStatus || null,
    customerId: optionalText(input.customerId),
    market: optionalText(input.market),
    consultant: optionalText(input.consultant),
    cabinetLine: optionalText(input.cabinetLine),
    ...(input.stage === 'bid_sent' && !previousPayload.submittedAt ? { submittedAt: now } : {}),
    ...(input.stage === 'awarded' && !previousPayload.awardedAt ? { awardedAt: now } : {}),
    ...(input.stage === 'lost' && !previousPayload.lostAt ? { lostAt: now } : {}),
  };

  withTransaction((db) => {
    db.prepare(`
      INSERT INTO deals
        (id, project_id, company_name, stage, approved_bid_cents, expected_revenue_cents,
         realized_revenue_cents, currency, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        company_name = excluded.company_name, stage = excluded.stage,
        approved_bid_cents = excluded.approved_bid_cents,
        expected_revenue_cents = excluded.expected_revenue_cents,
        realized_revenue_cents = excluded.realized_revenue_cents,
        currency = excluded.currency, payload_json = excluded.payload_json, updated_at = excluded.updated_at
    `).run(id, projectId, companyName, input.stage, approved, expected, realized, currency, JSON.stringify(payload), now, now);
    if (!existing || existing.stage !== input.stage) {
      const eventType = input.stage === 'lead_received' ? 'lead_received'
        : input.stage === 'takeoff' ? 'takeoff_completed'
          : input.stage === 'review' ? 'review_completed'
            : input.stage === 'ready_to_send' ? 'bid_ready'
              : input.stage === 'bid_sent' ? 'bid_sent'
                : input.stage === 'awarded' ? 'award_recorded' : null;
      if (eventType) insertOperatingEvent(db, { type: eventType, projectId, dealId: id, occurredAt: now });
    }
  });
  const saved = getDatabase().prepare('SELECT * FROM deals WHERE id = ?').get(id) as unknown as DealRow;
  audit({ actorId, action: existing ? 'deal.update' : 'deal.create', resourceType: 'deal', resourceId: id, projectId, before: existing || null, after: saved });
  return dealFromRow(saved);
}

export function listDeals(organizationId?: string): DealRecord[] {
  const rows = organizationId
    ? getDatabase().prepare(`SELECT d.* FROM deals d JOIN projects p ON p.id=d.project_id WHERE p.organization_id=? ORDER BY d.updated_at DESC`).all(organizationId)
    : getDatabase().prepare('SELECT * FROM deals ORDER BY updated_at DESC').all();
  return (rows as unknown as DealRow[]).map(dealFromRow);
}

function insertOperatingEvent(db: ReturnType<typeof getDatabase>, input: {
  type: OperatingEventType;
  projectId?: string | null;
  dealId?: string | null;
  occurredAt?: string;
}) {
  const id = randomUUID();
  const occurredAt = input.occurredAt || new Date().toISOString();
  db.prepare(`
    INSERT INTO operational_events (id, project_id, deal_id, type, payload_json, occurred_at)
    VALUES (?, ?, ?, ?, '{}', ?)
  `).run(id, input.projectId || null, input.dealId || null, input.type, occurredAt);
  return { id, type: input.type, projectId: input.projectId || undefined, dealId: input.dealId || undefined, occurredAt };
}

export function recordOperatingEvent(input: {
  type: OperatingEventType;
  projectId?: string | null;
  dealId?: string | null;
  occurredAt?: string;
}, actorId: string): OperatingEvent {
  if (!OPERATING_EVENT_TYPES.includes(input.type)) throw serviceError('VALIDATION_FAILED', 'type is invalid.');
  if (input.projectId) assertProject(input.projectId);
  if (input.occurredAt && !Number.isFinite(Date.parse(input.occurredAt))) throw serviceError('VALIDATION_FAILED', 'occurredAt must be an ISO date.');
  const event = insertOperatingEvent(getDatabase(), input);
  audit({ actorId, action: 'operating_event.record', resourceType: 'operating_event', resourceId: event.id, projectId: input.projectId, after: event });
  return event;
}

export function listOperatingEvents(organizationId?: string): OperatingEvent[] {
  const rows = organizationId
    ? getDatabase().prepare(`SELECT e.id, e.type, e.occurred_at, e.project_id, e.deal_id
        FROM operational_events e JOIN projects p ON p.id=e.project_id
        WHERE p.organization_id=? ORDER BY e.occurred_at`).all(organizationId)
    : getDatabase().prepare('SELECT id, type, occurred_at, project_id, deal_id FROM operational_events ORDER BY occurred_at').all();
  return (rows as Array<{
    id: string; type: OperatingEventType; occurred_at: string; project_id: string | null; deal_id: string | null;
  }>).map((row) => ({
    id: row.id, type: row.type, occurredAt: row.occurred_at,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.deal_id ? { dealId: row.deal_id } : {}),
  }));
}

function completedBids(organizationId?: string): CompletedBidRecord[] {
  const rows = getDatabase().prepare(`
    SELECT d.*, p.name AS project_name
    FROM deals d JOIN projects p ON p.id = d.project_id
    WHERE d.approved_bid_cents IS NOT NULL AND d.stage IN ('ready_to_send', 'bid_sent', 'awarded', 'lost')
      AND (? IS NULL OR p.organization_id = ?)
  `).all(organizationId || null, organizationId || null) as unknown as Array<DealRow & {
    company_name: string; expected_revenue_cents: number | null; realized_revenue_cents: number | null; project_name: string;
  }>;
  return rows.map((row) => {
    const payload = parseJson(row.payload_json);
    const status = row.stage === 'ready_to_send' ? 'approved' : row.stage === 'bid_sent' ? 'submitted' : row.stage as 'awarded' | 'lost';
    const effectiveAt = status === 'submitted' ? payload.submittedAt : status === 'awarded' ? payload.awardedAt : status === 'lost' ? payload.lostAt : payload.stageEnteredAt;
    return {
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      customerId: optionalText(payload.customerId),
      customerName: row.company_name,
      status,
      effectiveAt: typeof effectiveAt === 'string' ? effectiveAt : row.updated_at,
      bidAmount: { amountCents: row.approved_bid_cents!, currency: row.currency },
      expectedRevenue: row.expected_revenue_cents == null ? null : { amountCents: row.expected_revenue_cents, currency: row.currency },
      realizedRevenue: row.realized_revenue_cents == null ? null : { amountCents: row.realized_revenue_cents, currency: row.currency },
      market: optionalText(payload.market),
      consultant: optionalText(payload.consultant),
      cabinetLine: optionalText(payload.cabinetLine),
    };
  });
}

export function readBackofficeAnalytics(options: {
  organizationId?: string;
  now?: Date;
  completedGroupBy?: CompletedBidGroup;
  completedFilters?: CompletedBidFilters;
  outreachPeriodDays?: number;
} = {}) {
  const deals = listDeals(options.organizationId);
  const events = listOperatingEvents(options.organizationId);
  return {
    pipeline: aggregatePipelineLiquidity(deals, { now: options.now }),
    operatingTrend: aggregateOperatingTrend(events, { now: options.now, periodDays: 30 }),
    outreachVelocity: aggregateOutreachVelocity(
      events.filter((event) => event.type === 'outreach_activity'),
      { now: options.now, periodDays: options.outreachPeriodDays || 7 },
    ),
    completedBidValues: aggregateCompletedBidValues(completedBids(options.organizationId), {
      groupBy: options.completedGroupBy,
      filters: options.completedFilters,
    }),
  };
}

export function syncApprovedDealFromBid(input: {
  projectId: string;
  jobId: string;
  companyName: string;
}, principal: Principal): DealRecord {
  const snapshot = getCanonicalBidSnapshot(requiredText(input.jobId, 'jobId'), principal);
  if (snapshot.job.projectId !== input.projectId) {
    throw serviceError('PROJECT_MISMATCH', 'Bid job does not belong to this project.', 409);
  }
  const latestQa = snapshot.qaResults[0];
  if (snapshot.job.state !== 'cabinet_bid_safe_to_send' && snapshot.job.state !== 'exported') {
    throw serviceError('BID_NOT_SAFE_TO_SEND', 'The canonical bid must be safe to send before a deal can be prepared.', 409);
  }
  if (!latestQa?.safeToSend) throw serviceError('QA_APPROVAL_REQUIRED', 'A passing canonical QA result is required.', 409);
  if (!snapshot.estimateLines.length) throw serviceError('ESTIMATE_REQUIRED', 'The approved bid has no estimate lines.', 409);
  const currencies = [...new Set(snapshot.estimateLines.map((line) => line.currency))];
  if (currencies.length !== 1) throw serviceError('MIXED_CURRENCY_BID', 'A customer bid must use one currency.', 409);
  const approvedBidCents = snapshot.estimateLines.reduce((sum, line) => sum + line.extendedCostCents, 0);
  if (!Number.isSafeInteger(approvedBidCents)) throw serviceError('BID_TOTAL_OVERFLOW', 'Approved bid total exceeds safe integer precision.', 409);
  const unitCount = snapshot.unitMixEntries.reduce((sum, entry) => sum + (entry.verifiedCount ?? entry.extractedCount), 0);
  const existing = getDatabase().prepare('SELECT id FROM deals WHERE project_id=? ORDER BY updated_at DESC LIMIT 1').get(input.projectId) as { id: string } | undefined;
  return saveDeal({
    id: existing?.id,
    projectId: input.projectId,
    companyName: input.companyName,
    stage: 'ready_to_send',
    approvedBidCents,
    currency: currencies[0],
    unitCount,
    qaStatus: 'passed',
  }, principal.id);
}

export interface OutreachDraftInput {
  recipient: string;
  scope: string;
  inclusions?: string[];
  exclusions?: string[];
  assumptions?: string[];
  attachmentIds?: string[];
  estimatorSignature: string;
}

interface OutreachRow {
  id: string; project_id: string; deal_id: string | null; status: string; provider: string | null;
  recipient: string; subject: string; body: string; artifact_ids_json: string; created_by: string;
  created_at: string; sent_at: string | null;
}

export function createOutreachDraft(projectId: string, input: OutreachDraftInput, actorId: string) {
  assertProject(projectId);
  const recipient = requiredText(input.recipient, 'recipient');
  if (!/^\S+@\S+\.\S+$/.test(recipient)) throw serviceError('VALIDATION_FAILED', 'recipient must be an email address.');
  const scope = requiredText(input.scope, 'scope');
  const signature = requiredText(input.estimatorSignature, 'estimatorSignature');
  const deal = getDatabase().prepare('SELECT * FROM deals WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1').get(projectId) as unknown as (DealRow & { company_name: string }) | undefined;
  if (!deal) throw serviceError('DEAL_NOT_FOUND', 'A persisted deal is required for bid outreach.', 409);
  if (deal.approved_bid_cents == null) throw serviceError('APPROVED_BID_REQUIRED', 'An approved bid amount is required for outreach.', 409);
  const project = getDatabase().prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string };
  const attachments = stringList(input.attachmentIds, 'attachmentIds');
  if (attachments.length) {
    const placeholders = attachments.map(() => '?').join(', ');
    const found = getDatabase().prepare(`SELECT id FROM export_artifacts WHERE project_id = ? AND id IN (${placeholders}) AND status = 'ready'`).all(projectId, ...attachments) as Array<{ id: string }>;
    if (found.length !== attachments.length) throw serviceError('ATTACHMENT_NOT_AVAILABLE', 'Every attachment must be a generated export for this project.', 409);
  }
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: deal.currency }).format(deal.approved_bid_cents / 100);
  const inclusions = stringList(input.inclusions, 'inclusions');
  const exclusions = stringList(input.exclusions, 'exclusions');
  const assumptions = stringList(input.assumptions, 'assumptions');
  const section = (label: string, values: string[]) => values.length ? `\n${label}:\n${values.map((value) => `- ${value}`).join('\n')}\n` : '';
  const body = [
    `Company: ${deal.company_name}`,
    `Project: ${project.name}`,
    `Scope: ${scope}`,
    `Approved bid amount: ${amount}`,
    section('Inclusions', inclusions),
    section('Exclusions', exclusions),
    section('Assumptions', assumptions),
    signature,
  ].filter(Boolean).join('\n');
  const now = new Date().toISOString();
  const id = randomUUID();
  getDatabase().prepare(`
    INSERT INTO outreach_activities
      (id, project_id, deal_id, status, provider, recipient, subject, body, artifact_ids_json, created_by, created_at)
    VALUES (?, ?, ?, 'draft', NULL, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, deal.id, recipient, `Bid proposal — ${project.name}`, body, JSON.stringify(attachments), actorId, now);
  const result = getOutreach(id)!;
  audit({ actorId, action: 'outreach.draft', resourceType: 'outreach', resourceId: id, projectId, after: result });
  return result;
}

function outreachFromRow(row: OutreachRow) {
  return {
    id: row.id, projectId: row.project_id, dealId: row.deal_id, status: row.status,
    provider: row.provider, recipient: row.recipient, subject: row.subject, body: row.body,
    attachmentIds: JSON.parse(row.artifact_ids_json) as string[], createdBy: row.created_by,
    createdAt: row.created_at, sentAt: row.sent_at,
  };
}

export function getOutreach(id: string) {
  const row = getDatabase().prepare('SELECT * FROM outreach_activities WHERE id = ?').get(id) as unknown as OutreachRow | undefined;
  return row ? outreachFromRow(row) : null;
}

export function listProjectOutreach(projectId: string) {
  assertProject(projectId);
  return (getDatabase().prepare('SELECT * FROM outreach_activities WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as unknown as OutreachRow[]).map(outreachFromRow);
}

export interface EmailDelivery {
  externalId: string;
  acceptedAt: string;
}

export interface EmailTransport {
  provider: string;
  send(message: { recipient: string; subject: string; body: string; attachmentIds: string[] }): Promise<EmailDelivery>;
}

export async function sendOutreach(input: {
  outreachId: string;
  projectId?: string;
  confirmation: string;
  actorId: string;
  transport: EmailTransport;
}) {
  const outreach = getOutreach(input.outreachId);
  if (!outreach) throw serviceError('OUTREACH_NOT_FOUND', 'Outreach draft not found.', 404);
  if (input.projectId && outreach.projectId !== input.projectId) throw serviceError('PROJECT_MISMATCH', 'Outreach does not belong to this project.', 409);
  if (outreach.status !== 'draft') throw serviceError('OUTREACH_NOT_SENDABLE', 'Only a draft can be sent.', 409);
  if (input.confirmation !== 'SEND_APPROVED_BID_OUTREACH') {
    audit({ actorId: input.actorId, action: 'outreach.send', resourceType: 'outreach', resourceId: outreach.id, projectId: outreach.projectId, outcome: 'rejected', reason: 'explicit confirmation missing' });
    throw serviceError('SEND_CONFIRMATION_REQUIRED', 'Explicit send confirmation is required.', 409);
  }
  const job = getDatabase().prepare('SELECT workflow_state FROM bid_jobs WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1').get(outreach.projectId) as { workflow_state: string } | undefined;
  if (!job || !['cabinet_bid_safe_to_send', 'exported'].includes(job.workflow_state)) {
    audit({ actorId: input.actorId, action: 'outreach.send', resourceType: 'outreach', resourceId: outreach.id, projectId: outreach.projectId, outcome: 'rejected', reason: 'bid is not safe to send' });
    throw serviceError('BID_NOT_SAFE_TO_SEND', 'The latest bid must be safe to send (or already exported) before outreach can be sent.', 409);
  }
  let delivery: EmailDelivery;
  try {
    delivery = await input.transport.send({
      recipient: outreach.recipient, subject: outreach.subject, body: outreach.body, attachmentIds: outreach.attachmentIds,
    });
  } catch (error) {
    audit({ actorId: input.actorId, action: 'outreach.send', resourceType: 'outreach', resourceId: outreach.id, projectId: outreach.projectId, outcome: 'failed', reason: error instanceof Error ? error.message : 'provider failure' });
    throw serviceError('EMAIL_DELIVERY_FAILED', 'The configured email provider did not accept the message.', 502);
  }
  const sentAt = delivery.acceptedAt || new Date().toISOString();
  withTransaction((db) => {
    db.prepare("UPDATE outreach_activities SET status = 'sent', provider = ?, sent_at = ? WHERE id = ? AND status = 'draft'")
      .run(input.transport.provider, sentAt, outreach.id);
    insertOperatingEvent(db, { type: 'outreach_activity', projectId: outreach.projectId, dealId: outreach.dealId, occurredAt: sentAt });
  });
  const sent = getOutreach(outreach.id)!;
  audit({ actorId: input.actorId, action: 'outreach.send', resourceType: 'outreach', resourceId: outreach.id, projectId: outreach.projectId, before: outreach, after: { ...sent, externalId: delivery.externalId } });
  return { outreach: sent, delivery };
}

export function saveProviderSnapshot(input: {
  projectId: string;
  providerType: 'company_intelligence' | 'maps';
  providerName: string;
  status: 'connected' | 'degraded' | 'error';
  externalRecordId?: string | null;
  payload: JsonObject;
  retrievedAt?: string | null;
  errorCode?: string | null;
}, actorId: string) {
  assertProject(input.projectId);
  const id = randomUUID();
  const retrievedAt = input.retrievedAt || new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO provider_snapshots
      (id, project_id, provider_type, provider_name, status, external_record_id, payload_json, retrieved_at, error_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.projectId, input.providerType, input.providerName, input.status, input.externalRecordId || null, JSON.stringify(input.payload), retrievedAt, input.errorCode || null);
  const result = { id, ...input, retrievedAt };
  audit({ actorId, action: `${input.providerType}.snapshot`, resourceType: 'provider_snapshot', resourceId: id, projectId: input.projectId, after: result });
  return result;
}

export function listProviderSnapshots(projectId: string, providerType: 'company_intelligence' | 'maps') {
  assertProject(projectId);
  return (getDatabase().prepare(`
    SELECT * FROM provider_snapshots WHERE project_id = ? AND provider_type = ? ORDER BY COALESCE(retrieved_at, '') DESC, rowid DESC
  `).all(projectId, providerType) as Array<{
    id: string; provider_name: string; status: string; external_record_id: string | null; payload_json: string;
    retrieved_at: string | null; error_code: string | null;
  }>).map((row) => ({
    id: row.id, providerType, providerName: row.provider_name, status: row.status,
    externalRecordId: row.external_record_id, payload: parseJson(row.payload_json),
    retrievedAt: row.retrieved_at, errorCode: row.error_code,
  }));
}

export function saveFreightQuote(projectId: string, input: {
  status: FreightQuote['status']; amountCents: number; currency: string; provider?: string | null; note?: string | null;
}, actorId: string): FreightQuote {
  assertProject(projectId);
  if (!['draft', 'approved', 'rejected', 'expired'].includes(input.status)) throw serviceError('VALIDATION_FAILED', 'status is invalid.');
  const amountCents = money(input.amountCents, 'amountCents')!;
  const currency = requiredText(input.currency, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw serviceError('VALIDATION_FAILED', 'currency must be a three-letter ISO code.');
  const now = new Date().toISOString();
  const id = randomUUID();
  const approvedAt = input.status === 'approved' ? now : null;
  getDatabase().prepare(`
    INSERT INTO freight_quotes
      (id, project_id, status, amount_cents, currency, provider, approved_by, approved_at, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, input.status, amountCents, currency, optionalText(input.provider), approvedAt ? actorId : null, approvedAt, JSON.stringify({ note: optionalText(input.note) }), now, now);
  const quote: FreightQuote = { id, status: input.status, amount: { amountCents, currency }, approvedAt, provider: optionalText(input.provider) };
  audit({ actorId, action: 'freight_quote.create', resourceType: 'freight_quote', resourceId: id, projectId, after: quote });
  return quote;
}

function latestApprovedFreightQuote(projectId: string): FreightQuote | null {
  const row = getDatabase().prepare(`
    SELECT * FROM freight_quotes WHERE project_id = ? AND status = 'approved' ORDER BY approved_at DESC LIMIT 1
  `).get(projectId) as { id: string; status: FreightQuote['status']; amount_cents: number; currency: string; approved_at: string | null; provider: string | null } | undefined;
  return row ? { id: row.id, status: row.status, amount: { amountCents: row.amount_cents, currency: row.currency }, approvedAt: row.approved_at, provider: row.provider } : null;
}

export function projectLogistics(projectId: string) {
  const mapSnapshot = listProviderSnapshots(projectId, 'maps').find((snapshot) => snapshot.status === 'connected');
  const payload = mapSnapshot?.payload || null;
  const mapEstimate = payload && typeof payload.distanceMeters === 'number' ? payload as unknown as MapRouteEstimate : null;
  const approvedQuote = latestApprovedFreightQuote(projectId);
  return {
    approvedQuote,
    mapEstimate,
    grounding: selectFreightGrounding({ approvedQuote, mapEstimate }),
    snapshots: listProviderSnapshots(projectId, 'maps'),
  };
}
