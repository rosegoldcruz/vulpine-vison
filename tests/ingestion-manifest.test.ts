import { describe, expect, it } from 'vitest';
import {
  buildIngestionManifest,
  sha256Hex,
  type ExistingContentIdentity,
} from '@/lib/autobidder/ingestion/manifest';

describe('ingestion manifest', () => {
  it('records supported, rejected, duplicate, and failed outcomes without losing source paths', () => {
    const planBytes = Buffer.from('%PDF-1.7 unique-plan');
    const manifest = buildIngestionManifest(
      [
        { originalPath: 'plans/architectural/A101.pdf', bytes: planBytes },
        { originalPath: 'plans/copy/A101-copy.pdf', bytes: Buffer.from(planBytes), sourceArchivePath: 'plans.zip' },
        { originalPath: 'notes/readme.txt', bytes: Buffer.from('unsupported') },
        { originalPath: 'pricing/catalog.csv', bytes: Buffer.from('sku,cost\nB24,10') },
        { originalPath: 'plans/missing.pdf' },
      ],
      { manifestId: 'manifest-1', now: new Date('2026-01-02T03:04:05.000Z') },
    );

    expect(manifest.manifestId).toBe('manifest-1');
    expect(manifest.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(manifest.summary).toMatchObject({ total: 5, supported: 2, duplicate: 1, rejected: 1, failed: 1 });
    expect(manifest.entries[0]).toMatchObject({
      normalizedPath: 'plans/architectural/A101.pdf',
      kind: 'plan_pdf',
      outcome: 'supported',
      sha256: sha256Hex(planBytes),
    });
    expect(manifest.entries[1]).toMatchObject({
      sourceArchivePath: 'plans.zip',
      outcome: 'duplicate',
      duplicateOfEntryId: 'entry-1',
      duplicateOfPath: 'plans/architectural/A101.pdf',
    });
    expect(manifest.entries[2]).toMatchObject({ outcome: 'rejected', reasonCode: 'UNSUPPORTED_FILE_TYPE' });
    expect(manifest.entries[4]).toMatchObject({ outcome: 'failed', reasonCode: 'CONTENT_UNAVAILABLE' });
  });

  it('detects duplicates against content already persisted by the project', () => {
    const bytes = Buffer.from('%PDF persisted');
    const existing: ExistingContentIdentity = {
      entryId: 'persisted-document-7',
      originalPath: 'prior/A201.pdf',
      sha256: sha256Hex(bytes),
    };

    const manifest = buildIngestionManifest(
      [{ originalPath: 'new/A201-renamed.pdf', bytes }],
      { existingContent: [existing] },
    );

    expect(manifest.entries[0]).toMatchObject({
      outcome: 'duplicate',
      duplicateOfEntryId: 'persisted-document-7',
      duplicateOfPath: 'prior/A201.pdf',
    });
    expect(manifest.summary.uniqueSupportedBytes).toBe(0);
  });

  it('rejects traversal and empty supported files explicitly', () => {
    const manifest = buildIngestionManifest([
      { originalPath: '../escape.pdf', bytes: Buffer.from('%PDF') },
      { originalPath: 'empty.pdf', bytes: Buffer.alloc(0) },
    ]);

    expect(manifest.entries.map((entry) => entry.reasonCode)).toEqual(['UNSAFE_PATH', 'EMPTY_FILE']);
    expect(manifest.summary.rejected).toBe(2);
  });
});
