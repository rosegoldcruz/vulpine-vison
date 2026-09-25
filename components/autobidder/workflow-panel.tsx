'use client';

import { AlertTriangle, Check, Pause, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import type { WorkspaceCanonicalSnapshot, WorkspaceJob, WorkspaceProgressEvent, WorkspaceRun, WorkspaceRunDiagnostics } from './workspace-types';

const stages = [
  ['project_created', 'Project created'],
  ['source_files_ingested', 'Source files'],
  ['workbook_ingested', 'Workbook'],
  ['cabinet_pages_classified', 'Classification'],
  ['cabinet_pages_extracted', 'Visual extraction'],
  ['cabinet_takeoff_draft', 'Takeoff draft'],
  ['unit_mix_required', 'Unit mix review'],
  ['unit_mix_verified', 'Unit mix verified'],
  ['sku_mapping_required', 'SKU mapping'],
  ['pricing_mapping_required', 'Pricing compile'],
  ['cabinet_bid_review_required', 'Bid review'],
  ['qa_failed', 'QA failed'],
  ['cabinet_bid_safe_to_send', 'Safe to send'],
  ['exported', 'Exported'],
];

export function WorkflowPanel(props: {
  job: WorkspaceJob | null;
  canonical?: WorkspaceCanonicalSnapshot | null;
  run: WorkspaceRun | null;
  diagnostics: WorkspaceRunDiagnostics | null;
  progress: WorkspaceProgressEvent[];
  onProcess: () => void;
  onControl: (action: 'pause' | 'resume' | 'cancel' | 'retry' | 'remove') => void;
  busy: string | null;
}) {
  const workflowState = props.canonical?.job.state;
  const currentIndex = stages.findIndex(([key]) => key === workflowState);
  const traversed = new Set(props.canonical?.job.stateHistory.filter((event) => event.accepted).map((event) => event.to) || []);
  const latest = props.progress.at(-1);
  const canProcess = workflowState === 'source_files_ingested' || workflowState === 'workbook_ingested';
  return (
    <section className="work-panel workflow-panel" aria-labelledby="workflow-title">
      <header className="panel-header"><div><h2 id="workflow-title">Workflow control</h2><p>Server-governed prerequisites and operator actions</p></div><div className="button-row"><button className="icon-button" type="button" onClick={() => props.onControl(props.run?.status === 'paused' ? 'resume' : 'pause')} disabled={!props.run || !(props.run.status === 'paused' ? props.diagnostics?.controls.canResume : props.diagnostics?.controls.canPause)}><span className="sr-only">{props.run?.status === 'paused' ? 'Resume' : 'Pause'}</span>{props.run?.status === 'paused' ? <Play size={16}/> : <Pause size={16}/>}</button><button className="icon-button" type="button" onClick={() => props.onControl('retry')} disabled={!props.run || !props.diagnostics?.controls.canRetry}><span className="sr-only">Retry from checkpoint</span><RotateCcw size={15}/></button><button className="icon-button danger" type="button" onClick={() => props.onControl('cancel')} disabled={!props.run || !props.diagnostics?.controls.canCancel}><span className="sr-only">Cancel</span><Square size={15}/></button><button className="icon-button danger" type="button" onClick={() => props.onControl('remove')} disabled={!props.run || !props.diagnostics?.controls.canRemove}><span className="sr-only">Remove inactive run</span><Trash2 size={15}/></button></div></header>
      <ol className="workflow-list">
        {stages.map(([key, label], index) => {
          const complete = key === 'project_created' ? currentIndex > 0 : traversed.has(key);
          const current = key === workflowState;
          const blocked = (key === 'unit_mix_required' || key === 'qa_failed') && current;
          const skipped = key === 'qa_failed' && currentIndex > index && !complete;
          return <li className={`${complete ? 'complete ' : ''}${current ? 'current ' : ''}${blocked ? 'blocked' : ''}`} key={key}><span className="step-dot">{complete ? <Check size={14}/> : index + 1}</span><div><strong>{label}</strong><span>{blocked ? 'Human verification required before project quantities' : complete ? 'Completed' : current ? 'Current stage' : skipped ? 'Skipped — clean QA result' : 'Waiting on prerequisites'}</span></div>{blocked ? <AlertTriangle size={18}/> : null}</li>;
        })}
      </ol>
      {!workflowState ? <div className="empty-compact"><AlertTriangle size={16}/><span>Canonical workflow record is unavailable for this legacy job.</span></div> : null}
      <div className="progress-strip">
        <div><span>Execution</span><strong>{props.run?.status || 'not started'}</strong></div>
        <div><span>Measured progress</span><strong>{latest ? `${latest.completed}${latest.total !== undefined ? ` / ${latest.total}` : ''} ${latest.unit}` : 'No samples yet'}</strong></div>
        <div><span>ETA</span><strong>{props.diagnostics?.eta ? `${Math.ceil(props.diagnostics.eta.lowerSeconds / 60)}–${Math.ceil(props.diagnostics.eta.upperSeconds / 60)} min` : props.run?.status === 'completed' ? 'Complete' : 'Waiting for samples'}</strong></div>
        <button className="button primary" type="button" onClick={props.onProcess} disabled={!props.job || props.busy !== null || !canProcess}>{props.busy === 'process' ? 'Processing…' : props.run?.status === 'completed' ? 'Server stage complete' : 'Run next stage'}</button>
      </div>
      {props.diagnostics?.failureCause ? <div className="alert error" role="alert"><strong>Concrete failure cause:</strong> {props.diagnostics.failureCause}</div> : null}
    </section>
  );
}
