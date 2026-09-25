'use client';

import { Crosshair, Expand, Highlighter, Maximize2, Minus, MousePointer2, Pencil, Plus, Redo2, RotateCw, Ruler, ScanSearch, Type, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { WorkspaceCanonicalSnapshot, WorkspacePlanSheet } from './workspace-types';

type Point = { x: number; y: number };

async function expectOk(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message || `Request failed (${response.status}).`);
  return payload.data;
}

export function BlueprintStudio(props: {
  projectId?: string;
  sheets: WorkspacePlanSheet[];
  canonical?: WorkspaceCanonicalSnapshot | null;
  onChanged?: () => void;
  focusEvidenceId?: string;
}) {
  const [sheetId, setSheetId] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [points, setPoints] = useState<Point[]>([]);
  const [redoPoints, setRedoPoints] = useState<Point[]>([]);
  const [knownDistance, setKnownDistance] = useState('24');
  const [unit, setUnit] = useState('in');
  const [measurementKind, setMeasurementKind] = useState<'distance' | 'polyline' | 'area'>('distance');
  const [markupTool, setMarkupTool] = useState<'region' | 'pen' | 'highlighter' | 'arrow' | 'text' | 'count'>('region');
  const [annotationText, setAnnotationText] = useState('Estimator review note');
  const [classificationNote, setClassificationNote] = useState('Human-reviewed rendered sheet.');
  const [fullscreen, setFullscreen] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const [evidenceKind, setEvidenceKind] = useState<'cabinet' | 'unit_mix' | 'classification' | 'dimension' | 'note'>('cabinet');
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const activeId = sheetId || props.sheets[0]?.id;
  const active = props.sheets.find((sheet) => sheet.id === activeId);

  useEffect(() => {
    if (sheetId && !props.sheets.some((sheet) => sheet.id === sheetId)) setSheetId(undefined);
  }, [props.sheets, sheetId]);

  useEffect(() => {
    if (!props.focusEvidenceId) return;
    const target = props.canonical?.visionEvidence.find((item) => item.id === props.focusEvidenceId);
    if (target) setSheetId(target.planSheetId);
  }, [props.canonical?.visionEvidence, props.focusEvidenceId]);

  function choosePoint(event: React.MouseEvent<HTMLImageElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const point = { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) };
    setRedoPoints([]);
    setPoints((current) => {
      const maximum = markupTool === 'region' || markupTool === 'arrow' || markupTool === 'text' || measurementKind === 'distance' ? 2 : 100;
      return current.length >= maximum ? [point] : [...current, point];
    });
  }

  async function saveMeasurement() {
    const minimum = measurementKind === 'area' ? 3 : 2;
    if (!props.projectId || !active || points.length < minimum) return;
    setBusy(true); setMessage(undefined);
    try {
      await expectOk(await fetch(`/api/projects/${props.projectId}/measurements`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planSheetId: active.id, kind: measurementKind, geometry: { points }, calibration: { points: [points[0], points[1]], knownDistance: Number(knownDistance), unit } }),
      }));
      setMessage('Supporting measurement saved. Printed dimensions remain authoritative.'); setPoints([]); props.onChanged?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Measurement failed.'); }
    finally { setBusy(false); }
  }

  function selectedRegion() {
    if (points.length < 2) return undefined;
    const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
    const x = Math.min(...xs); const y = Math.min(...ys);
    return { x, y, width: Math.max(0.005, Math.max(...xs) - x), height: Math.max(0.005, Math.max(...ys) - y) };
  }

  async function saveMarkup() {
    const region = selectedRegion();
    if (!props.projectId || !active || !region) return;
    const takeoffLineId = props.canonical?.takeoffLines[0]?.id;
    const qaIssueId = props.canonical?.qaResults[0]?.issues[0]?.id;
    if (!takeoffLineId && !qaIssueId) { setMessage('Markup must link to a takeoff line or QA issue.'); return; }
    setBusy(true); setMessage(undefined);
    try {
      await expectOk(await fetch(`/api/projects/${props.projectId}/evidence-snippets`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          planSheetId: active.id, region, scale: zoom,
          annotations: [{ type: markupTool, text: markupTool === 'text' || markupTool === 'count' ? annotationText : undefined, points }],
          title: `${markupTool.replace('_', ' ')} markup — ${active.sheetNumber || `page ${active.pageNumber}`}`,
          ...(takeoffLineId ? { takeoffLineId } : { qaIssueId }),
        }),
      }));
      setMessage(`${markupTool.replace('_', ' ')} markup persisted and linked.`); setPoints([]); props.onChanged?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Markup save failed.'); }
    finally { setBusy(false); }
  }

  async function reviewClassification(classification: string) {
    if (!active) return;
    setBusy(true); setMessage(undefined);
    try {
      await expectOk(await fetch(`/api/plan-sheets/${active.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ classification, note: classificationNote }) }));
      setMessage(`Classification reviewed as ${classification.replaceAll('_', ' ').toLowerCase()}.`); await props.onChanged?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Classification review failed.'); }
    finally { setBusy(false); }
  }

  const activeEvidence = (props.canonical?.visionEvidence || []).filter((item) => item.planSheetId === active?.id && item.region);
  const measurementReady = points.length >= (measurementKind === 'area' ? 3 : 2);

  async function saveEvidence(kind: 'vision' | 'snippet') {
    const region = selectedRegion();
    if (!props.projectId || !active || !region) return;
    setBusy(true); setMessage(undefined);
    try {
      const takeoffLineId = props.canonical?.takeoffLines[0]?.id;
      if (kind === 'snippet' && !takeoffLineId) throw new Error('Create a takeoff line before attaching a review snippet.');
      const url = kind === 'vision' ? `/api/projects/${props.projectId}/vision-evidence` : `/api/projects/${props.projectId}/evidence-snippets`;
      const body = kind === 'vision'
        ? { planSheetId: active.id, kind: evidenceKind, region, text: `Human-reviewed ${evidenceKind.replace('_', ' ')} evidence region`, confidence: 1 }
        : { planSheetId: active.id, region, scale: zoom, annotations: [{ type: 'region', text: 'Review evidence' }], title: `Evidence — ${active.sheetNumber || `page ${active.pageNumber}`}`, takeoffLineId };
      await expectOk(await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
      setMessage(kind === 'vision' ? `${evidenceKind.replace('_', ' ')} source evidence saved.` : 'Linked evidence snippet saved.'); setPoints([]); props.onChanged?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Evidence save failed.'); }
    finally { setBusy(false); }
  }

  return (
    <section className={`work-panel blueprint-studio${fullscreen ? ' fullscreen' : ''}`} aria-labelledby="blueprint-title">
      <header className="panel-header"><div><h2 id="blueprint-title">Blueprint studio</h2><p>Rendered source pages, calibrated support measurements, and review evidence</p></div><div className="button-row"><button className="icon-button" type="button" onClick={() => { setActualSize(false); setZoom((value) => Math.max(.5, value - .25)); }}><Minus size={15}/><span className="sr-only">Zoom out</span></button><button className="icon-button" type="button" onClick={() => { setActualSize(false); setZoom((value) => Math.min(4, value + .25)); }}><Plus size={15}/><span className="sr-only">Zoom in</span></button><button className="icon-button" type="button" onClick={() => setRotation((value) => (value + 90) % 360)}><RotateCw size={15}/><span className="sr-only">Rotate</span></button><button className="button secondary" type="button" onClick={() => { setZoom(1); setRotation(0); setActualSize(false); }}>Fit</button><button className="button secondary" type="button" onClick={() => { setZoom(1); setActualSize(true); }}><Maximize2 size={14}/> Actual pixels</button><button className="icon-button" type="button" onClick={() => setFullscreen((value) => !value)}><Expand size={15}/><span className="sr-only">{fullscreen ? 'Exit full screen viewer' : 'Open full screen viewer'}</span></button></div></header>
      {!active ? <div className="empty-table">Rendered pages appear here after processing.</div> : <div className="blueprint-layout">
        <div className="sheet-rail">{props.sheets.map((sheet) => <button type="button" className={sheet.id === active.id ? 'sheet-thumb active' : 'sheet-thumb'} key={sheet.id} onClick={() => { setSheetId(sheet.id); setPoints([]); }}><span>{sheet.sheetNumber || `P${sheet.pageNumber}`}</span><strong>{sheet.classification || 'unclassified'}</strong><small>{sheet.sourceFileName}</small></button>)}</div>
        <div className="blueprint-canvas" aria-label="Scrollable, pannable blueprint canvas"><div className={`blueprint-transform${actualSize ? ' actual-size' : ''}`} style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}><img src={`/api/plan-sheets/${active.id}/image`} alt={`${active.sourceFileName}, page ${active.pageNumber}`} onClick={choosePoint}/>{activeEvidence.map((item) => <button type="button" title={`${item.kind} evidence ${item.id}`} aria-label={`Evidence overlay ${item.kind}`} className={item.id === props.focusEvidenceId ? 'evidence-overlay focused' : 'evidence-overlay'} key={item.id} style={{ left: `${item.region!.x * 100}%`, top: `${item.region!.y * 100}%`, width: `${item.region!.width * 100}%`, height: `${item.region!.height * 100}%` }} onClick={(event) => { event.stopPropagation(); setMessage(`${item.kind.replace('_', ' ')} evidence ${item.id}`); }}/>) }{points.map((point, index) => <span className="measure-point" key={`${point.x}-${point.y}-${index}`} style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}>{index + 1}</span>)}</div></div>
        <aside className="blueprint-tools"><div className="sheet-meta"><span>{active.sheetNumber || `Page ${active.pageNumber}`}</span><strong>{active.title || active.classification || 'Plan sheet'}</strong><small>{active.reviewRequired ? 'Visual review required' : 'Classification recorded'} · {activeEvidence.length} overlay(s)</small></div><label><span>Reviewed classification</span><select aria-label="Reviewed classification" defaultValue={active.classification || 'UNKNOWN'} key={`${active.id}-${active.classification}`} onChange={(event) => reviewClassification(event.target.value)}>{['COVER','INDEX','GENERAL','UNIT_PLAN','FLOOR_PLAN','KITCHEN_ELEVATION','BATH_ELEVATION','INTERIOR_ELEVATION','CASEWORK_SCHEDULE','FINISH_SCHEDULE','UNIT_MATRIX','ACCESSIBILITY','DETAIL','APPLIANCE_SCHEDULE','IRRELEVANT','UNKNOWN'].map((item) => <option value={item} key={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><label><span>Classification review note</span><input value={classificationNote} onChange={(event) => setClassificationNote(event.target.value)}/></label><label><span>Drawing tool</span><select value={markupTool} onChange={(event) => { setMarkupTool(event.target.value as typeof markupTool); setPoints([]); }}><option value="region">Evidence region</option><option value="pen">Pen</option><option value="highlighter">Highlighter</option><option value="arrow">Arrow</option><option value="text">Text note</option><option value="count">Count / tally</option></select></label><label><span>Measurement</span><select value={measurementKind} onChange={(event) => { setMeasurementKind(event.target.value as typeof measurementKind); setPoints([]); }}><option value="distance">Linear</option><option value="polyline">Polyline</option><option value="area">Area</option></select></label><label><span>Known calibration</span><input type="number" min="0.01" step="0.01" value={knownDistance} onChange={(event) => setKnownDistance(event.target.value)}/></label><label><span>Unit</span><select value={unit} onChange={(event) => setUnit(event.target.value)}><option value="in">in</option><option value="ft">ft</option><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option></select></label><label><span>Scale preset</span><select onChange={(event) => { const [distance, nextUnit] = event.target.value.split(':'); setKnownDistance(distance); setUnit(nextUnit); }} defaultValue=""><option value="" disabled>Choose scale</option><option value="12:in">1/8″ = 1′</option><option value="12:in">1/4″ = 1′</option><option value="1:m">Metric calibration</option></select></label><label><span>Evidence kind</span><select aria-label="Evidence kind" value={evidenceKind} onChange={(event) => setEvidenceKind(event.target.value as typeof evidenceKind)}><option value="cabinet">Cabinet</option><option value="unit_mix">Unit mix</option><option value="classification">Classification</option><option value="dimension">Dimension</option><option value="note">Plan note</option></select></label><label><span>Annotation / tally label</span><input value={annotationText} onChange={(event) => setAnnotationText(event.target.value)}/></label><div className="tool-history"><button className="icon-button" type="button" disabled={!points.length} onClick={() => setPoints((current) => { const last = current.at(-1); if (last) setRedoPoints((redo) => [...redo, last]); return current.slice(0, -1); })}><Undo2 size={14}/><span className="sr-only">Undo point</span></button><button className="icon-button" type="button" disabled={!redoPoints.length} onClick={() => setRedoPoints((current) => { const next = current.at(-1); if (next) setPoints((items) => [...items, next]); return current.slice(0, -1); })}><Redo2 size={14}/><span className="sr-only">Redo point</span></button><span>{points.length} point(s)</span></div><p className="microcopy">Click points on the page. Measurements support review and never replace printed dimensions.</p><button className="button secondary" type="button" disabled={busy || !measurementReady} onClick={saveMeasurement}><Ruler size={15}/> Save {measurementKind} measurement</button><button className="button secondary" type="button" disabled={busy || points.length < 2} onClick={() => saveEvidence('vision')}><Crosshair size={15}/> Save source evidence</button><button className="button secondary" type="button" disabled={busy || points.length < 2} onClick={() => saveEvidence('snippet')}><ScanSearch size={15}/> Link review snippet</button><button className="button secondary" type="button" disabled={busy || points.length < 2 || markupTool === 'region'} onClick={saveMarkup}>{markupTool === 'text' ? <Type size={15}/> : markupTool === 'highlighter' ? <Highlighter size={15}/> : markupTool === 'pen' ? <Pencil size={15}/> : <MousePointer2 size={15}/>} Save {markupTool} markup</button>{props.focusEvidenceId ? <p className="focus-evidence">Requested evidence: {props.focusEvidenceId}</p> : null}{message ? <p className="studio-message" role="status">{message}</p> : null}</aside>
      </div>}
    </section>
  );
}
