import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { extractZipFiles } from '@/lib/autobidder/services/zip-service';

describe('zip service', () => {
  it('extracts nested pdf and workbook files', () => {
    const zip = new AdmZip();
    zip.addFile('nested/plan/a101.pdf', Buffer.from('%PDF-1.4 sample'));
    zip.addFile('nested/pricing/workbook.csv', Buffer.from('sku,cabinet_code,unit_cost\nX1,B24,123\n'));
    zip.addFile('nested/ignore/readme.txt', Buffer.from('ignore'));

    const results = extractZipFiles(zip.toBuffer());
    const names = results.files.map((r) => r.name);

    expect(names).toContain('nested/plan/a101.pdf');
    expect(names).toContain('nested/pricing/workbook.csv');
    expect(names.some((n) => n.endsWith('.txt'))).toBe(false);
  });
});
