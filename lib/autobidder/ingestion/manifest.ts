import 'server-only';

import { createHash, randomUUID } from 'crypto';
import path from 'path';

export type IngestionFileKind = 'plan_pdf' | 'pricing_workbook' | 'unknown';
export type IngestionOutcome = 'supported' | 'rejected' | 'duplicate' | 'failed';

export interface IngestionDisposition {
  outcome: Extract<IngestionOutcome, 'rejected' | 'failed'>;
  code: string;
  message: string;
}

export interface IngestionCandidate {
  originalPath: string;
  bytes?: Buffer;
  declaredSizeBytes?: number;
  mimeType?: string;
  sourceArchivePath?: string;
  disposition?: IngestionDisposition;
}

export interface ExistingContentIdentity {
  entryId: string;
  sha256: string;
  originalPath: string;
}

export interface IngestionManifestEntry {
  entryId: string;
  ordinal: number;
  originalPath: string;
  normalizedPath: string;
  baseName: string;
  sourceArchivePath?: string;
  kind: IngestionFileKind;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
  outcome: IngestionOutcome;
  reasonCode?: string;
  reason?: string;
  duplicateOfEntryId?: string;
  duplicateOfPath?: string;
}

export interface IngestionManifest {
  manifestId: string;
  createdAt: string;
  entries: IngestionManifestEntry[];
  summary: Record<IngestionOutcome, number> & {
    total: number;
    totalDeclaredBytes: number;
    uniqueSupportedBytes: number;
  };
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
};

export function normalizeIngestionPath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function unsafeIngestionPathReason(input: string): string | null {
  const normalized = normalizeIngestionPath(input);
  const segments = normalized.split('/').filter(Boolean);
  if (!normalized || normalized.includes('\0')) return 'Path is empty or contains a null byte.';
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) return 'Absolute paths are not allowed.';
  if (segments.includes('..')) return 'Parent-directory traversal is not allowed.';
  return null;
}

export function classifyIngestionFile(filePath: string): IngestionFileKind {
  const extension = path.posix.extname(normalizeIngestionPath(filePath)).toLowerCase();
  if (extension === '.pdf') return 'plan_pdf';
  if (extension === '.xlsx' || extension === '.xls' || extension === '.csv') return 'pricing_workbook';
  return 'unknown';
}

export function inferIngestionMimeType(filePath: string): string {
  return MIME_BY_EXTENSION[path.posix.extname(normalizeIngestionPath(filePath)).toLowerCase()] || 'application/octet-stream';
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function buildIngestionManifest(
  candidates: readonly IngestionCandidate[],
  options: {
    existingContent?: readonly ExistingContentIdentity[];
    now?: Date;
    manifestId?: string;
  } = {},
): IngestionManifest {
  const knownContent = new Map<string, ExistingContentIdentity>();
  for (const item of options.existingContent || []) {
    knownContent.set(item.sha256.toLowerCase(), item);
  }

  const entries: IngestionManifestEntry[] = candidates.map((candidate, index) => {
    const entryId = `entry-${index + 1}`;
    const normalizedPath = normalizeIngestionPath(candidate.originalPath);
    const sizeBytes = candidate.bytes?.length ?? candidate.declaredSizeBytes ?? 0;
    const kind = classifyIngestionFile(normalizedPath);
    const digest = candidate.bytes ? sha256Hex(candidate.bytes) : undefined;
    const common = {
      entryId,
      ordinal: index + 1,
      originalPath: candidate.originalPath,
      normalizedPath,
      baseName: path.posix.basename(normalizedPath),
      sourceArchivePath: candidate.sourceArchivePath,
      kind,
      mimeType: candidate.mimeType || inferIngestionMimeType(normalizedPath),
      sizeBytes,
      sha256: digest,
    } satisfies Omit<IngestionManifestEntry, 'outcome'>;

    if (candidate.disposition) {
      return {
        ...common,
        outcome: candidate.disposition.outcome,
        reasonCode: candidate.disposition.code,
        reason: candidate.disposition.message,
      };
    }

    const unsafeReason = unsafeIngestionPathReason(normalizedPath);
    if (unsafeReason) {
      return { ...common, outcome: 'rejected', reasonCode: 'UNSAFE_PATH', reason: unsafeReason };
    }
    if (kind === 'unknown') {
      return {
        ...common,
        outcome: 'rejected',
        reasonCode: 'UNSUPPORTED_FILE_TYPE',
        reason: 'Supported files are PDF, XLSX, XLS, and CSV.',
      };
    }
    if (!candidate.bytes) {
      return {
        ...common,
        outcome: 'failed',
        reasonCode: 'CONTENT_UNAVAILABLE',
        reason: 'File content was not available for validation and hashing.',
      };
    }
    if (candidate.bytes.length === 0) {
      return { ...common, outcome: 'rejected', reasonCode: 'EMPTY_FILE', reason: 'Empty files are not supported.' };
    }

    const duplicate = knownContent.get(digest as string);
    if (duplicate) {
      return {
        ...common,
        outcome: 'duplicate',
        reasonCode: 'DUPLICATE_CONTENT',
        reason: 'The file has the same SHA-256 content identity as an existing supported file.',
        duplicateOfEntryId: duplicate.entryId,
        duplicateOfPath: duplicate.originalPath,
      };
    }

    knownContent.set(digest as string, {
      entryId,
      sha256: digest as string,
      originalPath: normalizedPath,
    });
    return { ...common, outcome: 'supported' };
  });

  const summary: IngestionManifest['summary'] = {
    total: entries.length,
    supported: 0,
    rejected: 0,
    duplicate: 0,
    failed: 0,
    totalDeclaredBytes: 0,
    uniqueSupportedBytes: 0,
  };
  for (const entry of entries) {
    summary[entry.outcome] += 1;
    summary.totalDeclaredBytes += entry.sizeBytes;
    if (entry.outcome === 'supported') summary.uniqueSupportedBytes += entry.sizeBytes;
  }

  return {
    manifestId: options.manifestId || randomUUID(),
    createdAt: (options.now || new Date()).toISOString(),
    entries,
    summary,
  };
}
