import 'server-only';

import { randomUUID } from 'node:crypto';
import { getDatabase } from '@/lib/autobidder/db/database';
import type { CabinetVisionAnalysis } from './cabinet-vision-provider';

export function persistCabinetVisionAnalysis(input: {
  projectId: string;
  planSheetId: string;
  analysis: CabinetVisionAnalysis;
}) {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`DELETE FROM vision_evidence WHERE plan_sheet_id=? AND payload_json LIKE '%"agent":"cabinet_vision"%'`).run(input.planSheetId);
  const insert = db.prepare(`INSERT INTO vision_evidence
    (id, project_id, plan_sheet_id, kind, region_json, text_content, confidence, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const shared = { agent: 'cabinet_vision', provider: input.analysis.provider, model: input.analysis.model, mode: input.analysis.mode };
  insert.run(randomUUID(), input.projectId, input.planSheetId, 'classification', JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
    input.analysis.classificationEvidence, input.analysis.classificationConfidence,
    JSON.stringify({ ...shared, classification: input.analysis.classification }), now);
  for (const unit of input.analysis.unitTypes) {
    insert.run(randomUUID(), input.projectId, input.planSheetId, 'unit_mix', JSON.stringify(unit.region), unit.evidence, unit.confidence,
      JSON.stringify({ ...shared, agentCandidate: 'unit_type', ...unit }), now);
  }
  for (const cabinet of input.analysis.cabinets) {
    insert.run(randomUUID(), input.projectId, input.planSheetId, 'cabinet', JSON.stringify(cabinet.region), cabinet.evidence, cabinet.confidence,
      JSON.stringify({ ...shared, agentCandidate: 'cabinet', ...cabinet }), now);
    if (cabinet.widthInches !== undefined || cabinet.heightInches !== undefined || cabinet.depthInches !== undefined) {
      insert.run(randomUUID(), input.projectId, input.planSheetId, 'dimension', JSON.stringify(cabinet.region),
        `Visible dimensions: ${[cabinet.widthInches, cabinet.heightInches, cabinet.depthInches].map((value) => value ?? '—').join(' × ')}`,
        cabinet.confidence, JSON.stringify({ ...shared, agentCandidate: 'dimension', unitCode: cabinet.unitCode,
          widthInches: cabinet.widthInches, heightInches: cabinet.heightInches, depthInches: cabinet.depthInches }), now);
    }
  }
  return { classificationEvidence: 1, unitCandidates: input.analysis.unitTypes.length, cabinetCandidates: input.analysis.cabinets.length };
}
