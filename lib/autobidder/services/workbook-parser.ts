import 'server-only';
import path from 'path';
import * as xlsx from 'xlsx';
import type { WorkbookRecord } from '@/types';
import { ApiServiceError } from '@/lib/autobidder/api/errors';

function toCents(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return Math.round(numeric * 100);
}

function pick<T extends Record<string, unknown>>(row: T, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && `${row[key]}`.trim() !== '') {
      return row[key];
    }
  }
  return undefined;
}

export function parseWorkbook(buffer: Buffer, sourceWorkbook: string): WorkbookRecord[] {
  let wb: xlsx.WorkBook;
  try {
    wb = xlsx.read(buffer, { type: 'buffer' });
  } catch {
    throw new ApiServiceError('CORRUPT_WORKBOOK', 'Workbook file is corrupt or unreadable.', 400, {
      sourceWorkbook: path.basename(sourceWorkbook),
    });
  }
  if (!wb.SheetNames.length) {
    throw new ApiServiceError('CORRUPT_WORKBOOK', 'Workbook has no sheets.', 400, {
      sourceWorkbook: path.basename(sourceWorkbook),
    });
  }
  const records: WorkbookRecord[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    rows.forEach((row, idx) => {
      const sku = `${pick(row, ['sku', 'SKU', 'Sku']) ?? ''}`.trim();
      const cabinetCode = `${pick(row, ['cabinet_code', 'Cabinet Code', 'cabinetCode', 'Code']) ?? ''}`.trim();
      if (!sku && !cabinetCode) {
        return;
      }
      records.push({
        sku,
        cabinetCode,
        description: `${pick(row, ['description', 'Description']) ?? ''}`.trim(),
        finish: `${pick(row, ['finish', 'Finish']) ?? ''}`.trim(),
        constructionFamily: `${pick(row, ['construction_family', 'Construction Family']) ?? ''}`.trim(),
        unitCostCents: toCents(pick(row, ['unit_cost', 'Unit Cost', 'unitCost', 'Cost'])),
        sourceWorkbook: path.basename(sourceWorkbook),
        sourceSheet: sheetName,
        sourceRow: idx + 2,
      });
    });
  }

  if (records.length === 0) {
    throw new ApiServiceError('WORKBOOK_SCHEMA_UNSUPPORTED', 'Workbook parsed successfully but no mappable cabinet rows were found.', 400, {
      sourceWorkbook: path.basename(sourceWorkbook),
    });
  }

  return records;
}

export function discoverWorkbookSchema(buffer: Buffer) {
  let wb: xlsx.WorkBook;
  try {
    wb = xlsx.read(buffer, { type: 'buffer' });
  } catch {
    throw new ApiServiceError('CORRUPT_WORKBOOK', 'Workbook file is corrupt or unreadable.', 400);
  }
  if (!wb.SheetNames.length) {
    throw new ApiServiceError('CORRUPT_WORKBOOK', 'Workbook has no sheets.', 400);
  }
  return wb.SheetNames.map((sheetName, sheetIndex) => {
    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    let formulaCellCount = 0;
    Object.keys(sheet).forEach((cellKey) => {
      if (cellKey.startsWith('!')) {
        return;
      }
      const cell = sheet[cellKey] as xlsx.CellObject | undefined;
      if (cell?.f) {
        formulaCellCount += 1;
      }
    });

    const hidden = (wb.Workbook?.Sheets?.[sheetIndex]?.Hidden ?? 0) > 0;

    return {
      sheetName,
      columns,
      rowCount: rows.length,
      hidden,
      formulaCellCount,
    };
  });
}
