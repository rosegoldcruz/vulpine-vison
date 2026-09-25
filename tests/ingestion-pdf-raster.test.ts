import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PdfRasterError, renderPdfToBuffers } from '@/lib/autobidder/ingestion/pdf-raster-service';

const FIXTURE = path.resolve(process.cwd(), 'fixtures/phase-zero/real-plan-a.pdf');

describe('server-side PDF raster service', () => {
  it('renders a real PDF fixture to bounded Buffer artifacts with stable page identity', async () => {
    const pages = await renderPdfToBuffers({
      sourceDocumentId: 'source-doc-real-a',
      documentName: 'real-plan-a.pdf',
      pdf: readFileSync(FIXTURE),
      limits: {
        requestedDpi: 144,
        maxDpi: 144,
        maxPixelsPerPage: 350_000,
        maxDimensionPixels: 2_000,
        format: 'jpeg',
      },
    });

    expect(pages).toHaveLength(2);
    expect(pages.map((page) => page.pageIdentity)).toEqual([
      'source-doc-real-a:page:1',
      'source-doc-real-a:page:2',
    ]);
    for (const [index, page] of pages.entries()) {
      expect(page.pageNumber).toBe(index + 1);
      expect(page.pageCount).toBe(2);
      expect(page.artifact).toBeInstanceOf(Buffer);
      expect(page.artifact.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
      expect(page.mimeType).toBe('image/jpeg');
      expect(page.widthPixels * page.heightPixels).toBeLessThanOrEqual(352_000);
      expect(page.downscaledToSafetyLimit).toBe(true);
      expect(page.effectiveDpi).toBeLessThan(144);
      expect(page.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(page.widthPoints).toBeGreaterThan(0);
      expect(page.heightPoints).toBeGreaterThan(0);
    }
  }, 120_000);

  it('enforces input and page-count limits with stable error codes', async () => {
    await expect(
      renderPdfToBuffers({
        sourceDocumentId: 'too-large',
        documentName: 'too-large.pdf',
        pdf: Buffer.from('%PDF oversized'),
        limits: { maxInputBytes: 2 },
      }),
    ).rejects.toMatchObject({ code: 'PDF_INPUT_TOO_LARGE' } satisfies Partial<PdfRasterError>);

    await expect(
      renderPdfToBuffers({
        sourceDocumentId: 'too-many-pages',
        documentName: 'real-plan-a.pdf',
        pdf: readFileSync(FIXTURE),
        limits: { maxPages: 1 },
      }),
    ).rejects.toMatchObject({ code: 'PDF_PAGE_LIMIT_EXCEEDED' } satisfies Partial<PdfRasterError>);
  }, 120_000);
});
