import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabasesForTests, getDatabase } from '@/lib/autobidder/db/database';
import { createExportArtifact, listExportArtifacts, readExportArtifact } from '@/lib/autobidder/services/export-artifact-service';
import { makeExportInput } from './export-test-fixture';

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'export-artifact-'));
  process.env.AUTOBIDDER_DATABASE_PATH = path.join(directory, 'test.sqlite');
  process.env.AUTOBIDDER_DATA_DIR = directory;
});

afterEach(() => {
  closeDatabasesForTests();
  delete process.env.AUTOBIDDER_DATABASE_PATH;
  delete process.env.AUTOBIDDER_DATA_DIR;
  rmSync(directory, { recursive: true, force: true });
});

function insertFixture(safeToSend = false) {
  const fixture = makeExportInput({ safeToSend, audience: safeToSend ? 'customer' : 'internal_review' });
  const db = getDatabase();
  db.prepare(`INSERT INTO projects (id, organization_id, name, status, currency, version, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`).run(
    fixture.project.id, fixture.project.organizationId, fixture.project.name, fixture.project.currency,
    fixture.project.version, JSON.stringify(fixture.project), fixture.project.createdAt, fixture.project.updatedAt,
  );
  db.prepare(`INSERT INTO bid_jobs (id, project_id, workflow_state, version, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    fixture.bidJob.id, fixture.project.id, fixture.bidJob.state, fixture.bidJob.version,
    JSON.stringify(fixture.bidJob), fixture.bidJob.createdAt, fixture.bidJob.updatedAt,
  );
  for (const item of fixture.sourceDocuments) db.prepare(`INSERT INTO source_documents
    (id, project_id, original_path, storage_key, file_name, mime_type, byte_size, sha256, outcome, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`).run(
    item.id, item.projectId, item.originalPath, item.storageKey, item.fileName, item.mimeType, item.byteSize,
    item.sha256, item.ingestionOutcome, item.createdAt,
  );
  for (const item of fixture.planSheets) db.prepare(`INSERT INTO plan_sheets
    (id, source_document_id, page_number, sheet_number, title, classification, review_required, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    item.id, item.sourceDocumentId, item.pageNumber, item.sheetNumber || null, item.title || null,
    item.classification || 'cabinet', item.reviewRequired ? 1 : 0, JSON.stringify(item),
  );
  for (const item of fixture.evidence) db.prepare(`INSERT INTO vision_evidence
    (id, project_id, plan_sheet_id, kind, region_json, text_content, confidence, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    item.id, item.projectId, item.planSheetId, item.kind, item.region ? JSON.stringify(item.region) : null,
    item.text || null, item.confidence || null, JSON.stringify(item), item.createdAt,
  );
  for (const item of fixture.unitTypes) db.prepare(`INSERT INTO unit_types
    (id, project_id, code, name, accessibility, aliases_json) VALUES (?, ?, ?, ?, ?, ?)`).run(
    item.id, item.projectId, item.code, item.name, item.accessibility, JSON.stringify(item.aliases),
  );
  for (const item of fixture.unitMixEntries) db.prepare(`INSERT INTO unit_mix_entries
    (id, project_id, unit_type_id, extracted_count, verified_count, status, discrepancy, evidence_ids_json, approved_by, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    item.id, item.projectId, item.unitTypeId, item.extractedCount, item.verifiedCount ?? null, item.status,
    item.discrepancy || null, JSON.stringify(item.evidenceIds), item.approvedBy || null, item.approvedAt || null,
  );
  for (const item of fixture.cabinetInstances) db.prepare(`INSERT INTO cabinet_instances
    (id, project_id, unit_type_id, room, category, quantity_per_unit, status, evidence_ids_json, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    item.id, item.projectId, item.unitTypeId, item.room, item.category, item.quantityPerUnit, item.status,
    JSON.stringify(item.evidenceIds), JSON.stringify(item),
  );
  for (const item of fixture.takeoffLines) db.prepare(`INSERT INTO takeoff_lines
    (id, bid_job_id, cabinet_instance_id, unit_type_id, quantity_per_unit, status, evidence_ids_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    item.id, item.bidJobId, item.cabinetInstanceId, item.unitTypeId, item.quantityPerUnit, item.status, JSON.stringify(item.evidenceIds),
  );
  db.prepare(`INSERT INTO catalog_workbooks (id, project_id, file_name, sha256, authoritative, ingested_at)
    VALUES ('workbook-1', ?, 'pricing.xlsx', 'workbook-sha', 1, ?)`).run(fixture.project.id, fixture.createdAt);
  for (const item of fixture.catalogSkus) db.prepare(`INSERT INTO catalog_skus
    (id, workbook_id, sku, cabinet_code, source_worksheet, source_row, unit_cost_cents, sell_price_cents, raw_values_json, payload_json, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    item.id, item.workbookId, item.sku, item.cabinetCode, item.sourceWorksheet, item.sourceRow,
    item.unitCostCents ?? null, item.sellPriceCents ?? null, JSON.stringify(item.rawValues), JSON.stringify(item), item.active ? 1 : 0,
  );
  for (const item of fixture.skuMappings) db.prepare(`INSERT INTO sku_mappings
    (id, takeoff_line_id, catalog_sku_id, outcome, match_method, confidence, normalization_rule_id, approved_by, approved_at, resolution_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    item.id, item.takeoffLineId, item.catalogSkuId || null, item.outcome, item.matchMethod, item.confidence ?? null,
    item.normalizationRuleId || null, item.approvedBy || null, item.approvedAt || null, item.resolutionNote || null,
  );
  for (const item of fixture.estimateLines) db.prepare(`INSERT INTO estimate_lines
    (id, bid_job_id, mapping_id, unit_mix_entry_id, category, description, project_quantity, unit_cost_cents, extended_cost_cents, currency, calculation_version, evidence_ids_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    item.id, item.bidJobId, item.mappingId || null, item.unitMixEntryId || null, item.category, item.description,
    item.projectQuantity, item.unitCostCents, item.extendedCostCents, item.currency, item.calculationVersion, JSON.stringify(item.evidenceIds),
  );
  db.prepare(`INSERT INTO qa_results
    (id, bid_job_id, safe_to_send, issues_json, reconciliation_json, reviewer_requirements_json, calculation_version, executed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    fixture.qaResult.id, fixture.qaResult.bidJobId, fixture.qaResult.safeToSend ? 1 : 0, JSON.stringify(fixture.qaResult.issues),
    JSON.stringify(fixture.qaResult.reconciliation), JSON.stringify(fixture.qaResult.reviewerRequirements),
    fixture.qaResult.calculationVersion, fixture.qaResult.executedAt,
  );
  for (const item of fixture.approvals) db.prepare(`INSERT INTO approvals
    (id, project_id, bid_job_id, type, target_type, target_id, decision, note, actor_id, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    item.id, item.projectId, item.bidJobId, item.type, item.targetType, item.targetId, item.decision,
    item.note || null, item.actorId, item.occurredAt,
  );
  return fixture;
}

describe('durable export artifacts', () => {
  it('creates, hashes, lists, and reads an immutable internal JSON artifact', async () => {
    const fixture = insertFixture(false);
    const artifact = await createExportArtifact(fixture.bidJob.id, 'reviewer-1', 'json', 'internal_review');
    expect(artifact).toMatchObject({ status: 'ready', format: 'json', audience: 'internal_review' });
    expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(listExportArtifacts(fixture.bidJob.id)).toHaveLength(1);
    const downloaded = await readExportArtifact(artifact.id);
    expect(JSON.parse(downloaded.bytes.toString('utf8'))).toMatchObject({
      schemaVersion: 'cabinet-export-snapshot/v1', snapshotId: artifact.snapshotId,
      totals: { grandTotalCents: 250000 },
    });
  });

  it('creates a real PDF for internal review and blocks unsafe customer export', async () => {
    const fixture = insertFixture(false);
    const pdf = await createExportArtifact(fixture.bidJob.id, 'reviewer-1', 'review_pdf', 'internal_review');
    expect((await readExportArtifact(pdf.id)).bytes.subarray(0, 5).toString()).toBe('%PDF-');
    await expect(createExportArtifact(fixture.bidJob.id, 'reviewer-1', 'xlsx', 'customer'))
      .rejects.toMatchObject({ code: 'EXPORT_STATE_BLOCKED' });
  });
});
