import 'server-only';

import { randomUUID } from 'node:crypto';
import { createCanvas, loadImage } from 'canvas';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Principal, VisionEvidence } from '@/types/canonical';
import { ApiServiceError } from '@/lib/autobidder/api/errors';
import { getDatabase, withTransaction } from '@/lib/autobidder/db/database';
import { writeBinary } from '@/lib/autobidder/storage/file-store';
import { dataRootPath } from '@/lib/autobidder/storage/file-store';

export type MeasurementKind = 'distance' | 'polyline' | 'area';
export type MeasurementUnit = 'in' | 'ft' | 'mm' | 'cm' | 'm';

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface MeasurementGeometry {
  points: NormalizedPoint[];
}

export interface MeasurementCalibration {
  points: [NormalizedPoint, NormalizedPoint];
  knownDistance: number;
  unit: MeasurementUnit;
}

export interface MeasurementRecord {
  id: string;
  projectId: string;
  planSheetId: string;
  kind: MeasurementKind;
  geometry: MeasurementGeometry;
  calibration: MeasurementCalibration;
  value?: number;
  unit: MeasurementUnit;
  printedDimensionOverride: false;
  createdBy: string;
  createdAt: string;
}

export interface EvidenceSnippetRecord {
  id: string;
  projectId: string;
  planSheetId: string;
  region: { x: number; y: number; width: number; height: number };
  scale?: number;
  annotations: Array<{ type: string; text?: string; points?: NormalizedPoint[] }>;
  title: string;
  storageKey?: string;
  takeoffLineId?: string;
  qaIssueId?: string;
  createdBy: string;
  createdAt: string;
}

type SheetAccessRow = {
  id: string;
  project_id: string;
  organization_id: string;
  render_storage_key: string | null;
  payload_json: string;
};

type MeasurementRow = {
  id: string;
  project_id: string;
  plan_sheet_id: string;
  kind: string;
  geometry_json: string;
  calibration_json: string | null;
  value: number | null;
  unit: string | null;
  printed_dimension_override: number;
  created_by: string;
  created_at: string;
};

type SnippetRow = {
  id: string;
  project_id: string;
  plan_sheet_id: string;
  region_json: string;
  scale: number | null;
  annotations_json: string;
  title: string;
  storage_key: string | null;
  takeoff_line_id: string | null;
  qa_issue_id: string | null;
  created_by: string;
  created_at: string;
};

function sheetAccess(planSheetId: string, principal: Principal): SheetAccessRow {
  const row = getDatabase()
    .prepare(
      `SELECT ps.id, sd.project_id, p.organization_id, ps.render_storage_key, ps.payload_json
       FROM plan_sheets ps
       JOIN source_documents sd ON sd.id = ps.source_document_id
       JOIN projects p ON p.id = sd.project_id
       WHERE ps.id = ?`,
    )
    .get(planSheetId) as SheetAccessRow | undefined;
  if (!row) throw new ApiServiceError('PLAN_SHEET_NOT_FOUND', 'Plan sheet not found.', 404, { planSheetId });
  if (row.organization_id !== principal.organizationId) {
    throw new ApiServiceError('FORBIDDEN', 'Plan sheet belongs to another organization.', 403);
  }
  return row;
}

function projectAccess(projectId: string, principal: Principal): void {
  const row = getDatabase().prepare('SELECT organization_id FROM projects WHERE id = ?').get(projectId) as
    | { organization_id: string }
    | undefined;
  if (!row) throw new ApiServiceError('PROJECT_NOT_FOUND', 'Project not found.', 404, { projectId });
  if (row.organization_id !== principal.organizationId) {
    throw new ApiServiceError('FORBIDDEN', 'Project belongs to another organization.', 403);
  }
}

function point(value: unknown, field: string): NormalizedPoint {
  if (!value || typeof value !== 'object') throw new ApiServiceError('VALIDATION_ERROR', `${field} must be a point.`, 400);
  const candidate = value as Record<string, unknown>;
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    throw new ApiServiceError('VALIDATION_ERROR', `${field} coordinates must be between 0 and 1.`, 400);
  }
  return { x, y };
}

function geometry(value: unknown, kind: MeasurementKind): MeasurementGeometry {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { points?: unknown }).points)) {
    throw new ApiServiceError('VALIDATION_ERROR', 'Measurement geometry requires normalized points.', 400);
  }
  const points = (value as { points: unknown[] }).points.map((item, index) => point(item, `geometry.points[${index}]`));
  const minimum = kind === 'area' ? 3 : 2;
  if (points.length < minimum || (kind === 'distance' && points.length !== 2)) {
    throw new ApiServiceError('VALIDATION_ERROR', `${kind} geometry requires ${kind === 'distance' ? 'exactly 2' : `at least ${minimum}`} points.`, 400);
  }
  return { points };
}

const measurementUnits = new Set<MeasurementUnit>(['in', 'ft', 'mm', 'cm', 'm']);

function calibration(value: unknown): MeasurementCalibration {
  if (!value || typeof value !== 'object') {
    throw new ApiServiceError('VALIDATION_ERROR', 'A two-point calibration is required.', 400);
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.points) || candidate.points.length !== 2) {
    throw new ApiServiceError('VALIDATION_ERROR', 'Calibration requires exactly two normalized points.', 400);
  }
  const knownDistance = Number(candidate.knownDistance);
  const unit = candidate.unit as MeasurementUnit;
  if (!Number.isFinite(knownDistance) || knownDistance <= 0 || !measurementUnits.has(unit)) {
    throw new ApiServiceError('VALIDATION_ERROR', 'Calibration distance and unit are invalid.', 400);
  }
  const points = [point(candidate.points[0], 'calibration.points[0]'), point(candidate.points[1], 'calibration.points[1]')] as [
    NormalizedPoint,
    NormalizedPoint,
  ];
  if (points[0].x === points[1].x && points[0].y === points[1].y) {
    throw new ApiServiceError('VALIDATION_ERROR', 'Calibration points must be distinct.', 400);
  }
  return { points, knownDistance, unit };
}

function renderDimensions(sheet: SheetAccessRow): { width: number; height: number } {
  try {
    const payload = JSON.parse(sheet.payload_json) as { renderWidthPx?: unknown; renderHeightPx?: unknown };
    const width = Number(payload.renderWidthPx);
    const height = Number(payload.renderHeightPx);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) return { width, height };
  } catch {
    // Legacy rows may predate raster metadata. Unit dimensions retain normalized-space behavior.
  }
  return { width: 1, height: 1 };
}

function measurementValue(
  kind: MeasurementKind,
  shape: MeasurementGeometry,
  scale: MeasurementCalibration,
  dimensions: { width: number; height: number },
): number {
  const segmentLength = (a: NormalizedPoint, b: NormalizedPoint) =>
    Math.hypot((b.x - a.x) * dimensions.width, (b.y - a.y) * dimensions.height);
  const calibrationLength = segmentLength(scale.points[0], scale.points[1]);
  if (kind === 'area') {
    const twiceArea = shape.points.reduce((sum, current, index) => {
      const next = shape.points[(index + 1) % shape.points.length];
      return sum + current.x * dimensions.width * next.y * dimensions.height - next.x * dimensions.width * current.y * dimensions.height;
    }, 0);
    return (Math.abs(twiceArea) / 2 / calibrationLength ** 2) * scale.knownDistance ** 2;
  }
  const length = shape.points.slice(1).reduce((sum, current, index) => sum + segmentLength(shape.points[index], current), 0);
  return (length / calibrationLength) * scale.knownDistance;
}

function mapMeasurement(row: MeasurementRow): MeasurementRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    planSheetId: row.plan_sheet_id,
    kind: row.kind as MeasurementKind,
    geometry: JSON.parse(row.geometry_json),
    calibration: JSON.parse(row.calibration_json || '{}'),
    value: row.value === null ? undefined : row.value,
    unit: row.unit as MeasurementUnit,
    printedDimensionOverride: false,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function audit(principal: Principal, projectId: string, action: string, resourceType: string, resourceId: string, after?: unknown) {
  getDatabase()
    .prepare(
      `INSERT INTO audit_events
       (id, organization_id, project_id, actor_id, actor_kind, action, resource_type, resource_id, after_json, outcome, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?)`,
    )
    .run(
      randomUUID(),
      principal.organizationId,
      projectId,
      principal.id,
      principal.kind,
      action,
      resourceType,
      resourceId,
      after === undefined ? null : JSON.stringify(after),
      new Date().toISOString(),
    );
}

export function createMeasurement(
  principal: Principal,
  input: {
    projectId: string;
    planSheetId: string;
    kind: MeasurementKind;
    geometry: unknown;
    calibration: unknown;
    printedDimensionOverride?: boolean;
  },
): MeasurementRecord {
  if (!new Set<MeasurementKind>(['distance', 'polyline', 'area']).has(input.kind)) {
    throw new ApiServiceError('VALIDATION_ERROR', 'Unsupported measurement kind.', 400);
  }
  projectAccess(input.projectId, principal);
  const sheet = sheetAccess(input.planSheetId, principal);
  if (sheet.project_id !== input.projectId) {
    throw new ApiServiceError('PROJECT_SHEET_MISMATCH', 'Plan sheet is not part of the requested project.', 409);
  }
  const shape = geometry(input.geometry, input.kind);
  const scale = calibration(input.calibration);
  const record: MeasurementRecord = {
    id: randomUUID(),
    projectId: input.projectId,
    planSheetId: input.planSheetId,
    kind: input.kind,
    geometry: shape,
    calibration: scale,
    value: measurementValue(input.kind, shape, scale, renderDimensions(sheet)),
    unit: scale.unit,
    printedDimensionOverride: false,
    createdBy: principal.id,
    createdAt: new Date().toISOString(),
  };
  withTransaction((db) => {
    db.prepare(
      `INSERT INTO measurements
       (id, project_id, plan_sheet_id, kind, geometry_json, calibration_json, value, unit,
        printed_dimension_override, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      record.id,
      record.projectId,
      record.planSheetId,
      record.kind,
      JSON.stringify(record.geometry),
      JSON.stringify(record.calibration),
      record.value ?? null,
      record.unit,
      record.createdBy,
      record.createdAt,
    );
    audit(principal, record.projectId, 'measurement.created', 'measurement', record.id, record);
  });
  return record;
}

export function listMeasurements(principal: Principal, projectId: string, planSheetId?: string): MeasurementRecord[] {
  projectAccess(projectId, principal);
  if (planSheetId) {
    const sheet = sheetAccess(planSheetId, principal);
    if (sheet.project_id !== projectId) throw new ApiServiceError('PROJECT_SHEET_MISMATCH', 'Plan sheet is not part of the project.', 409);
  }
  const rows = (planSheetId
    ? getDatabase().prepare('SELECT * FROM measurements WHERE project_id = ? AND plan_sheet_id = ? ORDER BY created_at').all(projectId, planSheetId)
    : getDatabase().prepare('SELECT * FROM measurements WHERE project_id = ? ORDER BY created_at').all(projectId)) as MeasurementRow[];
  return rows.map(mapMeasurement);
}

export function deleteMeasurement(principal: Principal, measurementId: string): void {
  const row = getDatabase()
    .prepare(
      `SELECT m.project_id, p.organization_id FROM measurements m
       JOIN projects p ON p.id = m.project_id WHERE m.id = ?`,
    )
    .get(measurementId) as { project_id: string; organization_id: string } | undefined;
  if (!row) throw new ApiServiceError('MEASUREMENT_NOT_FOUND', 'Measurement not found.', 404, { measurementId });
  if (row.organization_id !== principal.organizationId) throw new ApiServiceError('FORBIDDEN', 'Measurement belongs to another organization.', 403);
  withTransaction((db) => {
    db.prepare('DELETE FROM measurements WHERE id = ?').run(measurementId);
    audit(principal, row.project_id, 'measurement.deleted', 'measurement', measurementId);
  });
}

function normalizedRegion(value: unknown): EvidenceSnippetRecord['region'] {
  if (!value || typeof value !== 'object') throw new ApiServiceError('VALIDATION_ERROR', 'Snippet region is required.', 400);
  const candidate = value as Record<string, unknown>;
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  if ([x, y, width, height].some((item) => !Number.isFinite(item)) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    throw new ApiServiceError('VALIDATION_ERROR', 'Snippet region must be a positive normalized rectangle within the sheet.', 400);
  }
  return { x, y, width, height };
}

function validateSnippetTarget(projectId: string, takeoffLineId?: string, qaIssueId?: string): void {
  if (Boolean(takeoffLineId) === Boolean(qaIssueId)) {
    throw new ApiServiceError('VALIDATION_ERROR', 'A snippet must link to exactly one takeoff line or QA issue.', 400);
  }
  if (takeoffLineId) {
    const row = getDatabase()
      .prepare(
        `SELECT bj.project_id FROM takeoff_lines tl JOIN bid_jobs bj ON bj.id = tl.bid_job_id WHERE tl.id = ?`,
      )
      .get(takeoffLineId) as { project_id: string } | undefined;
    if (!row) throw new ApiServiceError('TAKEOFF_LINE_NOT_FOUND', 'Takeoff line not found.', 404, { takeoffLineId });
    if (row.project_id !== projectId) throw new ApiServiceError('PROJECT_TARGET_MISMATCH', 'Takeoff line belongs to another project.', 409);
    return;
  }
  const rows = getDatabase()
    .prepare(
      `SELECT qr.issues_json FROM qa_results qr JOIN bid_jobs bj ON bj.id = qr.bid_job_id WHERE bj.project_id = ?`,
    )
    .all(projectId) as Array<{ issues_json: string }>;
  const exists = rows.some((row) => {
    try {
      const issues = JSON.parse(row.issues_json) as Array<{ id?: string }>;
      return issues.some((issue) => issue.id === qaIssueId);
    } catch {
      return false;
    }
  });
  if (!exists) throw new ApiServiceError('QA_ISSUE_NOT_FOUND', 'QA issue not found for this project.', 404, { qaIssueId });
}

function annotations(value: unknown): EvidenceSnippetRecord['annotations'] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new ApiServiceError('VALIDATION_ERROR', 'Snippet annotations must be an array.', 400);
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new ApiServiceError('VALIDATION_ERROR', `annotations[${index}] is invalid.`, 400);
    const candidate = item as Record<string, unknown>;
    const type = typeof candidate.type === 'string' ? candidate.type.trim() : '';
    if (!type || type.length > 40) throw new ApiServiceError('VALIDATION_ERROR', `annotations[${index}].type is invalid.`, 400);
    const text = candidate.text === undefined ? undefined : String(candidate.text).trim();
    if (text && text.length > 500) throw new ApiServiceError('VALIDATION_ERROR', `annotations[${index}].text is too long.`, 400);
    const points = candidate.points === undefined
      ? undefined
      : Array.isArray(candidate.points)
        ? candidate.points.map((entry, pointIndex) => point(entry, `annotations[${index}].points[${pointIndex}]`))
        : (() => { throw new ApiServiceError('VALIDATION_ERROR', `annotations[${index}].points is invalid.`, 400); })();
    return { type, ...(text ? { text } : {}), ...(points ? { points } : {}) };
  });
}

function mapSnippet(row: SnippetRow): EvidenceSnippetRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    planSheetId: row.plan_sheet_id,
    region: JSON.parse(row.region_json),
    scale: row.scale === null ? undefined : row.scale,
    annotations: JSON.parse(row.annotations_json),
    title: row.title,
    storageKey: row.storage_key || undefined,
    takeoffLineId: row.takeoff_line_id || undefined,
    qaIssueId: row.qa_issue_id || undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function createEvidenceSnippet(
  principal: Principal,
  input: {
    projectId: string;
    planSheetId: string;
    region: unknown;
    scale?: number;
    annotations?: unknown;
    title: string;
    storageKey?: string;
    takeoffLineId?: string;
    qaIssueId?: string;
  },
): EvidenceSnippetRecord {
  projectAccess(input.projectId, principal);
  const sheet = sheetAccess(input.planSheetId, principal);
  if (sheet.project_id !== input.projectId) throw new ApiServiceError('PROJECT_SHEET_MISMATCH', 'Plan sheet is not part of the project.', 409);
  validateSnippetTarget(input.projectId, input.takeoffLineId, input.qaIssueId);
  const title = input.title?.trim();
  if (!title || title.length > 160) throw new ApiServiceError('VALIDATION_ERROR', 'Snippet title is required and must be at most 160 characters.', 400);
  if (input.scale !== undefined && (!Number.isFinite(input.scale) || input.scale <= 0 || input.scale > 20)) {
    throw new ApiServiceError('VALIDATION_ERROR', 'Snippet scale must be greater than zero and at most 20.', 400);
  }
  const record: EvidenceSnippetRecord = {
    id: randomUUID(),
    projectId: input.projectId,
    planSheetId: input.planSheetId,
    region: normalizedRegion(input.region),
    scale: input.scale,
    annotations: annotations(input.annotations),
    title,
    storageKey: input.storageKey?.trim() || undefined,
    takeoffLineId: input.takeoffLineId,
    qaIssueId: input.qaIssueId,
    createdBy: principal.id,
    createdAt: new Date().toISOString(),
  };
  withTransaction((db) => {
    db.prepare(
      `INSERT INTO evidence_snippets
       (id, project_id, plan_sheet_id, region_json, scale, annotations_json, title, storage_key,
        takeoff_line_id, qa_issue_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id,
      record.projectId,
      record.planSheetId,
      JSON.stringify(record.region),
      record.scale ?? null,
      JSON.stringify(record.annotations),
      record.title,
      record.storageKey ?? null,
      record.takeoffLineId ?? null,
      record.qaIssueId ?? null,
      record.createdBy,
      record.createdAt,
    );
    audit(principal, record.projectId, 'evidence_snippet.created', 'evidence_snippet', record.id, record);
  });
  return record;
}

export async function captureEvidenceSnippet(
  principal: Principal,
  input: Parameters<typeof createEvidenceSnippet>[1],
): Promise<EvidenceSnippetRecord> {
  const crop = normalizedRegion(input.region);
  const source = await readPlanSheetImage(principal, input.planSheetId);
  const image = await loadImage(source.bytes);
  const sourceX = Math.floor(crop.x * image.width);
  const sourceY = Math.floor(crop.y * image.height);
  const sourceWidth = Math.max(1, Math.ceil(crop.width * image.width));
  const sourceHeight = Math.max(1, Math.ceil(crop.height * image.height));
  const canvas = createCanvas(sourceWidth, sourceHeight);
  const context = canvas.getContext('2d');
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  const marks = annotations(input.annotations);
  for (const mark of marks) {
    const local = (mark.points || []).map((point) => ({
      x: (point.x - crop.x) / crop.width * sourceWidth,
      y: (point.y - crop.y) / crop.height * sourceHeight,
    }));
    context.save();
    context.lineWidth = Math.max(2, sourceWidth / 350);
    context.strokeStyle = mark.type === 'highlighter' ? 'rgba(255, 214, 10, .55)' : '#f97316';
    context.fillStyle = '#f97316';
    if (mark.type === 'text' || mark.type === 'count') {
      const anchor = local[0] || { x: 12, y: 24 };
      context.font = `bold ${Math.max(14, Math.round(sourceWidth / 40))}px sans-serif`;
      context.fillText(mark.text || mark.type, anchor.x, anchor.y);
    } else if (local.length) {
      context.beginPath(); context.moveTo(local[0].x, local[0].y);
      for (const point of local.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
    context.restore();
  }
  const storageKey = `snippets/${input.projectId}/${input.planSheetId}/${randomUUID()}.png`;
  await writeBinary(storageKey, canvas.toBuffer('image/png'));
  return createEvidenceSnippet(principal, { ...input, region: crop, annotations: marks, storageKey });
}

export function createVisionEvidence(
  principal: Principal,
  input: {
    projectId: string;
    planSheetId: string;
    kind: VisionEvidence['kind'];
    region?: unknown;
    text?: string;
    confidence?: number;
  },
): VisionEvidence {
  projectAccess(input.projectId, principal);
  const sheet = sheetAccess(input.planSheetId, principal);
  if (sheet.project_id !== input.projectId) throw new ApiServiceError('PROJECT_SHEET_MISMATCH', 'Plan sheet is not part of the project.', 409);
  const allowed = new Set<VisionEvidence['kind']>(['classification', 'cabinet', 'unit_mix', 'dimension', 'note', 'measurement', 'snippet']);
  if (!allowed.has(input.kind)) throw new ApiServiceError('VALIDATION_ERROR', 'Unsupported evidence kind.', 400);
  const region = input.region === undefined ? undefined : normalizedRegion(input.region);
  const text = input.text?.trim();
  if (!region && !text) throw new ApiServiceError('VALIDATION_ERROR', 'Evidence requires a normalized region or source text.', 400);
  if (text && text.length > 4000) throw new ApiServiceError('VALIDATION_ERROR', 'Evidence text is too long.', 400);
  if (input.confidence !== undefined && (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)) {
    throw new ApiServiceError('VALIDATION_ERROR', 'Evidence confidence must be between 0 and 1.', 400);
  }
  const record: VisionEvidence = {
    id: randomUUID(), projectId: input.projectId, planSheetId: input.planSheetId, kind: input.kind,
    region, text, confidence: input.confidence, extractionProvider: 'human-review', extractionModel: 'visual-evidence-v1',
    createdAt: new Date().toISOString(),
  };
  withTransaction((db) => {
    db.prepare(`INSERT INTO vision_evidence
      (id, project_id, plan_sheet_id, kind, region_json, text_content, confidence, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      record.id, record.projectId, record.planSheetId, record.kind, record.region ? JSON.stringify(record.region) : null,
      record.text ?? null, record.confidence ?? null,
      JSON.stringify({ extractionProvider: record.extractionProvider, extractionModel: record.extractionModel }), record.createdAt,
    );
    audit(principal, record.projectId, 'vision_evidence.created', 'vision_evidence', record.id, record);
  });
  return record;
}

export function listVisionEvidence(principal: Principal, projectId: string, planSheetId?: string): VisionEvidence[] {
  projectAccess(projectId, principal);
  if (planSheetId) {
    const sheet = sheetAccess(planSheetId, principal);
    if (sheet.project_id !== projectId) throw new ApiServiceError('PROJECT_SHEET_MISMATCH', 'Plan sheet is not part of the project.', 409);
  }
  const rows = (planSheetId
    ? getDatabase().prepare('SELECT * FROM vision_evidence WHERE project_id = ? AND plan_sheet_id = ? ORDER BY created_at').all(projectId, planSheetId)
    : getDatabase().prepare('SELECT * FROM vision_evidence WHERE project_id = ? ORDER BY created_at').all(projectId)) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const payload = JSON.parse(String(row.payload_json || '{}')) as Partial<VisionEvidence>;
    return {
      id: String(row.id), projectId: String(row.project_id), planSheetId: String(row.plan_sheet_id), kind: row.kind as VisionEvidence['kind'],
      region: row.region_json ? JSON.parse(String(row.region_json)) : undefined, text: row.text_content ? String(row.text_content) : undefined,
      confidence: row.confidence === null ? undefined : Number(row.confidence), extractionProvider: payload.extractionProvider,
      extractionModel: payload.extractionModel, createdAt: String(row.created_at),
    };
  });
}

const planClassifications = new Set([
  'UNIT_PLAN', 'FLOOR_PLAN', 'KITCHEN_ELEVATION', 'BATH_ELEVATION', 'INTERIOR_ELEVATION',
  'CASEWORK_SCHEDULE', 'FINISH_SCHEDULE', 'UNIT_MATRIX', 'ACCESSIBILITY', 'DETAIL',
  'APPLIANCE_SCHEDULE', 'IRRELEVANT', 'UNKNOWN',
  'COVER', 'INDEX', 'GENERAL',
]);

export function reviewPlanSheetClassification(principal: Principal, planSheetId: string, classification: string, note: string) {
  const sheet = sheetAccess(planSheetId, principal);
  const normalized = classification.trim().toUpperCase();
  if (!planClassifications.has(normalized)) throw new ApiServiceError('VALIDATION_ERROR', 'Unsupported plan classification.', 400);
  if (!note?.trim()) throw new ApiServiceError('REVIEW_NOTE_REQUIRED', 'Classification review requires a note.', 400);
  const before = getDatabase().prepare('SELECT classification, classification_confidence, review_required FROM plan_sheets WHERE id=?').get(planSheetId);
  withTransaction((db) => {
    db.prepare('UPDATE plan_sheets SET classification=?, classification_confidence=1, review_required=0 WHERE id=?').run(normalized, planSheetId);
    audit(principal, sheet.project_id, 'plan_sheet.classification_reviewed', 'plan_sheet', planSheetId, { before, classification: normalized, note: note.trim() });
  });
  return { id: planSheetId, classification: normalized, classificationConfidence: 1, reviewRequired: false, reviewedBy: principal.id };
}

export function listEvidenceSnippets(principal: Principal, projectId: string, planSheetId?: string): EvidenceSnippetRecord[] {
  projectAccess(projectId, principal);
  if (planSheetId) {
    const sheet = sheetAccess(planSheetId, principal);
    if (sheet.project_id !== projectId) throw new ApiServiceError('PROJECT_SHEET_MISMATCH', 'Plan sheet is not part of the project.', 409);
  }
  const rows = (planSheetId
    ? getDatabase().prepare('SELECT * FROM evidence_snippets WHERE project_id = ? AND plan_sheet_id = ? ORDER BY created_at').all(projectId, planSheetId)
    : getDatabase().prepare('SELECT * FROM evidence_snippets WHERE project_id = ? ORDER BY created_at').all(projectId)) as SnippetRow[];
  return rows.map(mapSnippet);
}

export async function readPlanSheetImage(
  principal: Principal,
  planSheetId: string,
): Promise<{ bytes: Buffer; mimeType: 'image/jpeg' | 'image/png'; storageKey: string }> {
  const sheet = sheetAccess(planSheetId, principal);
  const storageKey = sheet.render_storage_key;
  if (!storageKey) throw new ApiServiceError('RENDER_NOT_AVAILABLE', 'This plan sheet has no rendered image.', 404, { planSheetId });
  if (storageKey.includes('\0') || path.isAbsolute(storageKey)) {
    throw new ApiServiceError('INVALID_RENDER_PATH', 'Stored render path is invalid.', 422);
  }
  const normalized = storageKey.replaceAll('\\', '/');
  if (!normalized.startsWith('renders/')) throw new ApiServiceError('INVALID_RENDER_PATH', 'Stored render must be under the renders directory.', 422);
  const root = path.resolve(dataRootPath());
  const candidate = path.resolve(root, normalized);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
    throw new ApiServiceError('INVALID_RENDER_PATH', 'Stored render path escapes the data directory.', 422);
  }
  const extension = path.extname(candidate).toLowerCase();
  const mimeType = extension === '.png' ? 'image/png' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : null;
  if (!mimeType) throw new ApiServiceError('INVALID_RENDER_TYPE', 'Stored render is not a supported image.', 422);
  try {
    const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
    if (realCandidate === realRoot || !realCandidate.startsWith(`${realRoot}${path.sep}`)) {
      throw new ApiServiceError('INVALID_RENDER_PATH', 'Stored render resolves outside the data directory.', 422);
    }
    return { bytes: await readFile(realCandidate), mimeType, storageKey: normalized };
  } catch (error) {
    if (error instanceof ApiServiceError) throw error;
    throw new ApiServiceError('RENDER_NOT_AVAILABLE', 'Rendered page image could not be read.', 404, { planSheetId });
  }
}
