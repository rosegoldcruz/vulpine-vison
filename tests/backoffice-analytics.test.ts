import { describe, expect, it } from 'vitest';
import {
  aggregateCompletedBidValues,
  aggregateOperatingTrend,
  aggregateOutreachVelocity,
  aggregatePipelineLiquidity,
  compareCounts,
  type CompletedBidRecord,
  type DealRecord,
  type OperatingEvent,
} from '@/lib/backoffice';

describe('backoffice live-data analytics', () => {
  const now = new Date('2026-09-25T12:00:00.000Z');

  it('aggregates pipeline liquidity from deal records without combining currencies', () => {
    const deals: DealRecord[] = [
      {
        id: 'd1', projectId: 'p1', stage: 'review', stageEnteredAt: '2026-09-05T12:00:00.000Z',
        bidAmount: { amountCents: 100_00, currency: 'usd' }, unitCount: 10, qaStatus: 'pending',
      },
      {
        id: 'd2', projectId: 'p2', stage: 'bid_sent', stageEnteredAt: '2026-09-24T12:00:00.000Z',
        bidAmount: { amountCents: 250_00, currency: 'USD' }, unitCount: 20, qaStatus: 'passed',
        submittedAt: '2026-09-24T12:00:00.000Z',
      },
      {
        id: 'd3', projectId: 'p3', stage: 'awarded', stageEnteredAt: '2026-09-20T12:00:00.000Z',
        bidAmount: { amountCents: 300_00, currency: 'EUR' }, unitCount: 5, qaStatus: 'passed',
        submittedAt: '2026-09-18T12:00:00.000Z', awardedAt: '2026-09-20T12:00:00.000Z',
      },
    ];

    const result = aggregatePipelineLiquidity(deals, { now, bottleneckThresholdDays: 14 });
    expect(result.projectCount).toBe(3);
    expect(result.unitsRepresented).toBe(35);
    expect(result.totalActiveBidValue).toEqual([{ currency: 'USD', amountCents: 350_00 }]);
    expect(result.bidValueAwaitingQa).toEqual([{ currency: 'USD', amountCents: 100_00 }]);
    expect(result.submittedValue).toEqual([
      { currency: 'EUR', amountCents: 300_00 },
      { currency: 'USD', amountCents: 250_00 },
    ]);
    expect(result.awardedValue).toEqual([{ currency: 'EUR', amountCents: 300_00 }]);
    expect(result.bottlenecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'review', projectsOverThreshold: 1, maximumAgeDays: 20 }),
    ]));
  });

  it('builds rolling period comparisons from timestamped operating events', () => {
    const events: OperatingEvent[] = [
      { id: 'e1', type: 'lead_received', occurredAt: '2026-09-20T12:00:00.000Z' },
      { id: 'e2', type: 'lead_received', occurredAt: '2026-08-20T12:00:00.000Z' },
      { id: 'e3', type: 'outreach_activity', occurredAt: '2026-09-24T12:00:00.000Z' },
      { id: 'e4', type: 'award_recorded', occurredAt: '2026-07-01T12:00:00.000Z' },
    ];
    const result = aggregateOperatingTrend(events, { now, periodDays: 30 });
    expect(result.currentDaily).toHaveLength(30);
    expect(result.previousDaily).toHaveLength(30);
    expect(result.comparisons.lead_received).toMatchObject({ currentCount: 1, previousCount: 1, percentChange: 0 });
    expect(result.comparisons.outreach_activity).toMatchObject({
      currentCount: 1, previousCount: 0, percentChange: null, zeroBaseline: true,
    });
  });

  it('handles zero baselines and preserves raw outreach counts', () => {
    expect(compareCounts(3, 0)).toEqual({
      currentCount: 3,
      previousCount: 0,
      absoluteChange: 3,
      percentChange: null,
      zeroBaseline: true,
    });
    expect(aggregateOutreachVelocity(
      [{ occurredAt: '2026-09-24T12:00:00.000Z' }, { occurredAt: '2026-09-23T12:00:00.000Z' }],
      { now, periodDays: 7 },
    )).toMatchObject({ currentCount: 2, previousCount: 0, percentChange: null, zeroBaseline: true });
  });

  it('keeps bid, expected, and realized value separate while filtering and grouping', () => {
    const bids: CompletedBidRecord[] = [
      {
        id: 'b1', projectId: 'p1', projectName: 'North', customerId: 'c1', customerName: 'Acme',
        status: 'submitted', effectiveAt: '2026-09-20T00:00:00.000Z', market: 'Denver', consultant: 'Lee', cabinetLine: 'A',
        bidAmount: { amountCents: 1_000_00, currency: 'USD' },
        expectedRevenue: { amountCents: 600_00, currency: 'USD' },
      },
      {
        id: 'b2', projectId: 'p2', projectName: 'South', customerId: 'c1', customerName: 'Acme',
        status: 'awarded', effectiveAt: '2026-09-21T00:00:00.000Z', market: 'Denver', consultant: 'Lee', cabinetLine: 'B',
        bidAmount: { amountCents: 2_000_00, currency: 'USD' },
        expectedRevenue: { amountCents: 1_500_00, currency: 'USD' },
        realizedRevenue: { amountCents: 1_200_00, currency: 'USD' },
      },
    ];
    const result = aggregateCompletedBidValues(bids, {
      groupBy: 'customer',
      filters: { markets: ['Denver'] },
    });
    expect(result).toEqual([{
      key: 'c1', label: 'Acme', recordCount: 2,
      bidAmount: [{ currency: 'USD', amountCents: 3_000_00 }],
      expectedRevenue: [{ currency: 'USD', amountCents: 2_100_00 }],
      realizedRevenue: [{ currency: 'USD', amountCents: 1_200_00 }],
    }]);
  });
});
