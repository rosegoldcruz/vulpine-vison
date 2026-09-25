import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { ArchiveSafetyError, discoverZipArchive } from '@/lib/autobidder/ingestion/archive';
import { buildIngestionManifest } from '@/lib/autobidder/ingestion/manifest';

function zipBuffer(entries: Array<{ name: string; bytes: Buffer }>): Buffer {
  const zip = new AdmZip();
  for (const entry of entries) zip.addFile(entry.name, entry.bytes);
  return zip.toBuffer();
}

describe('bounded ZIP discovery', () => {
  it('preserves nested directory paths and reports unsupported entries in the complete manifest', () => {
    const archive = zipBuffer([
      { name: 'plans/architectural/A101.pdf', bytes: Buffer.from('%PDF nested') },
      { name: 'pricing/catalog.csv', bytes: Buffer.from('sku,cost\nB24,10') },
      { name: 'coordination/readme.txt', bytes: Buffer.from('ignore') },
    ]);

    const candidates = discoverZipArchive('project-package.zip', archive);
    const manifest = buildIngestionManifest(candidates, { manifestId: 'zip-manifest' });

    expect(manifest.entries.map((entry) => entry.normalizedPath)).toEqual([
      'coordination/readme.txt',
      'plans/architectural/A101.pdf',
      'pricing/catalog.csv',
    ]);
    expect(manifest.summary).toMatchObject({ total: 3, supported: 2, rejected: 1 });
    expect(manifest.entries.every((entry) => entry.sourceArchivePath === 'project-package.zip')).toBe(true);
    expect(manifest.entries[0]).toMatchObject({ reasonCode: 'UNSUPPORTED_FILE_TYPE', outcome: 'rejected' });
  });

  it('rejects an oversized entry before decompression while preserving safe entries', () => {
    const archive = zipBuffer([
      { name: 'plans/too-large.pdf', bytes: Buffer.alloc(64, 1) },
      { name: 'plans/safe.pdf', bytes: Buffer.from('%PDF') },
    ]);

    const candidates = discoverZipArchive('bounded.zip', archive, {
      maxEntryUncompressedBytes: 16,
      maxTotalUncompressedBytes: 1_000,
    });
    const manifest = buildIngestionManifest(candidates);

    expect(manifest.entries.find((entry) => entry.baseName === 'too-large.pdf')).toMatchObject({
      outcome: 'rejected',
      reasonCode: 'ARCHIVE_ENTRY_TOO_LARGE',
    });
    expect(manifest.entries.find((entry) => entry.baseName === 'safe.pdf')?.outcome).toBe('supported');
  });

  it('rejects suspicious compression ratios before expanding entry data', () => {
    const archive = zipBuffer([{ name: 'plans/compression-bomb.pdf', bytes: Buffer.alloc(32_000, 0) }]);
    const candidates = discoverZipArchive('ratio.zip', archive, {
      maxCompressionRatio: 2,
      maxEntryUncompressedBytes: 100_000,
      maxTotalUncompressedBytes: 100_000,
    });
    const manifest = buildIngestionManifest(candidates);

    expect(manifest.entries[0]).toMatchObject({
      outcome: 'rejected',
      reasonCode: 'SUSPICIOUS_COMPRESSION_RATIO',
    });
  });

  it('fails closed when archive-wide entry or declared-size limits are exceeded', () => {
    const archive = zipBuffer([
      { name: 'a.pdf', bytes: Buffer.from('1234') },
      { name: 'b.pdf', bytes: Buffer.from('5678') },
    ]);

    expect(() => discoverZipArchive('entries.zip', archive, { maxEntries: 1 })).toThrowError(
      expect.objectContaining<Partial<ArchiveSafetyError>>({ code: 'ARCHIVE_ENTRY_LIMIT_EXCEEDED' }),
    );
    expect(() => discoverZipArchive('bytes.zip', archive, { maxTotalUncompressedBytes: 7 })).toThrowError(
      expect.objectContaining<Partial<ArchiveSafetyError>>({ code: 'ARCHIVE_UNCOMPRESSED_LIMIT_EXCEEDED' }),
    );
  });

  it('rejects invalid archives with a stable typed error', () => {
    expect(() => discoverZipArchive('broken.zip', Buffer.from('not-a-zip'))).toThrowError(
      expect.objectContaining<Partial<ArchiveSafetyError>>({ code: 'INVALID_ZIP' }),
    );
  });
});
