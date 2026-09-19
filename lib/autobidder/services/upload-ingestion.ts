import 'server-only';
import path from 'path';
import { randomUUID } from 'crypto';
import type { BidJob, ProjectFile, ProjectManifest } from '@/types';
import { ApiServiceError } from '@/lib/autobidder/api/errors';
import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { writeBinary } from '@/lib/autobidder/storage/file-store';
import { extractZipFiles } from '@/lib/autobidder/services/zip-service';

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

export async function ingestUploads(projectId: string, formData: FormData): Promise<{ project: ProjectManifest; job: BidJob }> {
  const projectRepo = new ProjectRepository();
  const jobRepo = new BidJobRepository();
  const project = await projectRepo.get(projectId);
  if (!project) {
    throw new ApiServiceError('PROJECT_NOT_FOUND', 'Project not found.', 404);
  }

  const files = formData.getAll('files');
  if (files.length === 0) {
    throw new ApiServiceError('UPLOAD_FILES_REQUIRED', 'At least one upload file is required.', 400);
  }

  const incoming: ProjectFile[] = [];

  for (const value of files) {
    if (!(value instanceof File)) {
      continue;
    }
    const bytes = Buffer.from(await value.arrayBuffer());
    if (isZip(value.name)) {
      const extracted = extractZipFiles(bytes);
      if (extracted.files.length === 0) {
        throw new ApiServiceError('EMPTY_ZIP', 'ZIP archive does not contain supported files.', 400, {
          fileName: value.name,
          ignoredEntries: extracted.ignoredEntries,
        });
      }
      const pdfCount = extracted.files.filter((entry) => isPdf(entry.name)).length;
      if (pdfCount === 0) {
        throw new ApiServiceError('ZIP_WITHOUT_PDFS', 'ZIP archive must contain at least one PDF plan.', 400, {
          fileName: value.name,
          extractedFileCount: extracted.files.length,
        });
      }

      for (const entry of extracted.files) {
        const id = randomUUID();
        const relativePath = `uploads/${project.projectId}/${id}_${path.basename(entry.name)}`;
        await writeBinary(relativePath, entry.buffer);
        incoming.push({
          id,
          name: entry.name,
          path: relativePath,
          size: entry.buffer.length,
          mimeType: entry.mimeType,
        });
      }
    } else {
      if (!isPdf(value.name) && !isWorkbook(value.name)) {
        throw new ApiServiceError('UNSUPPORTED_FILE_TYPE', 'Unsupported file type. Allowed: .pdf, .zip, .xlsx, .xls, .csv', 400, {
          fileName: value.name,
        });
      }

      const id = randomUUID();
      const relativePath = `uploads/${project.projectId}/${id}_${path.basename(value.name)}`;
      await writeBinary(relativePath, bytes);
      incoming.push({
        id,
        name: value.name,
        path: relativePath,
        size: bytes.length,
        mimeType: value.type || 'application/octet-stream',
      });
    }
  }

  project.files = [...project.files, ...incoming];
  project.pdfFiles = project.files.filter((f) => isPdf(f.name));
  project.workbookFiles = project.files.filter((f) => isWorkbook(f.name));
  project.processingStatus = 'uploaded';

  await projectRepo.save(project);

  const job = await jobRepo.create(project);
  job.state = 'files_ingested';
  job.logs.push({
    jobId: job.id,
    stage: 'upload_ingestion',
    event: 'complete',
    uploadedFiles: incoming.length,
    pdfFiles: project.pdfFiles.length,
    workbookFiles: project.workbookFiles.length,
    time: new Date().toISOString(),
  });
  await jobRepo.save(job);

  return { project, job };
}
