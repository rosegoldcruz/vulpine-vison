import 'server-only';
import AdmZip from 'adm-zip';
import { ApiServiceError } from '@/lib/autobidder/api/errors';

export interface ExtractedUpload {
  name: string;
  buffer: Buffer;
  mimeType: string;
}

export interface ZipExtractionResult {
  files: ExtractedUpload[];
  ignoredEntries: string[];
}

function detectMime(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.csv')) return 'text/csv';
  return 'application/octet-stream';
}

export function extractZipFiles(zipBuffer: Buffer): ZipExtractionResult {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new ApiServiceError('INVALID_ZIP', 'Uploaded ZIP archive is invalid or unreadable.', 400);
  }
  const files: ExtractedUpload[] = [];
  const ignoredEntries: string[] = [];

  let entries: AdmZip.IZipEntry[];
  try {
    entries = zip.getEntries();
  } catch {
    throw new ApiServiceError('INVALID_ZIP', 'Uploaded ZIP archive is invalid or unreadable.', 400);
  }

  for (const entry of entries) {
    if (entry.isDirectory) {
      continue;
    }
    const normalized = entry.entryName.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    if (normalized.startsWith('/') || normalized.startsWith('\\') || parts.includes('..')) {
      throw new ApiServiceError('ZIP_PATH_TRAVERSAL', 'ZIP contains unsafe path traversal entry.', 400, {
        entry: normalized,
      });
    }

    const lower = normalized.toLowerCase();
    if (lower.includes('__macosx/') || lower.endsWith('.ds_store') || lower.endsWith('/')) {
      ignoredEntries.push(normalized);
      continue;
    }
    if (
      lower.endsWith('.pdf') ||
      lower.endsWith('.xlsx') ||
      lower.endsWith('.xls') ||
      lower.endsWith('.csv')
    ) {
      files.push({
        name: normalized,
        buffer: entry.getData(),
        mimeType: detectMime(normalized),
      });
    } else {
      ignoredEntries.push(normalized);
    }
  }

  return {
    files,
    ignoredEntries,
  };
}
