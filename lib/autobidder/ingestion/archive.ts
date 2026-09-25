import 'server-only';

import AdmZip from 'adm-zip';
import type { IngestionCandidate } from './manifest';
import { classifyIngestionFile, normalizeIngestionPath, unsafeIngestionPathReason } from './manifest';

export interface ArchiveSafetyLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
  maxPathLength: number;
}

export const DEFAULT_ARCHIVE_SAFETY_LIMITS: Readonly<ArchiveSafetyLimits> = Object.freeze({
  maxArchiveBytes: 512 * 1024 * 1024,
  maxEntries: 2_000,
  maxEntryUncompressedBytes: 256 * 1024 * 1024,
  maxTotalUncompressedBytes: 2 * 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxPathLength: 1_024,
});

export class ArchiveSafetyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ArchiveSafetyError';
  }
}

function limitsWithDefaults(overrides: Partial<ArchiveSafetyLimits> = {}): ArchiveSafetyLimits {
  const limits = { ...DEFAULT_ARCHIVE_SAFETY_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new ArchiveSafetyError('INVALID_ARCHIVE_LIMIT', `Archive limit ${name} must be a positive finite number.`, {
        name,
        value,
      });
    }
  }
  return limits;
}

function rejectedCandidate(
  originalPath: string,
  archiveName: string,
  declaredSizeBytes: number,
  code: string,
  message: string,
): IngestionCandidate {
  return {
    originalPath,
    sourceArchivePath: archiveName,
    declaredSizeBytes,
    disposition: { outcome: 'rejected', code, message },
  };
}

export function discoverZipArchive(
  archiveName: string,
  archiveBytes: Buffer,
  limitOverrides: Partial<ArchiveSafetyLimits> = {},
): IngestionCandidate[] {
  const limits = limitsWithDefaults(limitOverrides);
  if (archiveBytes.length > limits.maxArchiveBytes) {
    throw new ArchiveSafetyError('ARCHIVE_TOO_LARGE', 'ZIP archive exceeds the configured compressed-size limit.', {
      archiveName,
      actualBytes: archiveBytes.length,
      maxBytes: limits.maxArchiveBytes,
    });
  }

  let archive: AdmZip;
  let entries: AdmZip.IZipEntry[];
  try {
    archive = new AdmZip(archiveBytes);
    entries = archive.getEntries();
  } catch {
    throw new ArchiveSafetyError('INVALID_ZIP', 'ZIP archive is invalid or unreadable.', { archiveName });
  }

  const fileEntries = entries.filter((entry) => !entry.isDirectory);
  if (fileEntries.length > limits.maxEntries) {
    throw new ArchiveSafetyError('ARCHIVE_ENTRY_LIMIT_EXCEEDED', 'ZIP archive contains too many file entries.', {
      archiveName,
      actualEntries: fileEntries.length,
      maxEntries: limits.maxEntries,
    });
  }

  const declaredTotal = fileEntries.reduce((total, entry) => total + entry.header.size, 0);
  if (declaredTotal > limits.maxTotalUncompressedBytes) {
    throw new ArchiveSafetyError('ARCHIVE_UNCOMPRESSED_LIMIT_EXCEEDED', 'ZIP archive exceeds the total uncompressed-size limit.', {
      archiveName,
      actualBytes: declaredTotal,
      maxBytes: limits.maxTotalUncompressedBytes,
    });
  }

  const candidates: IngestionCandidate[] = [];
  for (const entry of fileEntries) {
    const normalizedPath = normalizeIngestionPath(entry.entryName);
    const declaredSize = entry.header.size;
    const unsafeReason = unsafeIngestionPathReason(normalizedPath);
    if (unsafeReason) {
      candidates.push(rejectedCandidate(normalizedPath, archiveName, declaredSize, 'UNSAFE_ARCHIVE_PATH', unsafeReason));
      continue;
    }
    if (normalizedPath.length > limits.maxPathLength) {
      candidates.push(
        rejectedCandidate(
          normalizedPath,
          archiveName,
          declaredSize,
          'ARCHIVE_PATH_TOO_LONG',
          `Archive entry path exceeds ${limits.maxPathLength} characters.`,
        ),
      );
      continue;
    }
    if (entry.header.encrypted) {
      candidates.push(
        rejectedCandidate(normalizedPath, archiveName, declaredSize, 'ENCRYPTED_ARCHIVE_ENTRY', 'Encrypted ZIP entries are not supported.'),
      );
      continue;
    }
    if (declaredSize > limits.maxEntryUncompressedBytes) {
      candidates.push(
        rejectedCandidate(
          normalizedPath,
          archiveName,
          declaredSize,
          'ARCHIVE_ENTRY_TOO_LARGE',
          `Archive entry exceeds ${limits.maxEntryUncompressedBytes} uncompressed bytes.`,
        ),
      );
      continue;
    }

    const compressedSize = entry.header.compressedSize;
    const compressionRatio = compressedSize === 0 ? (declaredSize === 0 ? 1 : Number.POSITIVE_INFINITY) : declaredSize / compressedSize;
    if (compressionRatio > limits.maxCompressionRatio) {
      candidates.push(
        rejectedCandidate(
          normalizedPath,
          archiveName,
          declaredSize,
          'SUSPICIOUS_COMPRESSION_RATIO',
          `Archive entry compression ratio exceeds ${limits.maxCompressionRatio}:1.`,
        ),
      );
      continue;
    }

    if (classifyIngestionFile(normalizedPath) === 'unknown') {
      candidates.push(
        rejectedCandidate(
          normalizedPath,
          archiveName,
          declaredSize,
          'UNSUPPORTED_FILE_TYPE',
          'Supported archive files are PDF, XLSX, XLS, and CSV.',
        ),
      );
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = entry.getData();
    } catch {
      candidates.push({
        originalPath: normalizedPath,
        sourceArchivePath: archiveName,
        declaredSizeBytes: declaredSize,
        disposition: { outcome: 'failed', code: 'ARCHIVE_EXTRACTION_FAILED', message: 'Archive entry could not be decompressed.' },
      });
      continue;
    }
    if (bytes.length !== declaredSize) {
      candidates.push({
        originalPath: normalizedPath,
        sourceArchivePath: archiveName,
        declaredSizeBytes: declaredSize,
        disposition: {
          outcome: 'failed',
          code: 'ARCHIVE_SIZE_MISMATCH',
          message: 'Decompressed entry size did not match the ZIP header.',
        },
      });
      continue;
    }
    candidates.push({ originalPath: normalizedPath, sourceArchivePath: archiveName, bytes });
  }

  return candidates;
}
