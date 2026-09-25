import 'server-only';

import type { CabinetExportSnapshotV1 } from './contracts';
import { stableJsonStringify } from './json';

export type CsvScalar = string | number | boolean | null | undefined;

export interface ExportCsvRecord {
  record_type: string;
  record_id: string;
  parent_id?: string;
  status?: string;
  unit_type_id?: string;
  description?: string;
  quantity_per_unit?: number;
  verified_unit_count?: number;
  project_quantity?: number;
  sku?: string;
  unit_cost_cents?: number;
  extended_cost_cents?: number;
  currency?: string;
  source_document_id?: string;
  page_number?: number;
  sheet_number?: string;
  source_workbook?: string;
  source_worksheet?: string;
  source_row?: number;
  evidence_ids?: string;
  details_json: string;
}

export const CSV_COLUMNS: ReadonlyArray<keyof ExportCsvRecord> = [
  'record_type',
  'record_id',
  'parent_id',
  'status',
  'unit_type_id',
  'description',
  'quantity_per_unit',
  'verified_unit_count',
  'project_quantity',
  'sku',
  'unit_cost_cents',
  'extended_cost_cents',
  'currency',
  'source_document_id',
  'page_number',
  'sheet_number',
  'source_workbook',
  'source_worksheet',
  'source_row',
  'evidence_ids',
  'details_json',
];

export function neutralizeSpreadsheetFormula(value: string): string {
  return /^(?:[\t\r]|\s*[=+\-@])/.test(value) ? `'${value}` : value;
}

export function escapeCsvCell(value: CsvScalar): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('CSV cannot serialize non-finite numbers.');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const safe = neutralizeSpreadsheetFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function details(value: unknown): string {
  return stableJsonStringify(value, 0);
}

export function buildExportCsvRecords(snapshot: CabinetExportSnapshotV1): ExportCsvRecord[] {
  const rows: ExportCsvRecord[] = [
    {
      record_type: 'project',
      record_id: snapshot.project.id,
      status: snapshot.bidJob.state,
      description: snapshot.project.name,
      currency: snapshot.project.currency,
      details_json: details(snapshot.project),
    },
    {
      record_type: 'qa_result',
      record_id: snapshot.qaResult.id,
      parent_id: snapshot.bidJob.id,
      status: snapshot.qaResult.safeToSend ? 'safe_to_send' : 'unsafe_to_send',
      details_json: details(snapshot.qaResult),
    },
  ];

  for (const entry of snapshot.entities.unitMixEntries) {
    rows.push({
      record_type: 'unit_mix',
      record_id: entry.id,
      parent_id: snapshot.project.id,
      status: entry.status,
      unit_type_id: entry.unitTypeId,
      verified_unit_count: entry.verifiedCount,
      evidence_ids: entry.evidenceIds.join('|'),
      details_json: details(entry),
    });
  }
  for (const line of snapshot.entities.takeoffLines) {
    rows.push({
      record_type: 'takeoff',
      record_id: line.id,
      parent_id: line.cabinetInstanceId,
      status: line.status,
      unit_type_id: line.unitTypeId,
      quantity_per_unit: line.quantityPerUnit,
      evidence_ids: line.evidenceIds.join('|'),
      details_json: details(line),
    });
  }
  const skuById = new Map(snapshot.entities.catalogSkus.map((sku) => [sku.id, sku]));
  for (const mapping of snapshot.entities.skuMappings) {
    const sku = mapping.catalogSkuId ? skuById.get(mapping.catalogSkuId) : undefined;
    rows.push({
      record_type: 'sku_mapping',
      record_id: mapping.id,
      parent_id: mapping.takeoffLineId,
      status: mapping.outcome,
      sku: sku?.sku,
      unit_cost_cents: sku?.unitCostCents,
      source_workbook: sku?.sourceWorkbook,
      source_worksheet: sku?.sourceWorksheet,
      source_row: sku?.sourceRow,
      details_json: details(mapping),
    });
  }
  for (const line of snapshot.entities.estimateLines) {
    rows.push({
      record_type: 'estimate_line',
      record_id: line.id,
      parent_id: line.mappingId,
      status: line.category,
      description: line.description,
      quantity_per_unit: line.quantityPerUnit,
      verified_unit_count: line.verifiedUnitCount,
      project_quantity: line.projectQuantity,
      unit_cost_cents: line.unitCostCents,
      extended_cost_cents: line.extendedCostCents,
      currency: line.currency,
      evidence_ids: line.evidenceIds.join('|'),
      details_json: details(line),
    });
  }
  for (const evidence of snapshot.entities.evidence) {
    const sheet = snapshot.entities.planSheets.find((candidate) => candidate.id === evidence.planSheetId);
    rows.push({
      record_type: 'evidence',
      record_id: evidence.id,
      parent_id: evidence.planSheetId,
      status: evidence.kind,
      description: evidence.text,
      source_document_id: sheet?.sourceDocumentId,
      page_number: sheet?.pageNumber,
      sheet_number: sheet?.sheetNumber,
      details_json: details(evidence),
    });
  }
  for (const issue of snapshot.qaResult.issues) {
    rows.push({
      record_type: 'qa_issue',
      record_id: issue.id,
      parent_id: snapshot.qaResult.id,
      status: `${issue.severity}:${issue.resolved ? 'resolved' : 'open'}`,
      description: issue.message,
      evidence_ids: issue.evidenceIds.join('|'),
      details_json: details(issue),
    });
  }
  for (const approval of snapshot.approvals) {
    rows.push({
      record_type: 'approval',
      record_id: approval.id,
      parent_id: approval.targetId,
      status: `${approval.type}:${approval.decision}`,
      description: approval.note,
      details_json: details(approval),
    });
  }
  snapshot.assumptions.forEach((assumption, index) => {
    rows.push({
      record_type: 'assumption',
      record_id: `${snapshot.snapshotId}:assumption:${index + 1}`,
      description: assumption,
      details_json: details({ assumption }),
    });
  });
  for (const trace of snapshot.provenance) {
    rows.push({
      record_type: 'provenance',
      record_id: `${snapshot.snapshotId}:provenance:${trace.estimateLineId}`,
      parent_id: trace.estimateLineId,
      status: trace.complete ? 'complete' : 'incomplete',
      source_workbook: trace.workbookSource?.workbook,
      source_worksheet: trace.workbookSource?.worksheet,
      source_row: trace.workbookSource?.row,
      evidence_ids: trace.evidence.map((item) => item.evidenceId).join('|'),
      details_json: details(trace),
    });
  }
  return rows;
}

export function serializeExportCsv(snapshot: CabinetExportSnapshotV1): Buffer {
  const lines = [
    CSV_COLUMNS.join(','),
    ...buildExportCsvRecords(snapshot).map((row) => CSV_COLUMNS.map((column) => escapeCsvCell(row[column])).join(',')),
  ];
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
}
