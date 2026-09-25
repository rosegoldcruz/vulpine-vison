'use client';

import { ExternalLink, Search } from 'lucide-react';
import { useState } from 'react';
import type { WorkspaceCanonicalSnapshot, WorkspaceJob } from './workspace-types';

export function ReviewTable({ job, canonical, onEvidence }: { job: WorkspaceJob | null; canonical?: WorkspaceCanonicalSnapshot | null; onEvidence?: (evidenceId?: string) => void }) {
  const [query, setQuery] = useState('');
  const unitTypeById = new Map((canonical?.unitTypes || []).map((item) => [item.id, item]));
  const cabinetById = new Map((canonical?.cabinetInstances || []).map((item) => [item.id, item]));
  const mappingByTakeoff = new Map((canonical?.mappings || []).map((item) => [item.takeoffLineId, item]));
  const skuById = new Map((canonical?.catalogSkus || []).map((item) => [item.id, item]));
  const rows = (canonical?.takeoffLines || []).filter((line) => {
    const cabinet = cabinetById.get(line.cabinetInstanceId);
    const unit = unitTypeById.get(line.unitTypeId);
    return `${unit?.code} ${cabinet?.room} ${cabinet?.interpretedCode} ${cabinet?.category}`.toLowerCase().includes(query.toLowerCase());
  });
  const latestQa = canonical?.qaResults?.[0];
  const safeToSend = latestQa?.safeToSend ?? job?.qaResult.safeToSend ?? false;
  return (
    <section className="work-panel review-panel" aria-labelledby="review-title">
      <header className="panel-header review-header"><div><h2 id="review-title">Draft viewer</h2><p>Review & Resolve</p></div><label className="table-search"><Search size={14}/><span className="sr-only">Search takeoff</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search units, rooms or SKUs" /></label></header>
      {!safeToSend ? <div className="provisional-banner">PROVISIONAL — NOT A CUSTOMER BID</div> : null}
      <div className="table-wrap">
        <table className="review-table">
          <thead><tr><th>Unit type</th><th>Room</th><th>Cabinet</th><th>Dimensions (W × H × D)</th><th>SKU</th><th>Qty/unit</th><th>Status</th><th>Evidence</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((row) => {
              const cabinet = cabinetById.get(row.cabinetInstanceId);
              const unit = unitTypeById.get(row.unitTypeId);
              const mapping = mappingByTakeoff.get(row.id);
              const sku = mapping?.catalogSkuId ? skuById.get(mapping.catalogSkuId) : undefined;
              return <tr key={row.id}><td>{unit?.code || row.unitTypeId}</td><td>{cabinet?.room || '—'}</td><td><strong>{cabinet?.interpretedCode || cabinet?.category || 'Unresolved'}</strong><span>{cabinet?.category}</span></td><td>{[cabinet?.widthInches, cabinet?.heightInches, cabinet?.depthInches].map((value) => value ?? '—').join(' × ')}</td><td>{sku?.sku || 'Unresolved'}</td><td>{row.quantityPerUnit}</td><td><span className={mapping?.outcome === 'unresolved' || row.status !== 'approved' ? 'status-warn' : 'status-good'}>{mapping?.outcome || row.status}</span></td><td><button className="evidence-link" type="button" onClick={() => onEvidence?.(row.evidenceIds[0])} disabled={!row.evidenceIds.length}><ExternalLink size={14}/><span>Source</span></button></td></tr>;
            }) : <tr><td className="empty-table" colSpan={8}>No takeoff lines exist yet. Classification and verified unit-mix evidence must be completed first.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
