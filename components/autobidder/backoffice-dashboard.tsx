'use client';

import { Activity, BarChart3, CircleDollarSign, Send } from 'lucide-react';
import { useEffect, useState } from 'react';

type Money = { currency: string; amountCents: number };
type Analytics = {
  pipeline: { projectCount: number; unitsRepresented: number; totalActiveBidValue: Money[]; bidValueAwaitingQa: Money[]; submittedValue: Money[]; awardedValue: Money[]; lostValue: Money[]; stages: Array<{ stage: string; projectCount: number; unitCount: number; averageAgeDays?: number; maximumAgeDays?: number; bidValue: Money[] }>; bottlenecks: Array<{ stage: string; projectsOverThreshold: number; averageAgeDays: number }> };
  operatingTrend: { periodDays: number; comparisons: Record<string, { currentCount: number; previousCount: number; percentChange?: number; zeroBaseline: boolean }> };
  outreachVelocity: { currentCount: number; previousCount: number; percentChange?: number; zeroBaseline: boolean };
  completedBidValues: Array<{ key: string; label: string; recordCount: number; bidAmount: Money[]; expectedRevenue: Money[]; realizedRevenue: Money[] }>;
};

function money(values: Money[]) {
  if (!values?.length) return '—';
  return values.map((item) => new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency, maximumFractionDigits: 0 }).format(item.amountCents / 100)).join(' + ');
}

export function BackofficeDashboard() {
  const [analytics, setAnalytics] = useState<Analytics>();
  const [error, setError] = useState<string>();
  const [groupBy, setGroupBy] = useState('project');
  const [filters, setFilters] = useState({ projectIds: '', customerIds: '', statuses: '', markets: '', consultants: '', cabinetLines: '', from: '', to: '' });
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ groupBy });
    for (const [key, value] of Object.entries(filters)) if (value.trim()) query.set(key, value.trim());
    fetch(`/api/backoffice/analytics?${query}`, { cache: 'no-store' })
      .then(async (response) => { const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.error?.message || 'Analytics request failed.'); return payload.data; })
      .then((data) => { if (active) { setAnalytics(data); setError(undefined); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Analytics failed.'); });
    return () => { active = false; };
  }, [groupBy, filterKey]);
  if (error) return <div className="alert error">{error}</div>;
  if (!analytics) return <div className="empty-table">Loading live backoffice analytics…</div>;
  const maxProjects = Math.max(1, ...analytics.pipeline.stages.map((stage) => stage.projectCount));
  const outreach = analytics.outreachVelocity;
  return <section className="backoffice-view"><header className="backoffice-heading"><div><span className="eyebrow">Backoffice command center</span><h1>Pipeline, operating rhythm, and approved bid value</h1><p>All figures are derived from persisted deals and events. Bid, expected, and realized revenue remain separate.</p></div><label><span>Group completed bids</span><select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}><option value="project">Project</option><option value="customer">Customer</option><option value="date">Date</option><option value="bid_status">Bid status</option><option value="market">Market</option><option value="consultant">Consultant</option><option value="cabinet_line">Cabinet line</option></select></label></header>
    <div className="analytics-filters">{Object.entries({ projectIds: 'Project IDs', customerIds: 'Customer IDs', statuses: 'Bid statuses', markets: 'Markets', consultants: 'Consultants', cabinetLines: 'Cabinet lines' }).map(([key, label]) => <label key={key}><span>{label}</span><input value={filters[key as keyof typeof filters]} onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))} placeholder="comma-separated"/></label>)}<label><span>From</span><input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}/></label><label><span>To</span><input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}/></label></div>
    <div className="metric-grid"><article><BarChart3/><span>Active pipeline</span><strong>{money(analytics.pipeline.totalActiveBidValue)}</strong><small>{analytics.pipeline.projectCount} projects · {analytics.pipeline.unitsRepresented} units</small></article><article><CircleDollarSign/><span>Awaiting QA</span><strong>{money(analytics.pipeline.bidValueAwaitingQa)}</strong><small>Kept separate from approved bid delivery</small></article><article><Send/><span>Submitted</span><strong>{money(analytics.pipeline.submittedValue)}</strong><small>Persisted bid-sent records</small></article><article><CircleDollarSign/><span>Awarded</span><strong>{money(analytics.pipeline.awardedValue)}</strong><small>Approved bid value, not realized revenue</small></article><article><CircleDollarSign/><span>Lost</span><strong>{money(analytics.pipeline.lostValue)}</strong><small>Persisted closed-lost bid value</small></article><article><Send/><span>Outreach velocity</span><strong>{outreach.currentCount}</strong><small>Prior period {outreach.previousCount} · {outreach.zeroBaseline ? 'zero baseline' : `${Math.round(outreach.percentChange || 0)}%`}</small></article><article><Activity/><span>30-day events</span><strong>{Object.values(analytics.operatingTrend.comparisons).reduce((total, item) => total + item.currentCount, 0)}</strong><small>Rolling {analytics.operatingTrend.periodDays}-day raw count</small></article></div>
    <div className="backoffice-grid"><section className="work-panel"><header className="panel-header"><div><h2>Pipeline liquidity</h2><p>Stage aging and bottlenecks</p></div></header><div className="stage-bars">{analytics.pipeline.stages.map((stage) => <div className="stage-bar" key={stage.stage}><div><strong>{stage.stage.replaceAll('_', ' ')}</strong><span>{stage.projectCount} projects · {stage.unitCount} units · {money(stage.bidValue)}</span></div><div className="bar-track"><i style={{ width: `${stage.projectCount / maxProjects * 100}%` }}/></div><small>{stage.averageAgeDays == null ? 'No active age' : `${stage.averageAgeDays.toFixed(1)} avg days · ${stage.maximumAgeDays?.toFixed(1)} max`}</small></div>)}</div>{analytics.pipeline.bottlenecks.length ? <div className="bottleneck-list">{analytics.pipeline.bottlenecks.map((item) => <p key={item.stage}><strong>{item.stage.replaceAll('_', ' ')}</strong> — {item.projectsOverThreshold} over threshold, {item.averageAgeDays.toFixed(1)} day average</p>)}</div> : <p className="empty-compact">No current aging bottlenecks.</p>}</section>
      <section className="work-panel"><header className="panel-header"><div><h2>Completed bid value</h2><p>Grouped view with distinct revenue measures</p></div></header><div className="table-wrap"><table className="review-table"><thead><tr><th>Group</th><th>Records</th><th>Bid value</th><th>Expected</th><th>Realized</th></tr></thead><tbody>{analytics.completedBidValues.length ? analytics.completedBidValues.map((group) => <tr key={group.key}><td><strong>{group.label}</strong></td><td>{group.recordCount}</td><td>{money(group.bidAmount)}</td><td>{money(group.expectedRevenue)}</td><td>{money(group.realizedRevenue)}</td></tr>) : <tr><td colSpan={5} className="empty-table">No completed bids match this grouping.</td></tr>}</tbody></table></div></section>
      <section className="work-panel trend-panel"><header className="panel-header"><div><h2>Rolling 30-day operating trend</h2><p>Current period compared with the prior equivalent period</p></div></header><div className="trend-grid">{Object.entries(analytics.operatingTrend.comparisons).map(([event, comparison]) => <article key={event}><strong>{event.replaceAll('_', ' ')}</strong><span>{comparison.currentCount} current · {comparison.previousCount} prior</span><small>{comparison.zeroBaseline ? (comparison.currentCount ? 'New activity from zero baseline' : 'No activity in either period') : `${Math.round(comparison.percentChange || 0)}% change`}</small></article>)}</div></section></div>
  </section>;
}
