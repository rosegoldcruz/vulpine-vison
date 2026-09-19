'use client';

import { useMemo, useState } from 'react';

type ProjectManifest = {
  projectId: string;
  projectName: string;
  pageCount: number;
  processingStatus: string;
};

type ApiJob = {
  id: string;
  state: string;
  qaResult: {
    safeToSend: boolean;
    criticalIssues: Array<{ code: string; message: string }>;
    warnings: string[];
    assumptions: string[];
  };
  manifest: {
    pageCount: number;
    files: Array<{ name: string }>;
    pdfFiles: Array<{ name: string }>;
    workbookFiles: Array<{ name: string }>;
  };
};

export function WorkspaceClient() {
  const [projectName, setProjectName] = useState('Autobidder Project');
  const [project, setProject] = useState<ProjectManifest | null>(null);
  const [job, setJob] = useState<ApiJob | null>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canUpload = useMemo(() => !!project?.projectId && !!files?.length, [project, files]);

  async function createProject() {
    setBusy('create-project');
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error?.message || 'Failed to create project.');
      }
      setProject(data.data.project);
      setJob(null);
    } catch (err: any) {
      setError(err.message || 'Unknown error while creating project.');
    } finally {
      setBusy(null);
    }
  }

  async function uploadFiles() {
    if (!project?.projectId || !files) return;
    setBusy('upload');
    setError(null);
    try {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append('files', f));
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'x-project-id': project.projectId },
        body: form,
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error?.message || 'Upload failed.');
      }
      setProject(data.data.project);
      setJob(data.data.job);
    } catch (err: any) {
      setError(err.message || 'Unknown error while uploading files.');
    } finally {
      setBusy(null);
    }
  }

  async function processJob() {
    if (!job?.id) return;
    setBusy('process');
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error?.message || 'Processing failed.');
      }
      setJob(data.data.job);
      setProject(data.data.project);
    } catch (err: any) {
      setError(err.message || 'Unknown error while processing.');
    } finally {
      setBusy(null);
    }
  }

  async function refreshJob() {
    if (!job?.id) return;
    const res = await fetch(`/api/jobs/${job.id}`);
    const data = await res.json();
    if (data.ok) {
      setJob(data.data.job);
      setProject(data.data.project);
    }
  }

  return (
    <section className="grid gap-6 md:grid-cols-2">
      <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-cyan-400">Ingestion Hub</h2>
        <label className="block text-sm text-slate-300">
          Project Name
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
        </label>
        <button
          onClick={createProject}
          disabled={busy !== null}
          className="rounded bg-cyan-700 px-3 py-2 text-sm font-medium hover:bg-cyan-600 disabled:opacity-60"
        >
          {busy === 'create-project' ? 'Creating...' : 'Create Project'}
        </button>

        <label className="block text-sm text-slate-300">
          Upload Files (PDF, ZIP, XLSX, XLS, CSV)
          <input
            className="mt-1 block w-full text-sm"
            type="file"
            multiple
            accept=".pdf,.zip,.xlsx,.xls,.csv"
            onChange={(e) => setFiles(e.target.files)}
          />
        </label>

        <button
          onClick={uploadFiles}
          disabled={!canUpload || busy !== null}
          className="rounded bg-slate-700 px-3 py-2 text-sm font-medium hover:bg-slate-600 disabled:opacity-60"
        >
          {busy === 'upload' ? 'Uploading...' : 'Upload To Project'}
        </button>

        <button
          onClick={processJob}
          disabled={!job?.id || busy !== null}
          className="rounded bg-emerald-700 px-3 py-2 text-sm font-medium hover:bg-emerald-600 disabled:opacity-60"
        >
          {busy === 'process' ? 'Processing...' : 'Process Workflow'}
        </button>

        <button onClick={refreshJob} disabled={!job?.id} className="rounded bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700">
          Refresh Job State
        </button>

        {error ? <p className="rounded border border-red-900 bg-red-950/40 p-2 text-xs text-red-300">{error}</p> : null}
      </div>

      <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-cyan-400">Workflow Control Center</h2>

        <div className="rounded border border-slate-800 bg-slate-950 p-3 text-sm">
          <p>
            <span className="text-slate-400">Project:</span> {project?.projectName || '-'}
          </p>
          <p>
            <span className="text-slate-400">Project ID:</span> {project?.projectId || '-'}
          </p>
          <p>
            <span className="text-slate-400">Status:</span> {project?.processingStatus || '-'}
          </p>
          <p>
            <span className="text-slate-400">Pages:</span> {project?.pageCount ?? 0}
          </p>
        </div>

        <div className="rounded border border-slate-800 bg-slate-950 p-3 text-sm">
          <p>
            <span className="text-slate-400">Job ID:</span> {job?.id || '-'}
          </p>
          <p>
            <span className="text-slate-400">Workflow State:</span> {job?.state || '-'}
          </p>
          <p>
            <span className="text-slate-400">PDF files:</span> {job?.manifest?.pdfFiles?.length ?? 0}
          </p>
          <p>
            <span className="text-slate-400">Workbook files:</span> {job?.manifest?.workbookFiles?.length ?? 0}
          </p>
          <p>
            <span className="text-slate-400">Safe to send:</span> {job?.qaResult?.safeToSend ? 'yes' : 'no'}
          </p>
        </div>

        <div className="rounded border border-slate-800 bg-slate-950 p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Critical Issues</h3>
          <ul className="space-y-1 text-xs text-amber-300">
            {(job?.qaResult?.criticalIssues || []).map((issue) => (
              <li key={`${issue.code}-${issue.message}`}>{issue.code}: {issue.message}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
