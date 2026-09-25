'use client';

import { FileArchive, FileSpreadsheet, FileText, FolderOpen, Upload, X } from 'lucide-react';
import type { DragEvent } from 'react';
import type { WorkspaceFileQueueItem, WorkspaceIngestionManifest, WorkspaceJob } from './workspace-types';

function fileWithPath(file: File, relativePath: string): File {
  return new File([file], relativePath.replace(/^\/+/, ''), { type: file.type, lastModified: file.lastModified });
}

async function filesFromEntry(entry: any): Promise<File[]> {
  if (entry?.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    return [fileWithPath(file, entry.fullPath || file.name)];
  }
  if (!entry?.isDirectory) return [];
  const reader = entry.createReader();
  const children: any[] = [];
  for (;;) {
    const batch = await new Promise<any[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    children.push(...batch);
  }
  return (await Promise.all(children.map(filesFromEntry))).flat();
}

export function IngestionPanel(props: {
  job: WorkspaceJob | null;
  queue: WorkspaceFileQueueItem[];
  manifest: WorkspaceIngestionManifest | null;
  files: File[] | null;
  setFiles: (files: File[] | null) => void;
  onUpload: () => void;
  onQueueChanged: () => Promise<void> | void;
  canUpload: boolean;
  busy: string | null;
}) {
  const accepted = props.job?.manifest.files || [];
  const queueByName = new Map(props.queue.map((item) => [item.fileName, item]));
  const entries = props.manifest?.entries || accepted.map((file, index) => ({ entryId: file.id, ordinal: index + 1, originalPath: file.name, normalizedPath: file.name, baseName: file.name.split('/').at(-1) || file.name, kind: /\.(xlsx|xls|csv)$/i.test(file.name) ? 'workbook' : 'pdf', outcome: 'supported', sizeBytes: file.size, reason: undefined }));

  async function cancel(item: WorkspaceFileQueueItem) {
    if (!props.job) return;
    const response = await fetch(`/api/jobs/${props.job.id}/file-queue?itemId=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    if (response.ok) await props.onQueueChanged();
  }

  async function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const items = [...event.dataTransfer.items];
    const droppedEntries = items.map((item) => (item as any).webkitGetAsEntry?.()).filter(Boolean);
    const files = droppedEntries.length ? (await Promise.all(droppedEntries.map(filesFromEntry))).flat() : [...event.dataTransfer.files];
    props.setFiles(files);
  }

  function choose(list: FileList | null, preservePaths = false) {
    if (!list) return props.setFiles(null);
    props.setFiles([...list].map((file) => preservePaths && file.webkitRelativePath ? fileWithPath(file, file.webkitRelativePath) : file));
  }

  const summary = props.manifest?.summary;
  return (
    <section className="work-panel ingestion-panel" aria-labelledby="ingestion-title">
      <header className="panel-header"><div><h2 id="ingestion-title">Ingestion manifest</h2><p>{summary ? `${summary.supported} accepted · ${summary.duplicate} duplicate · ${summary.rejected + summary.failed} rejected/failed` : `${accepted.length} accepted files`}</p></div></header>
      <div className="manifest-list">
        {entries.length ? entries.map((entry) => {
          const isWorkbook = entry.kind === 'workbook' || /\.(xlsx|xls|csv)$/i.test(entry.normalizedPath);
          const isPlan = entry.kind === 'plan_pdf' || entry.kind === 'pdf';
          const Icon = isWorkbook ? FileSpreadsheet : isPlan ? FileText : FileArchive;
          const queueItem = queueByName.get(entry.normalizedPath) || queueByName.get(entry.baseName);
          const removable = queueItem && ['waiting', 'retrying', 'paused', 'completed'].includes(queueItem.status);
          const status = queueItem?.status || entry.outcome;
          return <div className="manifest-row" key={entry.entryId}><span className="manifest-index">{entry.ordinal}</span><Icon size={16}/><span className="manifest-name" title={entry.originalPath}>{entry.originalPath}{entry.reason || queueItem?.failureReason ? <small>{entry.reason || queueItem?.failureReason}</small> : null}</span><span className="manifest-type">{isWorkbook ? 'Pricing' : isPlan ? 'Plan' : entry.kind}</span><span className={status === 'failed' || status === 'rejected' ? 'status-warn' : status === 'completed' || status === 'supported' ? 'status-good' : 'status-muted'}>{status}{queueItem?.totalUnits !== undefined ? ` ${queueItem.completedUnits}/${queueItem.totalUnits}` : ''}</span>{queueItem ? <button className="queue-remove" type="button" disabled={!removable} onClick={() => cancel(queueItem)}><X size={13}/><span className="sr-only">Remove {entry.originalPath} from queue</span></button> : <span/>}</div>;
        }) : <div className="empty-compact"><FileArchive size={20}/><span>No project files ingested yet.</span></div>}
      </div>
      <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={drop}><Upload size={16}/><span>Drop files or recursive folders here</span></div>
      <div className="upload-bar">
        <label className="file-picker"><Upload size={15}/><span>{props.files?.length ? `${props.files.length} files selected` : 'Choose PDFs, ZIP or workbook'}</span><input type="file" multiple accept=".pdf,.zip,.xlsx,.xls,.csv" onChange={(event) => choose(event.target.files)} /></label>
        <label className="file-picker folder-picker"><FolderOpen size={15}/><span>Choose folder</span><input type="file" multiple {...({ webkitdirectory: '', directory: '' } as any)} onChange={(event) => choose(event.target.files, true)} /></label>
        <button className="button secondary" type="button" onClick={props.onUpload} disabled={!props.canUpload || props.busy !== null}>{props.busy === 'upload' ? 'Uploading…' : 'Add files'}</button>
      </div>
    </section>
  );
}
