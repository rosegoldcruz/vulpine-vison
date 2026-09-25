import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabasesForTests, getDatabase } from '@/lib/autobidder/db/database';
import {
  approveCanonicalQa,
  approveCanonicalNormalization,
  approveCanonicalTakeoff,
  compileCanonicalEstimate,
  getCanonicalBidSnapshot,
  getCanonicalProvenance,
  ingestCanonicalCatalog,
  mapCanonicalSkus,
  materializeCabinetVisionDraft,
  recordCanonicalTakeoff,
  recordCanonicalVisualExtraction,
  recordCanonicalUnitMix,
  runCanonicalQa,
  verifyCanonicalUnitMix,
} from '@/lib/autobidder/services/canonical-bid-service';
import type { Principal } from '@/types/canonical';
import { GET as getCanonicalRoute } from '@/app/api/jobs/[id]/canonical/route';
import { issueSession } from '@/lib/autobidder/auth/session';
import { createOutreachDraft, syncApprovedDealFromBid } from '@/lib/backoffice/service';

const timestamp = '2026-09-25T12:00:00.000Z';
const principal: Principal = {
  id: 'reviewer-1',
  kind: 'user',
  displayName: 'Review Lead',
  role: 'admin',
  organizationId: 'org-1',
  scopes: [],
};

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'canonical-bid-service-'));
  process.env.AUTOBIDDER_DATABASE_PATH = path.join(directory, 'test.sqlite');
  process.env.AUTOBIDDER_SESSION_SECRET = 'canonical-test-secret-that-is-longer-than-32-characters';
});

afterEach(() => {
  closeDatabasesForTests();
  delete process.env.AUTOBIDDER_DATABASE_PATH;
  delete process.env.AUTOBIDDER_SESSION_SECRET;
  rmSync(directory, { recursive: true, force: true });
});

function seedProject() {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO projects
     (id, organization_id, name, status, currency, version, payload_json, created_at, updated_at)
     VALUES ('project-1', 'org-1', 'Canonical Fixture', 'processing', 'USD', 1, '{}', ?, ?)`,
  ).run(timestamp, timestamp);
  db.prepare(
    `INSERT INTO bid_jobs
     (id, project_id, workflow_state, version, payload_json, created_at, updated_at)
     VALUES ('job-1', 'project-1', 'source_files_ingested', 1, '{}', ?, ?)`,
  ).run(timestamp, timestamp);
  db.prepare(
    `INSERT INTO source_documents
     (id, project_id, original_path, storage_key, file_name, mime_type, byte_size, sha256, outcome, payload_json, created_at)
     VALUES ('document-1', 'project-1', 'plans/a.pdf', 'documents/a.pdf', 'a.pdf', 'application/pdf', 100, 'plan-sha', 'accepted', '{}', ?)`,
  ).run(timestamp);
  db.prepare(
    `INSERT INTO plan_sheets
     (id, source_document_id, page_number, sheet_number, title, classification, review_required, payload_json)
     VALUES ('sheet-1', 'document-1', 1, 'A-401', 'Kitchen Elevations', 'cabinet_elevation', 0, '{"rotation":0}')`,
  ).run();
  const evidence = db.prepare(
    `INSERT INTO vision_evidence
     (id, project_id, plan_sheet_id, kind, region_json, text_content, confidence, payload_json, created_at)
     VALUES (?, 'project-1', 'sheet-1', ?, '{"x":0.1,"y":0.2,"width":0.3,"height":0.2}', ?, 0.99, '{}', ?)`,
  );
  evidence.run('evidence-cabinet', 'cabinet', 'W30', timestamp);
  evidence.run('evidence-unit', 'unit_mix', 'A1: 2 units', timestamp);
  db.prepare(
    `INSERT INTO unit_types (id, project_id, code, name, accessibility, aliases_json)
     VALUES ('unit-a', 'project-1', 'A1', 'Unit A1', 'standard', '[]')`,
  ).run();
}

function ingestCatalogAndAdvance() {
  const result = ingestCanonicalCatalog('job-1', {
    fileName: 'authoritative-pricing.xlsx',
    sha256: 'catalog-sha',
    rows: [{
      sku: 'SKU-W30', cabinetCode: 'W30', description: 'Wall Cabinet 30', sourceWorksheet: 'Cabinets',
      sourceRow: 42, widthInches: 30, heightInches: 30, depthInches: 12, unitCostCents: 1250,
      rawValues: { SKU: 'SKU-W30', Code: 'W30', Cost: 12.5 },
    }],
  }, principal);
  expect(result.job.state).toBe('workbook_ingested');
  // Classification and extraction are earlier pipeline concerns; this fixture begins this service's takeoff scope after them.
  getDatabase().prepare(`UPDATE bid_jobs SET workflow_state = 'cabinet_pages_extracted' WHERE id = 'job-1'`).run();
}

function recordAndApproveTakeoff(code = 'W30') {
  const draft = recordCanonicalTakeoff('job-1', { cabinets: [{
    unitTypeId: 'unit-a', room: 'Kitchen', category: 'wall', interpretedCode: code,
    widthInches: 30, heightInches: 30, depthInches: 12, quantityPerUnit: 1,
    evidenceIds: ['evidence-cabinet'],
  }] }, principal);
  expect(draft.job.state).toBe('cabinet_takeoff_draft');
  approveCanonicalTakeoff('job-1', draft.takeoffLines.map((line) => line.id), 'Reviewed against A-401.', principal);
}

function recordAndVerifyUnitMix() {
  const draft = recordCanonicalUnitMix('job-1', { entries: [{
    unitTypeId: 'unit-a', code: 'A1', name: 'Unit A1', accessibility: 'standard',
    extractedCount: 2, evidenceIds: ['evidence-unit'],
  }] }, principal);
  const verified = verifyCanonicalUnitMix('job-1', draft.entries.map((entry) => ({ entryId: entry.id, verifiedCount: 2 })), principal);
  expect(verified.job.state).toBe('sku_mapping_required');
}

describe('canonical bid persistence pipeline', () => {
  it('persists verified counts, authoritative mappings, deterministic estimates, clean QA, approval, and complete provenance', async () => {
    seedProject();
    ingestCatalogAndAdvance();
    recordAndApproveTakeoff();
    recordAndVerifyUnitMix();

    const mapped = mapCanonicalSkus('job-1', principal);
    expect(mapped.unresolvedCount).toBe(0);
    expect(mapped.job.state).toBe('pricing_mapping_required');

    const compiled = compileCanonicalEstimate('job-1', principal);
    expect(compiled.grandTotalCents).toBe(2500);
    expect(compiled.lines[0]).toMatchObject({ projectQuantity: 2, unitCostCents: 1250, extendedCostCents: 2500 });
    expect(compiled.job.state).toBe('cabinet_bid_review_required');

    const checked = runCanonicalQa('job-1', principal);
    expect(checked.qa.safeToSend).toBe(true);
    expect(checked.job.state).toBe('cabinet_bid_review_required');
    const approved = approveCanonicalQa('job-1', checked.qa.id, 'Independent final review complete.', principal);
    expect(approved.job.state).toBe('cabinet_bid_safe_to_send');
    const deal = syncApprovedDealFromBid({ projectId: 'project-1', jobId: 'job-1', companyName: 'Fixture Customer' }, principal);
    expect(deal.bidAmount).toEqual({ amountCents: 2500, currency: 'USD' });
    const outreach = createOutreachDraft('project-1', { recipient: 'buyer@example.com', scope: 'Cabinet package', estimatorSignature: 'Review Lead' }, principal.id);
    expect(outreach.body).toContain('Approved bid amount: $25.00');

    const snapshot = getCanonicalBidSnapshot('job-1', principal);
    expect(snapshot.unitMixEntries[0]).toMatchObject({ verifiedCount: 2, approvedBy: 'reviewer-1', status: 'verified' });
    expect(snapshot.approvals.map((item) => item.type)).toEqual(expect.arrayContaining(['unit_mix', 'qa']));
    expect(snapshot.auditEvents.map((item) => item.action)).toEqual(expect.arrayContaining([
      'takeoff.approved', 'unit_mix.verified', 'sku_mapping.compiled', 'estimate.compiled', 'qa.executed', 'qa.approved',
    ]));
    expect(snapshot.job.stateHistory.filter((item) => item.accepted).map((item) => item.to)).toEqual(expect.arrayContaining([
      'workbook_ingested', 'cabinet_takeoff_draft', 'unit_mix_required', 'unit_mix_verified', 'sku_mapping_required',
      'pricing_mapping_required', 'cabinet_bid_review_required', 'cabinet_bid_safe_to_send',
    ]));

    const provenance = getCanonicalProvenance('job-1', principal);
    expect(provenance).toHaveLength(1);
    expect(provenance[0]).toMatchObject({ complete: true, workbookSource: { workbook: 'authoritative-pricing.xlsx', worksheet: 'Cabinets', row: 42 } });

    const response = await getCanonicalRoute(new Request('http://localhost/api/jobs/job-1/canonical', { headers: { cookie: `vulpine_session=${issueSession(principal)}` } }), { params: Promise.resolve({ id: 'job-1' }) });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.job.state).toBe('cabinet_bid_safe_to_send');
  });

  it('fails closed when no exact mapping exists, then permits an actor-approved normalization without client pricing', () => {
    seedProject();
    ingestCatalogAndAdvance();
    recordAndApproveTakeoff('W33');
    recordAndVerifyUnitMix();

    const mapped = mapCanonicalSkus('job-1', principal);
    expect(mapped.unresolvedCount).toBe(1);
    expect(mapped.mappings[0]).toMatchObject({ outcome: 'unresolved', matchMethod: 'no_permitted_match' });
    expect(mapped.job.state).toBe('sku_mapping_required');
    expect(() => compileCanonicalEstimate('job-1', principal)).toThrowError(/not allowed while the job is sku_mapping_required/i);
    expect(getCanonicalBidSnapshot('job-1', principal).estimateLines).toHaveLength(0);

    const snapshot = getCanonicalBidSnapshot('job-1', principal);
    const normalized = approveCanonicalNormalization(
      'job-1',
      snapshot.takeoffLines[0].id,
      snapshot.catalogSkus[0].id,
      'W33 is an approved project-specific normalization to the W30 catalog row.',
      principal,
    );
    expect(normalized.mapping).toMatchObject({ outcome: 'normalized_match', approvedBy: 'reviewer-1' });
    expect(normalized.job.state).toBe('pricing_mapping_required');
    expect(compileCanonicalEstimate('job-1', principal).grandTotalCents).toBe(2500);
  });

  it('creates unit types only from reviewed visual evidence before takeoff', () => {
    seedProject();
    ingestCanonicalCatalog('job-1', {
      fileName: 'authoritative-pricing.xlsx', sha256: 'catalog-sha',
      rows: [{ sku: 'SKU-W30', cabinetCode: 'W30', sourceWorksheet: 'Cabinets', sourceRow: 2, unitCostCents: 1250 }],
    }, principal);
    getDatabase().prepare(`DELETE FROM unit_types WHERE project_id='project-1'`).run();
    getDatabase().prepare(`UPDATE bid_jobs SET workflow_state='cabinet_pages_classified' WHERE id='job-1'`).run();
    const extracted = recordCanonicalVisualExtraction('job-1', { unitTypes: [{
      code: 'A1', name: 'Unit A1', accessibility: 'standard', evidenceIds: ['evidence-unit'],
    }] }, principal);
    expect(extracted.job.state).toBe('cabinet_pages_extracted');
    expect(extracted.unitTypes).toMatchObject([{ code: 'A1', name: 'Unit A1' }]);
    expect(getCanonicalBidSnapshot('job-1', principal).auditEvents[0].action).toBe('visual_extraction.reviewed');
  });

  it('materializes only high-confidence provider candidates as review-required takeoff and unit-mix drafts', () => {
    seedProject();
    getDatabase().prepare(`DELETE FROM unit_types WHERE project_id='project-1'`).run();
    getDatabase().prepare(`UPDATE bid_jobs SET workflow_state='cabinet_pages_classified' WHERE id='job-1'`).run();
    const insert = getDatabase().prepare(`INSERT INTO vision_evidence
      (id, project_id, plan_sheet_id, kind, region_json, text_content, confidence, payload_json, created_at)
      VALUES (?, 'project-1', 'sheet-1', ?, '{"x":0.1,"y":0.1,"width":0.2,"height":0.2}', ?, ?, ?, ?)`);
    insert.run('agent-unit', 'unit_mix', 'Unit A1 count 8', .92, JSON.stringify({ agent: 'cabinet_vision', provider: 'fixture', model: 'v1', agentCandidate: 'unit_type', code: 'A1', name: 'Unit A1', accessibility: 'standard', aliases: [], projectCount: 8 }), timestamp);
    insert.run('agent-cabinet', 'cabinet', 'B24 at kitchen elevation', .9, JSON.stringify({ agent: 'cabinet_vision', provider: 'fixture', model: 'v1', agentCandidate: 'cabinet', unitCode: 'A1', room: 'Kitchen', category: 'base', interpretedCode: 'B24', quantityPerUnit: 1, ada: false }), timestamp);
    const service: Principal = { id: 'vision-worker', kind: 'service', displayName: 'Vision worker', role: 'service', organizationId: 'org-1', scopes: [] };
    const result = materializeCabinetVisionDraft('job-1', service);
    expect(result).toMatchObject({ materialized: true, job: { state: 'cabinet_takeoff_draft' } });
    expect(getCanonicalBidSnapshot('job-1', principal).takeoffLines[0]).toMatchObject({ status: 'unresolved', evidenceIds: ['agent-cabinet'] });
    expect(getCanonicalBidSnapshot('job-1', principal).unitMixEntries[0]).toMatchObject({ extractedCount: 8, status: 'unverified', evidenceIds: ['agent-unit'] });
    const approved = approveCanonicalTakeoff('job-1', getCanonicalBidSnapshot('job-1', principal).takeoffLines.map((line) => line.id), 'Reviewed generated draft.', principal);
    expect(approved.job.state).toBe('unit_mix_required');
  });
});
