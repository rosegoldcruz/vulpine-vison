'use client';

import { ChevronRight, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { IngestionPanel } from './ingestion-panel';
import { QaPanel } from './qa-panel';
import { ReviewTable } from './review-table';
import { WorkflowPanel } from './workflow-panel';
import { WorkspaceNav } from './workspace-nav';
import { BlueprintStudio } from './blueprint-studio';
import { NotificationCenter } from './notification-center';
import { BackofficeDashboard } from './backoffice-dashboard';
import { ProcessingSettingsPanel } from './processing-settings-panel';
import { CanonicalActionsPanel } from './canonical-actions-panel';
import type { WorkspaceCanonicalSnapshot, WorkspaceFileQueueItem, WorkspaceIngestionManifest, WorkspaceJob, WorkspacePlanSheet, WorkspaceProgressEvent, WorkspaceProject, WorkspaceRun, WorkspaceRunDiagnostics } from './workspace-types';

type IntegrationState = { provider: string | null; status: string; message: string };
type Integrations = { email: IntegrationState; companyIntelligence: IntegrationState; maps: IntegrationState; cabinetVision: IntegrationState };
const POINTER_KEY = 'vulpine.workspace.pointer.v1';

async function parseApiResponse(res: Response): Promise<any> {
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch {
    const snippet = text.slice(0, 180).replace(/\s+/g, ' ').trim();
    throw new Error(`HTTP ${res.status}: expected JSON but received ${snippet || 'an empty body'}.`);
  }
  if (!res.ok || !data.ok) throw new Error(data.error?.message || `Request failed with HTTP ${res.status}.`);
  return data.data;
}

function readPointer(): { projectId?: string; jobId?: string } {
  try {
    const parsed = JSON.parse(localStorage.getItem(POINTER_KEY) || '{}');
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch { return {}; }
}

function savePointer(projectId?: string, jobId?: string) {
  localStorage.setItem(POINTER_KEY, JSON.stringify({ version: 1, projectId, jobId }));
}

export function WorkspaceClient() {
  const [projectName, setProjectName] = useState('New cabinet project');
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [project, setProject] = useState<WorkspaceProject | null>(null);
  const [job, setJob] = useState<WorkspaceJob | null>(null);
  const [run, setRun] = useState<WorkspaceRun | null>(null);
  const [diagnostics, setDiagnostics] = useState<WorkspaceRunDiagnostics | null>(null);
  const [progress, setProgress] = useState<WorkspaceProgressEvent[]>([]);
  const [integrations, setIntegrations] = useState<Integrations>();
  const [canonical, setCanonical] = useState<WorkspaceCanonicalSnapshot | null>(null);
  const [planSheets, setPlanSheets] = useState<WorkspacePlanSheet[]>([]);
  const [fileQueue, setFileQueue] = useState<WorkspaceFileQueueItem[]>([]);
  const [ingestionManifest, setIngestionManifest] = useState<WorkspaceIngestionManifest | null>(null);
  const [activeView, setActiveView] = useState('Projects');
  const [focusEvidenceId, setFocusEvidenceId] = useState<string>();
  const [files, setFiles] = useState<File[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canUpload = Boolean(project?.projectId && files?.length);

  const loadSnapshot = useCallback(async (jobId: string) => {
    const data = await parseApiResponse(await fetch(`/api/jobs/${jobId}/workspace`, { cache: 'no-store' }));
    setProject(data.project); setJob(data.job); setRun(data.run); setDiagnostics(data.diagnostics || null); setProgress(data.progressEvents || []); setIntegrations(data.integrations);
    setCanonical(data.canonical || null); setPlanSheets(data.planSheets || []); setFileQueue(data.fileQueue || []);
    setIngestionManifest(data.ingestionManifest || null);
    savePointer(data.project?.projectId, data.job?.id);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await parseApiResponse(await fetch('/api/projects', { cache: 'no-store' }));
        if (!alive) return;
        setProjects(list.projects || []);
        const pointer = readPointer();
        if (pointer.jobId) await loadSnapshot(pointer.jobId);
        else if (pointer.projectId) setProject((list.projects || []).find((item: WorkspaceProject) => item.projectId === pointer.projectId) || null);
      } catch (cause) {
        if (!alive) return;
        localStorage.removeItem(POINTER_KEY);
        setError(cause instanceof Error ? cause.message : 'Failed to restore the workspace.');
      }
    })();
    return () => { alive = false; };
  }, [loadSnapshot]);

  async function createProject() {
    setBusy('create-project'); setError(null); setNotice(null);
    try {
      const data = await parseApiResponse(await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectName }) }));
      setProject(data.project); setJob(null); setRun(null); setDiagnostics(null); setProgress([]); setCanonical(null); setPlanSheets([]); setFileQueue([]); setIngestionManifest(null); setProjects((current) => [data.project, ...current]);
      savePointer(data.project.projectId); setNotice('Project created. Add plans and an authoritative pricing workbook.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Project creation failed.'); }
    finally { setBusy(null); }
  }

  async function uploadFiles() {
    if (!project?.projectId || !files) return;
    setBusy('upload'); setError(null); setNotice(null);
    try {
      const form = new FormData(); files.forEach((file) => form.append('files', file, file.name));
      const data = await parseApiResponse(await fetch('/api/uploads', { method: 'POST', headers: { 'x-project-id': project.projectId }, body: form }));
      setProject(data.project); setJob(data.job); setFiles(null); savePointer(data.project.projectId, data.job.id);
      await loadSnapshot(data.job.id);
      setNotice(`${data.job.manifest.files.length} files are now in the server manifest.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Upload failed.'); }
    finally { setBusy(null); }
  }

  async function processJob() {
    if (!job?.id) return;
    setBusy('process'); setError(null); setNotice(null);
    let eventSource: EventSource | undefined;
    try {
      const runData = await parseApiResponse(await fetch(`/api/jobs/${job.id}/runs`, { method: 'POST' }));
      setRun(runData.run);
      eventSource = new EventSource(`/api/runs/${runData.run.id}/events`);
      eventSource.addEventListener('progress', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data);
          if (data.run) setRun(data.run);
          if (Array.isArray(data.events) && data.events.length) setProgress((current) => {
            const byId = new Map(current.map((item) => [item.id, item]));
            data.events.forEach((item: WorkspaceProgressEvent) => byId.set(item.id, item));
            return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
          });
        } catch { /* A malformed stream frame is ignored; the final snapshot remains authoritative. */ }
      });
      await parseApiResponse(await fetch(`/api/runs/${runData.run.id}/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: 'validating', unit: 'files', completed: job.manifest.files.length, total: job.manifest.files.length, message: 'Server accepted the manifest.' }) }));
      await parseApiResponse(await fetch(`/api/jobs/${job.id}/process`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: job.id }) }));
      await loadSnapshot(job.id); setNotice('Processing checkpoint saved. Review the current required action.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Processing failed.'); }
    finally { eventSource?.close(); setBusy(null); }
  }

  async function controlRun(action: 'pause' | 'resume' | 'cancel' | 'retry' | 'remove') {
    if (!run?.id) return;
    setError(null);
    try {
      if (action === 'remove') {
        await parseApiResponse(await fetch(`/api/runs/${run.id}/control`, { method: 'DELETE' }));
        setRun(null); setDiagnostics(null); setProgress([]); setNotice('Inactive processing run removed from the queue.');
      } else {
        const data = await parseApiResponse(await fetch(`/api/runs/${run.id}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason: 'Operator action from workspace' }) }));
        setRun(data.run); setNotice(`Processing ${action} request recorded.`);
        if (job && (action === 'resume' || action === 'retry')) {
          setBusy(action);
          await parseApiResponse(await fetch(`/api/jobs/${job.id}/process`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: job.id }) }));
          setNotice(`Processing ${action} completed from the durable checkpoint.`);
        }
        if (job) await loadSnapshot(job.id);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : `Failed to ${action} processing.`); }
    finally { setBusy(null); }
  }

  function selectProject(projectId: string) {
    const selected = projects.find((item) => item.projectId === projectId) || null;
    setProject(selected); setJob(null); setRun(null); setDiagnostics(null); setProgress([]); setCanonical(null); setPlanSheets([]); setFileQueue([]); setIngestionManifest(null); savePointer(projectId);
  }

  async function exportBid(format: 'json' | 'csv' | 'xlsx' | 'review_pdf', audience: 'internal_review' | 'customer') {
    if (!job) return;
    setBusy('export'); setError(null); setNotice(null);
    try {
      await parseApiResponse(await fetch(`/api/jobs/${job.id}/export/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: `Explicit ${audience} export approval from the Cabinet Brain workspace.` }),
      }));
      const data = await parseApiResponse(await fetch(`/api/jobs/${job.id}/export`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format, audience }),
      }));
      window.open(data.downloadUrl, '_blank', 'noopener,noreferrer');
      await loadSnapshot(job.id); setNotice(`${format.toUpperCase()} artifact generated and integrity-checked.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Export failed.'); }
    finally { setBusy(null); }
  }

  return (
    <div className="workspace-shell">
      <WorkspaceNav active={activeView} onChange={setActiveView}/>
      <main className="workspace-main">
        <header className="workspace-topbar">
          <div className="project-crumb"><span>Projects</span><ChevronRight size={14}/><strong>{project?.projectName || 'Create a project'}</strong><small>{project?.projectId ? project.projectId.slice(0, 8) : 'No project selected'}</small></div>
          <div className="topbar-actions"><select aria-label="Select project" value={project?.projectId || ''} onChange={(event) => selectProject(event.target.value)}><option value="">Project list</option>{projects.map((item) => <option key={item.projectId} value={item.projectId}>{item.projectName}</option>)}</select><button className="icon-button" type="button" onClick={() => job && loadSnapshot(job.id)} disabled={!job}><RefreshCw size={16}/><span className="sr-only">Refresh workspace</span></button><NotificationCenter/></div>
        </header>
        {activeView === 'Projects' || activeView === 'Review Queue' ? <section className="project-create-bar"><label><span>Project name</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label><button className="button secondary" type="button" onClick={createProject} disabled={busy !== null}>{busy === 'create-project' ? 'Creating…' : 'Create project'}</button><div className="workflow-truth"><span>Canonical workflow</span><strong>{canonical?.job.state?.replaceAll('_', ' ') || 'project not started'}</strong></div></section> : null}
        {error ? <div className="alert error" role="alert">{error}</div> : null}
        {notice ? <div className="alert notice" role="status">{notice}</div> : null}
        {activeView === 'Pipeline' ? <BackofficeDashboard/> : activeView === 'Settings' ? <ProcessingSettingsPanel/> : <><div className="workspace-grid"><div className="workspace-content"><div className="workspace-upper"><IngestionPanel job={job} queue={fileQueue} manifest={ingestionManifest} files={files} setFiles={setFiles} onUpload={uploadFiles} onQueueChanged={() => job && loadSnapshot(job.id)} canUpload={canUpload} busy={busy}/><WorkflowPanel job={job} canonical={canonical} run={run} diagnostics={diagnostics} progress={progress} onProcess={processJob} onControl={controlRun} busy={busy}/></div><CanonicalActionsPanel jobId={job?.id} canonical={canonical} onChanged={() => job && loadSnapshot(job.id)}/><ReviewTable job={job} canonical={canonical} onEvidence={(id) => { setFocusEvidenceId(id); document.getElementById('blueprint-title')?.scrollIntoView({ behavior: 'smooth' }); }}/></div><QaPanel job={job} canonical={canonical} integrations={integrations} projectId={project?.projectId} projectName={project?.projectName} onExport={exportBid} busy={busy}/></div><BlueprintStudio projectId={project?.projectId} sheets={planSheets} canonical={canonical} focusEvidenceId={focusEvidenceId} onChanged={() => job && loadSnapshot(job.id)}/></>}
      </main>
    </div>
  );
}
