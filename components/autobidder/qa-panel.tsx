'use client';

import { AlertOctagon, Database, Download, FileSearch, Link2, PlugZap } from 'lucide-react';
import type { WorkspaceCanonicalSnapshot, WorkspaceJob } from './workspace-types';
import { BidOutreachPanel } from './bid-outreach-panel';
import { ProjectCommentsPanel } from './project-comments-panel';

type IntegrationState = { provider: string | null; status: string; message: string };

export function QaPanel(props: {
  job: WorkspaceJob | null;
  canonical?: WorkspaceCanonicalSnapshot | null;
  integrations?: { email: IntegrationState; companyIntelligence: IntegrationState; maps: IntegrationState; cabinetVision: IntegrationState };
  onExport?: (format: 'json' | 'csv' | 'xlsx' | 'review_pdf', audience: 'internal_review' | 'customer') => void;
  busy?: string | null;
  projectId?: string;
  projectName?: string;
}) {
  const latestQa = props.canonical?.qaResults?.[0];
  const safe = latestQa?.safeToSend ?? Boolean(props.job?.qaResult.safeToSend);
  const issues = latestQa?.issues || props.job?.qaResult.criticalIssues || [];
  return (
    <aside className="inspector-stack">
      <section className={safe ? 'qa-card safe' : 'qa-card unsafe'}><div className="qa-title"><AlertOctagon size={20}/><span>QA status</span></div><strong>{safe ? 'SAFE TO SEND' : 'UNSAFE TO SEND'}</strong><p>{safe ? 'All mandatory gates passed.' : 'Resolve every critical issue before customer delivery.'}</p></section>
      <section className="inspector-card"><header><h2>Critical issues</h2><span>{issues.length}</span></header><div className="issue-list">{issues.length ? issues.map((issue) => <div className="issue-row" key={`${issue.code}-${issue.message}`}><AlertOctagon size={15}/><div><strong>{issue.code.replaceAll('_', ' ')}</strong><span>{issue.message}</span></div></div>) : <div className="empty-compact"><FileSearch size={18}/><span>{latestQa ? 'No critical issues in the latest QA run.' : 'No QA run is available.'}</span></div>}</div></section>
      <section className="inspector-card"><header><h2>Provenance</h2><Link2 size={15}/></header><div className="provenance-chain"><div><Database size={15}/><span>{props.canonical?.estimateLines.length || 0} estimate lines</span></div><i/><div><Database size={15}/><span>{props.canonical?.mappings.length || 0} SKU mappings</span></div><i/><div><FileSearch size={15}/><span>{props.canonical?.takeoffLines.reduce((count, line) => count + line.evidenceIds.length, 0) || 0} evidence links</span></div><p>{props.canonical?.estimateLines.length ? 'Every compiled line retains its mapping and source evidence identifiers.' : 'No compiled estimate line is available.'}</p></div></section>
      <section className="inspector-card"><header><h2>Exports</h2><Download size={15}/></header><div className="export-grid"><button className="button secondary" type="button" disabled={!props.canonical || props.busy !== null} onClick={() => props.onExport?.('review_pdf', 'internal_review')}>Approve + review PDF</button><button className="button secondary" type="button" disabled={!props.canonical || props.busy !== null} onClick={() => props.onExport?.('xlsx', 'internal_review')}>Approve + XLSX</button><button className="button secondary" type="button" disabled={!safe || props.busy !== null} onClick={() => props.onExport?.('json', 'customer')}>Approve + customer JSON</button></div><p className="microcopy">Each action records an actor-attributed export approval before server-side generation.</p></section>
      <section className="inspector-card"><header><h2>Integrations</h2><PlugZap size={15}/></header><div className="integration-list">{props.integrations ? Object.entries(props.integrations).map(([name, value]) => <div key={name}><span>{name.replace(/([A-Z])/g, ' $1')}</span><strong className={value.status === 'connected' ? 'status-good' : 'status-muted'}>{value.status.replaceAll('_', ' ')}</strong></div>) : <p>Provider state unavailable.</p>}</div></section>
      {props.projectId ? <ProjectCommentsPanel projectId={props.projectId}/> : null}
      {safe && props.projectId && props.job?.id ? <BidOutreachPanel projectId={props.projectId} jobId={props.job.id} projectName={props.projectName || 'Cabinet project'}/> : null}
    </aside>
  );
}
