import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  buildExportSnapshot,
  escapeCsvCell,
  neutralizeSpreadsheetFormula,
  serializeExportCsv,
  serializeExportJson,
  serializeExportXlsx,
} from '@/lib/autobidder/exports';
import { makeExportInput } from './export-test-fixture';

describe('export serializers', () => {
  it('uses RFC-style quoting and neutralizes spreadsheet formulas', () => {
    expect(escapeCsvCell('Cabinet "A", line\n2')).toBe('"Cabinet ""A"", line\n2"');
    expect(neutralizeSpreadsheetFormula('=2+2')).toBe("'=2+2");
    expect(neutralizeSpreadsheetFormula('  @SUM(A1:A2)')).toBe("'  @SUM(A1:A2)");
    expect(escapeCsvCell(12500)).toBe('12500');
  });

  it('serializes stable JSON and a provenance-preserving CSV', () => {
    const snapshot = buildExportSnapshot(makeExportInput({ description: '=HYPERLINK("bad")' }));
    const firstJson = serializeExportJson(snapshot).toString('utf8');
    const secondJson = serializeExportJson(snapshot).toString('utf8');
    const csv = serializeExportCsv(snapshot).toString('utf8');

    expect(firstJson).toBe(secondJson);
    expect(firstJson).toContain('"schemaVersion": "cabinet-export-snapshot/v1"');
    expect(csv).toContain('record_type,record_id');
    expect(csv).toContain('provenance');
    expect(csv).toContain('pricing.xlsx');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('creates a multi-sheet XLSX without formula cells', () => {
    const snapshot = buildExportSnapshot(makeExportInput({ description: '=2+2' }));
    const bytes = serializeExportXlsx(snapshot);
    const workbook = XLSX.read(bytes, { type: 'buffer', cellFormula: true });

    expect(workbook.SheetNames).toEqual([
      'Summary',
      'Unit Mix',
      'Takeoff',
      'SKU Mapping',
      'Estimate',
      'QA',
      'Evidence',
      'Approvals',
      'Assumptions',
      'Provenance',
    ]);
    expect(workbook.Sheets.Estimate.C2.v).toBe("'=2+2");
    for (const sheet of Object.values(workbook.Sheets)) {
      for (const cell of Object.values(sheet)) {
        if (cell && typeof cell === 'object' && 't' in cell) expect(cell.f).toBeUndefined();
      }
    }
  });
});
