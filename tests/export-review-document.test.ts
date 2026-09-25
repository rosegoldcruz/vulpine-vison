import { describe, expect, it } from 'vitest';
import {
  buildExportSnapshot,
  generateReviewPdf,
  getReviewPdfCapability,
  renderInternalReviewHtml,
} from '@/lib/autobidder/exports';
import { makeExportInput } from './export-test-fixture';

describe('compiled internal review document', () => {
  it('renders all required review sections with an internal-only warning', () => {
    const snapshot = buildExportSnapshot(makeExportInput({ projectName: 'Oak <script>alert(1)</script>' }));
    const document = renderInternalReviewHtml(snapshot);

    for (let section = 1; section <= 11; section += 1) {
      expect(document).toContain(`<h2>${section}.`);
    }
    expect(document).toContain('INTERNAL REVIEW — NOT CUSTOMER BID');
    expect(document).toContain('UNSAFE TO SEND — INTERNAL REVIEW ONLY');
    expect(document).toContain('24 in verified dimension');
    expect(document).toContain('Annotated kitchen evidence');
    expect(document).toContain('pricing.xlsx / Catalog / row 42');
    expect(document).toContain('Oak &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(document).not.toContain('<script>alert(1)</script>');
    expect(document.match(/page-break/g)?.length).toBeGreaterThanOrEqual(10);
  });

  it('generates a real multi-page PDF and retains deterministic HTML fallback', async () => {
    const snapshot = buildExportSnapshot(makeExportInput());
    expect(getReviewPdfCapability()).toEqual(
      expect.objectContaining({ available: true, provider: 'pdf-lib', fallback: 'deterministic_html' }),
    );
    const pdf = await generateReviewPdf(snapshot);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5_000);
  });
});
