'use client';

import { CheckCircle2, GitMerge, PlayCircle, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { WorkspaceCanonicalSnapshot } from './workspace-types';

async function expectOk(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message || `Request failed (${response.status}).`);
  return payload.data;
}

const categories = ['base', 'sink_base', 'drawer_base', 'wall', 'refrigerator_wall', 'microwave_wall', 'tall_pantry', 'vanity', 'ada', 'filler', 'finished_panel', 'toe_kick', 'molding', 'accessory'];

export function CanonicalActionsPanel(props: {
  jobId?: string;
  canonical?: WorkspaceCanonicalSnapshot | null;
  onChanged: () => Promise<void> | void;
}) {
  const state = props.canonical?.job.state;
  const evidence = props.canonical?.visionEvidence || [];
  const unitTypes = props.canonical?.unitTypes || [];
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [evidenceId, setEvidenceId] = useState('');
  const [unitTypeId, setUnitTypeId] = useState('');
  const [unitCode, setUnitCode] = useState('A1');
  const [unitName, setUnitName] = useState('Unit A1');
  const [room, setRoom] = useState('Kitchen');
  const [category, setCategory] = useState('wall');
  const [cabinetCode, setCabinetCode] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitCount, setUnitCount] = useState('1');
  const [approvalNote, setApprovalNote] = useState('Reviewed against the linked plan evidence.');
  const [resolutionSku, setResolutionSku] = useState('');
  const [resolutionType, setResolutionType] = useState('normalization');
  const [verifiedCounts, setVerifiedCounts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!evidenceId && evidence[0]) setEvidenceId(evidence[0].id);
    if (!unitTypeId && unitTypes[0]) setUnitTypeId(unitTypes[0].id);
    if (!resolutionSku && props.canonical?.catalogSkus[0]) setResolutionSku(props.canonical.catalogSkus[0].id);
  }, [evidence, evidenceId, props.canonical?.catalogSkus, resolutionSku, unitTypeId, unitTypes]);

  useEffect(() => {
    const allowed = state === 'cabinet_pages_classified'
      ? ['unit_mix', 'classification', 'note']
      : state === 'cabinet_pages_extracted'
        ? ['cabinet', 'dimension', 'note']
        : state === 'cabinet_takeoff_draft'
          ? ['unit_mix']
          : [];
    if (!allowed.length) return;
    const candidates = evidence.filter((item) => allowed.includes(item.kind));
    if (!candidates.some((item) => item.id === evidenceId)) setEvidenceId(candidates[0]?.id || '');
  }, [evidence, evidenceId, state]);

  useEffect(() => {
    setVerifiedCounts((current) => {
      const next = { ...current };
      for (const entry of props.canonical?.unitMixEntries || []) if (!(entry.id in next)) next[entry.id] = String(entry.extractedCount);
      return next;
    });
  }, [props.canonical?.unitMixEntries]);

  const unresolved = useMemo(() => (props.canonical?.mappings || []).filter((item) => item.outcome === 'unresolved'), [props.canonical?.mappings]);
  const allTakeoffApproved = Boolean(props.canonical?.takeoffLines.length) && props.canonical!.takeoffLines.every((line) => line.status === 'approved');
  const mixPayload = () => (props.canonical?.unitMixEntries || []).map((entry) => {
    const unit = unitTypes.find((item) => item.id === entry.unitTypeId)!;
    return { unitTypeId: unit.id, code: unit.code, name: unit.name, accessibility: unit.accessibility,
      extractedCount: entry.extractedCount, evidenceIds: entry.evidenceIds, discrepancy: entry.discrepancy };
  });

  async function act(path: string, method: 'POST' | 'PUT', body?: unknown, success = 'Canonical record updated.') {
    if (!props.jobId) return;
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      await expectOk(await fetch(`/api/jobs/${props.jobId}${path}`, {
        method, headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }));
      await props.onChanged(); setMessage(success);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Canonical action failed.'); }
    finally { setBusy(false); }
  }

  if (!props.jobId || !props.canonical) return null;

  const evidenceSelect = (kinds: string[]) => <label><span>Source evidence</span><select value={evidenceId} onChange={(event) => setEvidenceId(event.target.value)}><option value="">Choose evidence</option>{evidence.filter((item) => kinds.includes(item.kind)).map((item) => <option value={item.id} key={item.id}>{item.kind.replace('_', ' ')} · {item.id.slice(0, 8)}</option>)}</select></label>;
  let controls: ReactNode;

  if (state === 'cabinet_pages_classified') {
    controls = <><div className="action-form-grid"><label><span>Unit type code</span><input value={unitCode} onChange={(event) => setUnitCode(event.target.value)}/></label><label><span>Unit type name</span><input value={unitName} onChange={(event) => setUnitName(event.target.value)}/></label>{evidenceSelect(['unit_mix', 'classification', 'note'])}</div><button className="button primary" disabled={busy || !evidenceId} onClick={() => act('/extraction', 'POST', { unitTypes: [{ code: unitCode, name: unitName, accessibility: 'unknown', evidenceIds: [evidenceId] }] }, 'Reviewed extraction recorded. Add the evidence-backed takeoff.')}>Record reviewed extraction</button><p className="microcopy">Select a unit-mix, classification, or note region in Blueprint studio first. No unit type is created without persisted evidence.</p></>;
  } else if (state === 'cabinet_pages_extracted') {
    controls = <><div className="action-form-grid"><label><span>Unit type</span><select value={unitTypeId} onChange={(event) => setUnitTypeId(event.target.value)}>{unitTypes.map((item) => <option value={item.id} key={item.id}>{item.code} — {item.name}</option>)}</select></label><label><span>Room</span><input value={room} onChange={(event) => setRoom(event.target.value)}/></label><label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option value={item} key={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><label><span>Printed cabinet code</span><input value={cabinetCode} onChange={(event) => setCabinetCode(event.target.value)} placeholder="e.g. W30"/></label><label><span>Quantity per unit</span><input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)}/></label>{evidenceSelect(['cabinet', 'dimension', 'note'])}</div><button className="button primary" disabled={busy || !unitTypeId || !evidenceId || !cabinetCode} onClick={() => act('/takeoff', 'PUT', { cabinets: [{ unitTypeId, room, category, interpretedCode: cabinetCode, quantityPerUnit: Number(quantity), evidenceIds: [evidenceId] }] }, 'Takeoff draft recorded. Explicit line approval is now required.')}>Create takeoff draft</button></>;
  } else if (state === 'cabinet_takeoff_draft') {
    controls = !allTakeoffApproved
      ? <><p>{props.canonical.takeoffLines.length} takeoff line(s) require explicit approval.</p><button className="button primary" disabled={busy || !props.canonical.takeoffLines.length} onClick={() => act('/takeoff/approve', 'POST', { takeoffLineIds: props.canonical!.takeoffLines.map((line) => line.id), note: approvalNote }, 'Every takeoff line was explicitly approved.')}>Approve all reviewed takeoff lines</button></>
      : <><div className="action-form-grid"><label><span>Unit type</span><select value={unitTypeId} onChange={(event) => setUnitTypeId(event.target.value)}>{unitTypes.map((item) => <option value={item.id} key={item.id}>{item.code} — {item.name}</option>)}</select></label><label><span>Extracted project count</span><input type="number" min="0" step="1" value={unitCount} onChange={(event) => setUnitCount(event.target.value)}/></label>{evidenceSelect(['unit_mix'])}</div><button className="button primary" disabled={busy || !unitTypeId || !evidenceId} onClick={() => { const unit = unitTypes.find((item) => item.id === unitTypeId)!; return act('/unit-mix', 'PUT', { entries: [{ unitTypeId, code: unit.code, name: unit.name, accessibility: unit.accessibility, extractedCount: Number(unitCount), evidenceIds: [evidenceId] }] }, 'Unit mix draft recorded. A reviewer must verify every count.'); }}>Record unit mix draft</button></>;
  } else if (state === 'unit_mix_required') {
    const duplicateGroups = [...new Set(props.canonical.unitMixEntries.map((entry) => entry.unitTypeId))]
      .filter((id) => props.canonical!.unitMixEntries.filter((entry) => entry.unitTypeId === id).length > 1);
    controls = <><div className="verification-list">{props.canonical.unitMixEntries.map((entry) => <label key={entry.id}><span>{unitTypes.find((item) => item.id === entry.unitTypeId)?.code || entry.unitTypeId} verified count</span><input type="number" min="0" step="1" value={verifiedCounts[entry.id] ?? entry.extractedCount} onChange={(event) => setVerifiedCounts((current) => ({ ...current, [entry.id]: event.target.value }))}/><small>Extracted {entry.extractedCount} · sources {entry.evidenceIds.map((id) => id.slice(0, 8)).join(', ') || 'missing'}{entry.discrepancy ? ` · discrepancy: ${entry.discrepancy}` : ''}</small></label>)}</div><div className="unit-mix-editor"><strong>Add a missing unit type</strong><div className="action-form-grid"><label><span>Unit code</span><input value={unitCode} onChange={(event) => setUnitCode(event.target.value)}/></label><label><span>Name</span><input value={unitName} onChange={(event) => setUnitName(event.target.value)}/></label><label><span>Extracted count</span><input type="number" min="0" step="1" value={unitCount} onChange={(event) => setUnitCount(event.target.value)}/></label>{evidenceSelect(['unit_mix'])}</div><div className="button-row"><button className="button secondary" disabled={busy || !evidenceId || !unitCode.trim() || !unitName.trim()} onClick={() => act('/unit-mix', 'PUT', { entries: [...mixPayload(), { code: unitCode, name: unitName, accessibility: 'unknown', extractedCount: Number(unitCount), evidenceIds: [evidenceId], discrepancy: `Added by reviewer: ${approvalNote}` }] }, 'Missing unit type added; every count still requires verification.')}>Add missing unit type</button><button className="button secondary" disabled={busy || !duplicateGroups.length} onClick={() => { const merged = new Map<string, ReturnType<typeof mixPayload>[number]>(); for (const item of mixPayload()) { const prior = merged.get(item.unitTypeId); merged.set(item.unitTypeId, prior ? { ...prior, extractedCount: prior.extractedCount + item.extractedCount, evidenceIds: [...new Set([...prior.evidenceIds, ...item.evidenceIds])], discrepancy: `Duplicate identifiers merged by reviewer: ${approvalNote}` } : item); } return act('/unit-mix', 'PUT', { entries: [...merged.values()] }, 'Duplicate unit types merged with a review note.'); }}>Merge duplicate types</button></div></div><label className="wide-field"><span>Resolution / approval note (required for changed or disputed counts)</span><input value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)}/></label><button className="button primary" disabled={busy} onClick={() => act('/unit-mix/verify', 'POST', { decisions: props.canonical!.unitMixEntries.map((entry) => ({ entryId: entry.id, verifiedCount: Number(verifiedCounts[entry.id] ?? entry.extractedCount), resolutionNote: Number(verifiedCounts[entry.id] ?? entry.extractedCount) === entry.extractedCount && !entry.discrepancy ? undefined : approvalNote })) }, 'Unit mix verified. SKU mapping is ready.')}>Verify every unit count</button></>;
  } else if (state === 'sku_mapping_required') {
    controls = unresolved.length === 0
      ? <button className="button primary" disabled={busy} onClick={() => act('/mappings', 'POST', undefined, 'Deterministic exact-match mapping completed. Resolve any exceptions explicitly.')}>Run deterministic SKU mapping</button>
      : <><p>{unresolved.length} mapping exception(s) remain. Choose an authoritative catalog row and record a rationale.</p><div className="action-form-grid"><label><span>Resolution</span><select value={resolutionType} onChange={(event) => setResolutionType(event.target.value)}><option value="normalization">Approved normalization</option><option value="substitution">Approved substitution</option></select></label><label><span>Catalog SKU</span><select value={resolutionSku} onChange={(event) => setResolutionSku(event.target.value)}>{props.canonical.catalogSkus.map((item) => <option value={item.id} key={item.id}>{item.sku} · {item.cabinetCode}</option>)}</select></label><label><span>Rationale</span><input value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)}/></label></div><button className="button primary" disabled={busy || !resolutionSku || !approvalNote.trim()} onClick={() => act('/mappings/resolve', 'POST', { takeoffLineId: unresolved[0].takeoffLineId, catalogSkuId: resolutionSku, resolutionType, note: approvalNote }, 'Mapping exception resolved by an attributed approval.')}>Resolve next mapping exception</button></>;
  } else if (state === 'pricing_mapping_required') {
    controls = <button className="button primary" disabled={busy} onClick={() => act('/estimate', 'POST', undefined, 'Estimate compiled with deterministic integer arithmetic and server catalog costs.')}>Compile authoritative estimate</button>;
  } else if (state === 'cabinet_bid_review_required') {
    const qa = props.canonical.qaResults[0];
    controls = !qa
      ? <button className="button primary" disabled={busy} onClick={() => act('/qa', 'POST', undefined, 'Deterministic QA completed. Review its exact result before approval.')}>Run deterministic QA</button>
      : qa.safeToSend
        ? <><label className="wide-field"><span>Final approval note</span><input value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)}/></label><button className="button primary" disabled={busy || !approvalNote.trim()} onClick={() => act('/qa/approve', 'POST', { qaResultId: qa.id, note: approvalNote }, 'Latest clean QA result explicitly approved. Customer exports are unlocked.')}>Approve clean QA result</button></>
        : <button className="button secondary" disabled>QA has hard-stop issues; correct source records before re-running</button>;
  } else if (state === 'qa_failed') {
    controls = <><p className="hard-stop">QA is fail-closed. Customer export remains blocked.</p>{props.canonical.qaResults[0]?.issues.map((issue) => <div className="action-issue" key={issue.id}><span>{issue.code}</span><strong>{issue.message}</strong></div>)}<button className="button secondary" disabled={busy} onClick={() => act('/qa', 'POST', undefined, 'QA re-run completed against current persisted records.')}>Re-run QA after correction</button></>;
  } else if (state === 'cabinet_bid_safe_to_send') {
    controls = <p><ShieldCheck size={16}/> QA and approval gates passed. Use the export panel to generate an immutable customer artifact.</p>;
  } else if (state === 'exported') {
    controls = <p><CheckCircle2 size={16}/> Customer artifact generated and the canonical workflow is complete.</p>;
  } else {
    controls = <p>Complete server ingestion and page classification to unlock evidence-backed review actions.</p>;
  }

  return <section className="work-panel canonical-actions" aria-labelledby="canonical-actions-title"><header className="panel-header"><div><h2 id="canonical-actions-title">Canonical action gate</h2><p>Current state: {state?.replaceAll('_', ' ')}</p></div><span className="action-state"><GitMerge size={14}/>{state}</span></header><div className="canonical-actions-body"><label className="wide-field"><span>Reviewer note</span><input value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)}/></label>{controls}{busy ? <p className="studio-message"><PlayCircle size={14}/> Persisting server-authoritative change…</p> : null}{message ? <p className="studio-message" role="status">{message}</p> : null}{error ? <p className="action-error" role="alert">{error}</p> : null}</div></section>;
}
