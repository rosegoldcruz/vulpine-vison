import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { parseWorkbook } from '@/lib/autobidder/services/workbook-parser';

describe('workbook parser', () => {
  it('parses csv workbook records with traceability', () => {
    const csvPath = path.resolve(process.cwd(), 'fixtures/golden-project/pricing-workbook.csv');
    const buffer = readFileSync(csvPath);
    const records = parseWorkbook(buffer, csvPath);

    expect(records.length).toBeGreaterThan(0);
    expect(records[0].sourceWorkbook).toBe('pricing-workbook.csv');
    expect(records[0].sourceSheet.length).toBeGreaterThan(0);
    expect(records[0].sourceRow).toBeGreaterThan(1);
  });
});
