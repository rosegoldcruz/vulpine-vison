import 'server-only';
import path from 'path';
import { randomUUID } from 'crypto';
import type { BidJob, ProjectFile, ProjectManifest } from '@/types';
import { ApiServiceError } from '@/lib/autobidder/api/errors';
import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { writeBinary } from '@/lib/autobidder/storage/file-store';
import { getDatabase } from '@/lib/autobidder/db/database';
import { ArchiveSafetyError, discoverZipArchive } from '@/lib/autobidder/ingestion/archive';
import { buildIngestionManifest, type IngestionCandidate, type IngestionManifest } from '@/lib/autobidder/ingestion/manifest';
import { advanceCanonicalSystemState } from '@/lib/autobidder/services/canonical-bid-service';
import type { Principal } from '@/types/canonical';
import { initializeFileQueue } from '@/lib/autobidder/services/file-queue-service';
import { createNotificationOnce } from '@/lib/autobidder/services/notification-service';

const ingestionPrincipal: Principal = {
  id: 'cabinet-ingestion-service', kind: 'service', displayName: 'Cabinet ingestion service',
  role: 'service', organizationId: 'local', scopes: ['project:upload'],
};

function isWorkbook(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv');
}

function isPdf(name: string) {
  return name.toLowerCase().endsWith('.pdf');
}

function isZip(name: string) {
  return name.toLowerCase().endsWith('.zip');
}

export async function ingestUploads(projectId: string, formData: FormData, principal: Principal = ingestionPrincipal): Promise<{ project: ProjectManifest; job: BidJob; ingestionManifest: IngestionManifest }> {
  const projectRepo = new ProjectRepository();
  const jobRepo = new BidJobRepository();
  const project = await projectRepo.get(projectId, principal.organizationId);
  if (!project) {
    throw new ApiServiceError('PROJECT_NOT_FOUND', 'Project not found.', 404);
  }
  const systemPrincipal: Principal = { ...ingestionPrincipal, organizationId: principal.organizationId };

  const files = formData.getAll('files');
  if (files.length === 0) {
    throw new ApiServiceError('UPLOAD_FILES_REQUIRED', 'At least one upload file is required.', 400);
  }

  const candidates: IngestionCandidate[] = [];

  for (const value of files) {
    if (!(value instanceof File)) {
      continue;
    }
    const bytes = Buffer.from(await value.arrayBuffer());
    if (isZip(value.name)) {
      let extracted: IngestionCandidate[];
      try {
        extracted = discoverZipArchive(value.name, bytes);
      } catch (error) {
        if (error instanceof ArchiveSafetyError) {
          throw new ApiServiceError(error.code, error.message, 400, error.details);
        }
        throw error;
      }
      if (extracted.length === 0) {
        throw new ApiServiceError('EMPTY_ZIP', 'ZIP archive does not contain files.', 400, {
          fileName: value.name,
        });
      }
      const unsafePath = extracted.find((entry) => entry.disposition?.code === 'UNSAFE_ARCHIVE_PATH');
      if (unsafePath) {
        throw new ApiServiceError('ZIP_PATH_TRAVERSAL', 'ZIP archive contains an unsafe entry path.', 400, {
          fileName: value.name,
          entryPath: unsafePath.originalPath,
          reason: unsafePath.disposition?.message,
        });
      }
      const pdfCount = extracted.filter((entry) => !entry.disposition && isPdf(entry.originalPath)).length;
      if (pdfCount === 0) {
        throw new ApiServiceError('ZIP_WITHOUT_PDFS', 'ZIP archive must contain at least one PDF plan.', 400, {
          fileName: value.name,
          extractedFileCount: extracted.length,
        });
      }
      candidates.push(...extracted);
    } else {
      candidates.push({ originalPath: value.webkitRelativePath || value.name, bytes, mimeType: value.type || undefined });
    }
  }

  const existingRows = getDatabase()
    .prepare('SELECT id AS entryId, sha256, original_path AS originalPath FROM source_documents WHERE project_id = ?')
    .all(projectId) as Array<{ entryId: string; sha256: string; originalPath: string }>;
  const ingestionManifest = buildIngestionManifest(candidates, { existingContent: existingRows });
  const supportedEntries = ingestionManifest.entries.filter((entry) => entry.outcome === 'supported');
  if (supportedEntries.length === 0) {
    const soleFailureCode = ingestionManifest.entries.length === 1
      ? ingestionManifest.entries[0].reasonCode
      : undefined;
    const code = soleFailureCode === 'UNSUPPORTED_FILE_TYPE' ? 'UNSUPPORTED_FILE_TYPE' : 'NO_SUPPORTED_FILES';
    const message = code === 'UNSUPPORTED_FILE_TYPE'
      ? 'Unsupported file type. Allowed: .pdf, .zip, .xlsx, .xls, .csv'
      : 'No unique supported files were available to ingest.';
    throw new ApiServiceError(code, message, 400, {
      manifest: ingestionManifest,
    });
  }

  const incoming: ProjectFile[] = [];
  const sourceRows: Array<{ file: ProjectFile; entry: (typeof supportedEntries)[number] }> = [];
  const filesByManifestEntryId = new Map<string, ProjectFile>();
  for (const entry of supportedEntries) {
    const candidate = candidates[entry.ordinal - 1];
    if (!candidate?.bytes) continue;
    const id = randomUUID();
    const relativePath = `uploads/${project.projectId}/${id}_${path.basename(entry.baseName)}`;
    await writeBinary(relativePath, candidate.bytes);
    const file: ProjectFile = { id, name: entry.normalizedPath, path: relativePath, size: candidate.bytes.length, mimeType: entry.mimeType };
    incoming.push(file);
    sourceRows.push({ file, entry });
    filesByManifestEntryId.set(entry.entryId, file);
  }

  // The legacy project manifest represents every accepted upload association,
  // even when content is deduplicated. Duplicate aliases reuse the canonical
  // storage object and remain explicitly marked duplicate in the new manifest.
  for (const entry of ingestionManifest.entries) {
    if (entry.outcome !== 'duplicate' || !entry.duplicateOfEntryId) continue;
    const canonical = filesByManifestEntryId.get(entry.duplicateOfEntryId)
      || project.files.find((file) => file.id === entry.duplicateOfEntryId);
    if (!canonical) continue;
    incoming.push({
      id: randomUUID(),
      name: entry.normalizedPath,
      path: canonical.path,
      size: entry.sizeBytes,
      mimeType: entry.mimeType,
    });
  }

  project.files = [...project.files, ...incoming];
  project.pdfFiles = project.files.filter((f) => isPdf(f.name));
  project.workbookFiles = project.files.filter((f) => isWorkbook(f.name));
  project.processingStatus = 'uploaded';

  await projectRepo.save(project);

  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO ingestion_manifests (id, project_id, manifest_json, created_at) VALUES (?, ?, ?, ?)')
      .run(ingestionManifest.manifestId, projectId, JSON.stringify(ingestionManifest), ingestionManifest.createdAt);
    const entryStatement = db.prepare(`INSERT INTO ingestion_manifest_entries
      (id, manifest_id, ordinal, original_path, normalized_path, kind, outcome, sha256, size_bytes, reason_code, reason, duplicate_of_id, entry_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const entry of ingestionManifest.entries) {
      entryStatement.run(`${ingestionManifest.manifestId}:${entry.entryId}`, ingestionManifest.manifestId, entry.ordinal, entry.originalPath, entry.normalizedPath, entry.kind, entry.outcome, entry.sha256 || null, entry.sizeBytes, entry.reasonCode || null, entry.reason || null, entry.duplicateOfEntryId || null, JSON.stringify(entry));
    }
    const sourceStatement = db.prepare(`INSERT INTO source_documents
      (id, project_id, original_path, storage_key, file_name, mime_type, byte_size, sha256, outcome, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?)`);
    for (const { file, entry } of sourceRows) {
      sourceStatement.run(file.id, projectId, entry.originalPath, file.path, file.name, file.mimeType, file.size, entry.sha256, ingestionManifest.createdAt);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const job = await jobRepo.create(project);
  initializeFileQueue(job.id, sourceRows.map(({ file }) => file.id));
  job.state = 'files_ingested';
  job.logs.push({
    jobId: job.id,
    stage: 'upload_ingestion',
    event: 'complete',
    uploadedFiles: incoming.length,
    ingestionManifestId: ingestionManifest.manifestId,
    rejectedFiles: ingestionManifest.summary.rejected,
    duplicateFiles: ingestionManifest.summary.duplicate,
    pdfFiles: project.pdfFiles.length,
    workbookFiles: project.workbookFiles.length,
    time: new Date().toISOString(),
  });
  await jobRepo.save(job);
  advanceCanonicalSystemState(job.id, 'source_files_ingested', systemPrincipal, 'Validated source files persisted from the server upload manifest.');
  createNotificationOnce({ principalId: principal.id, projectId, bidJobId: job.id, type: 'upload_complete', severity: 'success',
    title: 'Upload complete', body: `${supportedEntries.length} unique supported file(s) entered the project queue.`,
    targetPath: `/?job=${encodeURIComponent(job.id)}` });

  return { project, job, ingestionManifest };
}
