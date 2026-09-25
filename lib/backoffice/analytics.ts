import {
  OPERATING_EVENT_TYPES,
  PIPELINE_STAGES,
  type CompletedBidRecord,
  type DealRecord,
  type MoneyValue,
  type OperatingEvent,
  type OperatingEventType,
  type PipelineStage,
} from './domain';

const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_STAGES = new Set<PipelineStage>(['awarded', 'lost']);

export interface MoneyTotal {
  currency: string;
  amountCents: number;
}

function validDate(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${field} must be a valid ISO date.`);
  }
  return parsed;
}

function assertMoney(value: MoneyValue, field: string): void {
  if (!Number.isSafeInteger(value.amountCents)) {
    throw new TypeError(`${field}.amountCents must be a safe integer.`);
  }
  if (!value.currency.trim()) {
    throw new TypeError(`${field}.currency is required.`);
  }
}

function sumMoney(values: Array<MoneyValue | null | undefined>): MoneyTotal[] {
  const totals = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    assertMoney(value, 'money');
    const currency = value.currency.toUpperCase();
    totals.set(currency, (totals.get(currency) || 0) + value.amountCents);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amountCents]) => ({ currency, amountCents }));
}

export interface StageLiquidity {
  stage: PipelineStage;
  projectCount: number;
  unitCount: number;
  bidValue: MoneyTotal[];
  averageAgeDays: number | null;
  maximumAgeDays: number | null;
}

export interface PipelineBottleneck {
  stage: PipelineStage;
  projectCount: number;
  projectsOverThreshold: number;
  averageAgeDays: number;
  maximumAgeDays: number;
}

export interface PipelineLiquidity {
  generatedAt: string;
  projectCount: number;
  unitsRepresented: number;
  totalActiveBidValue: MoneyTotal[];
  bidValueAwaitingQa: MoneyTotal[];
  submittedValue: MoneyTotal[];
  awardedValue: MoneyTotal[];
  lostValue: MoneyTotal[];
  stages: StageLiquidity[];
  bottlenecks: PipelineBottleneck[];
}

export function aggregatePipelineLiquidity(
  deals: DealRecord[],
  options: { now?: Date; bottleneckThresholdDays?: number } = {},
): PipelineLiquidity {
  const now = options.now || new Date();
  const nowMs = now.getTime();
  const threshold = options.bottleneckThresholdDays ?? 14;
  if (!Number.isFinite(nowMs)) throw new TypeError('now must be a valid date.');
  if (!Number.isFinite(threshold) || threshold < 0) throw new TypeError('bottleneckThresholdDays must be non-negative.');

  const withAges = deals.map((deal) => {
    const enteredAt = validDate(deal.stageEnteredAt, 'deal.stageEnteredAt');
    const ageDays = Math.max(0, (nowMs - enteredAt) / DAY_MS);
    if (deal.bidAmount) assertMoney(deal.bidAmount, 'deal.bidAmount');
    if (deal.unitCount != null && (!Number.isSafeInteger(deal.unitCount) || deal.unitCount < 0)) {
      throw new TypeError('deal.unitCount must be a non-negative safe integer.');
    }
    return { deal, ageDays };
  });

  const stages = PIPELINE_STAGES.map((stage): StageLiquidity => {
    const stageDeals = withAges.filter((item) => item.deal.stage === stage);
    const ages = stageDeals.map((item) => item.ageDays);
    return {
      stage,
      projectCount: stageDeals.length,
      unitCount: stageDeals.reduce((total, item) => total + (item.deal.unitCount || 0), 0),
      bidValue: sumMoney(stageDeals.map((item) => item.deal.bidAmount)),
      averageAgeDays: ages.length ? ages.reduce((total, age) => total + age, 0) / ages.length : null,
      maximumAgeDays: ages.length ? Math.max(...ages) : null,
    };
  });

  const active = deals.filter((deal) => !TERMINAL_STAGES.has(deal.stage));
  const awaitingQa = active.filter((deal) => deal.qaStatus !== 'passed');
  const submitted = deals.filter((deal) => Boolean(deal.submittedAt));
  const awarded = deals.filter((deal) => deal.stage === 'awarded' || Boolean(deal.awardedAt));
  const lost = deals.filter((deal) => deal.stage === 'lost' || Boolean(deal.lostAt));

  const bottlenecks = stages
    .filter((stage): stage is StageLiquidity & { averageAgeDays: number; maximumAgeDays: number } => stage.averageAgeDays != null)
    .map((stage): PipelineBottleneck => ({
      stage: stage.stage,
      projectCount: stage.projectCount,
      projectsOverThreshold: withAges.filter((item) => item.deal.stage === stage.stage && item.ageDays >= threshold).length,
      averageAgeDays: stage.averageAgeDays,
      maximumAgeDays: stage.maximumAgeDays,
    }))
    .filter((stage) => stage.projectsOverThreshold > 0)
    .sort((left, right) => right.projectsOverThreshold - left.projectsOverThreshold || right.averageAgeDays - left.averageAgeDays);

  return {
    generatedAt: now.toISOString(),
    projectCount: deals.length,
    unitsRepresented: deals.reduce((total, deal) => total + (deal.unitCount || 0), 0),
    totalActiveBidValue: sumMoney(active.map((deal) => deal.bidAmount)),
    bidValueAwaitingQa: sumMoney(awaitingQa.map((deal) => deal.bidAmount)),
    submittedValue: sumMoney(submitted.map((deal) => deal.bidAmount)),
    awardedValue: sumMoney(awarded.map((deal) => deal.bidAmount)),
    lostValue: sumMoney(lost.map((deal) => deal.bidAmount)),
    stages,
    bottlenecks,
  };
}

export interface TrendComparison {
  currentCount: number;
  previousCount: number;
  absoluteChange: number;
  percentChange: number | null;
  zeroBaseline: boolean;
}

export function compareCounts(currentCount: number, previousCount: number): TrendComparison {
  if (!Number.isSafeInteger(currentCount) || currentCount < 0 || !Number.isSafeInteger(previousCount) || previousCount < 0) {
    throw new TypeError('Trend counts must be non-negative safe integers.');
  }
  const absoluteChange = currentCount - previousCount;
  if (previousCount === 0) {
    return {
      currentCount,
      previousCount,
      absoluteChange,
      percentChange: currentCount === 0 ? 0 : null,
      zeroBaseline: true,
    };
  }
  return {
    currentCount,
    previousCount,
    absoluteChange,
    percentChange: (absoluteChange / previousCount) * 100,
    zeroBaseline: false,
  };
}

export interface DailyOperatingCounts {
  date: string;
  counts: Record<OperatingEventType, number>;
}

export interface OperatingTrend {
  generatedAt: string;
  periodDays: number;
  currentStart: string;
  previousStart: string;
  currentDaily: DailyOperatingCounts[];
  previousDaily: DailyOperatingCounts[];
  comparisons: Record<OperatingEventType, TrendComparison>;
}

function emptyEventCounts(): Record<OperatingEventType, number> {
  return Object.fromEntries(OPERATING_EVENT_TYPES.map((type) => [type, 0])) as Record<OperatingEventType, number>;
}

function utcDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dailySeries(startMs: number, days: number): DailyOperatingCounts[] {
  return Array.from({ length: days }, (_, index) => ({
    date: utcDateKey(startMs + index * DAY_MS),
    counts: emptyEventCounts(),
  }));
}

export function aggregateOperatingTrend(
  events: OperatingEvent[],
  options: { now?: Date; periodDays?: number } = {},
): OperatingTrend {
  const now = options.now || new Date();
  const nowMs = now.getTime();
  const periodDays = options.periodDays ?? 30;
  if (!Number.isFinite(nowMs)) throw new TypeError('now must be a valid date.');
  if (!Number.isSafeInteger(periodDays) || periodDays < 1) throw new TypeError('periodDays must be a positive safe integer.');

  const currentDayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const currentStartMs = currentDayStartMs - (periodDays - 1) * DAY_MS;
  const previousStartMs = currentStartMs - periodDays * DAY_MS;
  const currentDaily = dailySeries(currentStartMs, periodDays);
  const previousDaily = dailySeries(previousStartMs, periodDays);
  const currentByDate = new Map(currentDaily.map((day) => [day.date, day]));
  const previousByDate = new Map(previousDaily.map((day) => [day.date, day]));

  for (const event of events) {
    const timestamp = validDate(event.occurredAt, 'event.occurredAt');
    if (timestamp < previousStartMs || timestamp > nowMs) continue;
    const key = utcDateKey(timestamp);
    if (timestamp >= currentStartMs) {
      const day = currentByDate.get(key);
      if (day) day.counts[event.type] += 1;
    } else {
      const day = previousByDate.get(key);
      if (day) day.counts[event.type] += 1;
    }
  }

  const comparisons = Object.fromEntries(OPERATING_EVENT_TYPES.map((type) => {
    const current = currentDaily.reduce((total, day) => total + day.counts[type], 0);
    const previous = previousDaily.reduce((total, day) => total + day.counts[type], 0);
    return [type, compareCounts(current, previous)];
  })) as Record<OperatingEventType, TrendComparison>;

  return {
    generatedAt: now.toISOString(),
    periodDays,
    currentStart: new Date(currentStartMs).toISOString(),
    previousStart: new Date(previousStartMs).toISOString(),
    currentDaily,
    previousDaily,
    comparisons,
  };
}

export function aggregateOutreachVelocity(
  events: Array<Pick<OperatingEvent, 'occurredAt'>>,
  options: { now?: Date; periodDays?: number } = {},
): TrendComparison {
  const now = options.now || new Date();
  const nowMs = now.getTime();
  const periodDays = options.periodDays ?? 7;
  if (!Number.isFinite(nowMs)) throw new TypeError('now must be a valid date.');
  if (!Number.isSafeInteger(periodDays) || periodDays < 1) throw new TypeError('periodDays must be a positive safe integer.');
  const currentStart = nowMs - periodDays * DAY_MS;
  const previousStart = currentStart - periodDays * DAY_MS;
  let current = 0;
  let previous = 0;
  for (const event of events) {
    const timestamp = validDate(event.occurredAt, 'event.occurredAt');
    if (timestamp >= currentStart && timestamp <= nowMs) current += 1;
    else if (timestamp >= previousStart && timestamp < currentStart) previous += 1;
  }
  return compareCounts(current, previous);
}

export type CompletedBidGroup = 'project' | 'customer' | 'date' | 'bid_status' | 'market' | 'consultant' | 'cabinet_line';

export interface CompletedBidFilters {
  projectIds?: string[];
  customerIds?: string[];
  statuses?: CompletedBidRecord['status'][];
  markets?: string[];
  consultants?: string[];
  cabinetLines?: string[];
  from?: string;
  to?: string;
}

export interface CompletedBidValueGroup {
  key: string;
  label: string;
  recordCount: number;
  bidAmount: MoneyTotal[];
  expectedRevenue: MoneyTotal[];
  realizedRevenue: MoneyTotal[];
}

function normalizedSet(values?: string[]): Set<string> | null {
  return values?.length ? new Set(values) : null;
}

export function aggregateCompletedBidValues(
  records: CompletedBidRecord[],
  options: { groupBy?: CompletedBidGroup; filters?: CompletedBidFilters } = {},
): CompletedBidValueGroup[] {
  const groupBy = options.groupBy || 'project';
  const filters = options.filters || {};
  const projectIds = normalizedSet(filters.projectIds);
  const customerIds = normalizedSet(filters.customerIds);
  const statuses = filters.statuses?.length ? new Set(filters.statuses) : null;
  const markets = normalizedSet(filters.markets);
  const consultants = normalizedSet(filters.consultants);
  const cabinetLines = normalizedSet(filters.cabinetLines);
  const from = filters.from ? validDate(filters.from, 'filters.from') : null;
  const to = filters.to ? validDate(filters.to, 'filters.to') : null;

  const filtered = records.filter((record) => {
    const time = validDate(record.effectiveAt, 'record.effectiveAt');
    assertMoney(record.bidAmount, 'record.bidAmount');
    if (record.expectedRevenue) assertMoney(record.expectedRevenue, 'record.expectedRevenue');
    if (record.realizedRevenue) assertMoney(record.realizedRevenue, 'record.realizedRevenue');
    return (!projectIds || projectIds.has(record.projectId))
      && (!customerIds || (record.customerId != null && customerIds.has(record.customerId)))
      && (!statuses || statuses.has(record.status))
      && (!markets || (record.market != null && markets.has(record.market)))
      && (!consultants || (record.consultant != null && consultants.has(record.consultant)))
      && (!cabinetLines || (record.cabinetLine != null && cabinetLines.has(record.cabinetLine)))
      && (from == null || time >= from)
      && (to == null || time <= to);
  });

  function grouping(record: CompletedBidRecord): [string, string] {
    switch (groupBy) {
      case 'project': return [record.projectId, record.projectName];
      case 'customer': return [record.customerId || 'unassigned', record.customerName || 'Unassigned customer'];
      case 'date': return [record.effectiveAt.slice(0, 10), record.effectiveAt.slice(0, 10)];
      case 'bid_status': return [record.status, record.status];
      case 'market': return [record.market || 'unassigned', record.market || 'Unassigned market'];
      case 'consultant': return [record.consultant || 'unassigned', record.consultant || 'Unassigned consultant'];
      case 'cabinet_line': return [record.cabinetLine || 'unassigned', record.cabinetLine || 'Unassigned cabinet line'];
    }
  }

  const grouped = new Map<string, { label: string; records: CompletedBidRecord[] }>();
  for (const record of filtered) {
    const [key, label] = grouping(record);
    const group = grouped.get(key) || { label, records: [] };
    group.records.push(record);
    grouped.set(key, group);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => ({
      key,
      label: group.label,
      recordCount: group.records.length,
      bidAmount: sumMoney(group.records.map((record) => record.bidAmount)),
      expectedRevenue: sumMoney(group.records.map((record) => record.expectedRevenue)),
      realizedRevenue: sumMoney(group.records.map((record) => record.realizedRevenue)),
    }));
}
