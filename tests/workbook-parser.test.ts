import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { parseWorkbook } from '@/lib/autobidder/services/workbook-parser';

describe('workbook parser', () => {
  it('preserves XLSX prices and worksheet provenance', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([
      { SKU: 'CAB-01', 'Cabinet Code': 'B24', 'Unit Cost': 125.5, Description: 'Base' },
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Cabinet Pricing');
    const buffer = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
    const records = parseWorkbook(buffer, '/private/estimate.xlsx');

    expect(records).toEqual([expect.objectContaining({
      sku: 'CAB-01',
      cabinetCode: 'B24',
      unitCostCents: 12550,
      sourceWorkbook: 'estimate.xlsx',
      sourceSheet: 'Cabinet Pricing',
      sourceRow: 2,
    })]);
  });

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
