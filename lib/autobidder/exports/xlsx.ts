import 'server-only';

import * as XLSX from 'xlsx';
import type { CabinetExportSnapshotV1 } from './contracts';
import { neutralizeSpreadsheetFormula } from './csv';
import { stableJsonStringify } from './json';

type SheetRow = Record<string, string | number | boolean | undefined>;

function safeValue(value: unknown): string | number | boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return neutralizeSpreadsheetFormula(value);
  return neutralizeSpreadsheetFormula(stableJsonStringify(value, 0));
}

function safeRows(rows: readonly Record<string, unknown>[]): SheetRow[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, safeValue(value)])));
}

function appendSheet(workbook: XLSX.WorkBook, name: string, rows: readonly Record<string, unknown>[]): void {
  const sheet = XLSX.utils.json_to_sheet(safeRows(rows.length ? rows : [{ status: 'No records' }]));
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

export function serializeExportXlsx(snapshot: CabinetExportSnapshotV1): Buffer {
  const workbook = XLSX.utils.book_new();
  const unitTypeById = new Map(snapshot.entities.unitTypes.map((unitType) => [unitType.id, unitType]));
  const cabinetById = new Map(snapshot.entities.cabinetInstances.map((cabinet) => [cabinet.id, cabinet]));
  const skuById = new Map(snapshot.entities.catalogSkus.map((sku) => [sku.id, sku]));

  appendSheet(workbook, 'Summary', [
    {
      snapshot_id: snapshot.snapshotId,
      schema_version: snapshot.schemaVersion,
      audience: snapshot.audience,
      generated_at: snapshot.createdAt,
      generated_by: snapshot.createdBy,
      project_id: snapshot.project.id,
      project_name: snapshot.project.name,
      workflow_state: snapshot.bidJob.state,
      qa_safe_to_send: snapshot.qaResult.safeToSend,
      currency: snapshot.totals.currency,
      estimate_line_count: snapshot.totals.lineCount,
      project_quantity: snapshot.totals.projectQuantity,
      grand_total_cents: snapshot.totals.grandTotalCents,
      warnings: snapshot.warnings.join(' | '),
    },
  ]);
  appendSheet(
    workbook,
    'Unit Mix',
    snapshot.entities.unitMixEntries.map((entry) => ({
      id: entry.id,
      unit_type_id: entry.unitTypeId,
      unit_type_code: unitTypeById.get(entry.unitTypeId)?.code,
      extracted_count: entry.extractedCount,
      verified_count: entry.verifiedCount,
      status: entry.status,
      approved_by: entry.approvedBy,
      approved_at: entry.approvedAt,
      discrepancy: entry.discrepancy,
      resolution_note: entry.resolutionNote,
      evidence_ids: entry.evidenceIds.join('|'),
    })),
  );
  appendSheet(
    workbook,
    'Takeoff',
    snapshot.entities.takeoffLines.map((line) => {
      const cabinet = cabinetById.get(line.cabinetInstanceId);
      return {
        id: line.id,
        cabinet_instance_id: line.cabinetInstanceId,
        unit_type_id: line.unitTypeId,
        room: cabinet?.room,
        category: cabinet?.category,
        interpreted_code: cabinet?.interpretedCode,
        quantity_per_unit: line.quantityPerUnit,
        status: line.status,
        ada: cabinet?.ada,
        evidence_ids: line.evidenceIds.join('|'),
      };
    }),
  );
  appendSheet(
    workbook,
    'SKU Mapping',
    snapshot.entities.skuMappings.map((mapping) => {
      const sku = mapping.catalogSkuId ? skuById.get(mapping.catalogSkuId) : undefined;
      return {
        id: mapping.id,
        takeoff_line_id: mapping.takeoffLineId,
        outcome: mapping.outcome,
        match_method: mapping.matchMethod,
        confidence: mapping.confidence,
        sku: sku?.sku,
        description: sku?.description,
        unit_cost_cents: sku?.unitCostCents,
        source_workbook: sku?.sourceWorkbook,
        source_worksheet: sku?.sourceWorksheet,
        source_row: sku?.sourceRow,
        approved_by: mapping.approvedBy,
        approved_at: mapping.approvedAt,
        resolution_note: mapping.resolutionNote,
      };
    }),
  );
  appendSheet(
    workbook,
    'Estimate',
    snapshot.entities.estimateLines.map((line) => ({
      id: line.id,
      category: line.category,
      description: line.description,
      mapping_id: line.mappingId,
      unit_mix_entry_id: line.unitMixEntryId,
      quantity_per_unit: line.quantityPerUnit,
      verified_unit_count: line.verifiedUnitCount,
      project_quantity: line.projectQuantity,
      unit_cost_cents: line.unitCostCents,
      extended_cost_cents: line.extendedCostCents,
      currency: line.currency,
      calculation_version: line.calculationVersion,
      evidence_ids: line.evidenceIds.join('|'),
    })),
  );
  appendSheet(
    workbook,
    'QA',
    snapshot.qaResult.issues.map((issue) => ({
      id: issue.id,
      code: issue.code,
      severity: issue.severity,
      resolved: issue.resolved,
      message: issue.message,
      entity_type: issue.entityType,
      entity_id: issue.entityId,
      evidence_ids: issue.evidenceIds.join('|'),
    })),
  );
  appendSheet(
    workbook,
    'Evidence',
    snapshot.entities.evidence.map((evidence) => ({
      id: evidence.id,
      kind: evidence.kind,
      plan_sheet_id: evidence.planSheetId,
      text: evidence.text,
      confidence: evidence.confidence,
      region: evidence.region,
      provider: evidence.extractionProvider,
      model: evidence.extractionModel,
      created_at: evidence.createdAt,
    })),
  );
  appendSheet(
    workbook,
    'Approvals',
    snapshot.approvals.map((approval) => ({
      id: approval.id,
      type: approval.type,
      target_type: approval.targetType,
      target_id: approval.targetId,
      decision: approval.decision,
      note: approval.note,
      actor_id: approval.actorId,
      occurred_at: approval.occurredAt,
    })),
  );
  appendSheet(workbook, 'Assumptions', snapshot.assumptions.map((assumption) => ({ assumption })));
  appendSheet(
    workbook,
    'Provenance',
    snapshot.provenance.map((trace) => ({
      estimate_line_id: trace.estimateLineId,
      mapping_id: trace.mappingId,
      takeoff_line_id: trace.takeoffLineId,
      cabinet_instance_id: trace.cabinetInstanceId,
      unit_mix_entry_id: trace.unitMixEntryId,
      catalog_sku_id: trace.catalogSkuId,
      source_workbook: trace.workbookSource?.workbook,
      source_worksheet: trace.workbookSource?.worksheet,
      source_row: trace.workbookSource?.row,
      evidence_ids: trace.evidence.map((item) => item.evidenceId).join('|'),
      complete: trace.complete,
      missing: trace.missing.join('|'),
    })),
  );

  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }));
}
