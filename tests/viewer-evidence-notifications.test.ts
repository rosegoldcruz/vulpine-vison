import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Principal } from '@/types/canonical';
import { closeDatabasesForTests, getDatabase } from '@/lib/autobidder/db/database';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import {
  createEvidenceSnippet,
  createMeasurement,
  deleteMeasurement,
  listEvidenceSnippets,
  listMeasurements,
  readPlanSheetImage,
} from '@/lib/autobidder/services/viewer-evidence-service';
import {
  createNotification,
  listNotifications,
  updateNotificationState,
} from '@/lib/autobidder/services/notification-service';
import { GET as getPlanImage } from '@/app/api/plan-sheets/[id]/image/route';
import {
  GET as getMeasurements,
  POST as postMeasurement,
} from '@/app/api/projects/[id]/measurements/route';
import { GET as getNotifications } from '@/app/api/notifications/route';
import { PATCH as patchNotification } from '@/app/api/notifications/[id]/route';

let directory = '';
let dataDirectory = '';
let projectId = '';
let jobId = '';

const principal: Principal = {
  id: 'estimator-1',
  kind: 'user',
  displayName: 'Estimator One',
  role: 'admin',
  organizationId: 'local',
  scopes: [],
};

const otherPrincipal: Principal = {
  ...principal,
  id: 'estimator-2',
  displayName: 'Estimator Two',
};

beforeAll(async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'viewer-evidence-'));
  dataDirectory = path.join(directory, 'data');
  process.env.AUTOBIDDER_DATABASE_PATH = path.join(directory, 'test.sqlite');
  process.env.AUTOBIDDER_DATA_DIR = dataDirectory;

  const project = await new ProjectRepository().create('Viewer Fixture');
  const job = await new BidJobRepository().create(project);
  projectId = project.projectId;
  jobId = job.id;
  const now = new Date().toISOString();
  const db = getDatabase();
  db.prepare(
    `INSERT INTO source_documents
     (id, project_id, original_path, storage_key, file_name, mime_type, byte_size, sha256, outcome, created_at)
     VALUES ('document-1', ?, 'plan.pdf', 'uploads/plan.pdf', 'plan.pdf', 'application/pdf', 100, 'abc', 'accepted', ?)`,
  ).run(projectId, now);
  db.prepare(
    `INSERT INTO plan_sheets
     (id, source_document_id, page_number, render_storage_key, payload_json)
     VALUES ('sheet-1', 'document-1', 1, ?, '{"renderWidthPx":1200,"renderHeightPx":800}')`,
  ).run(`renders/${projectId}/document-1/page-1.png`);
  db.prepare(
    `INSERT INTO plan_sheets
     (id, source_document_id, page_number, render_storage_key, payload_json)
     VALUES ('sheet-traversal', 'document-1', 2, '../outside.png', '{}')`,
  ).run();
  db.prepare(
    `INSERT INTO plan_sheets
     (id, source_document_id, page_number, render_storage_key, payload_json)
     VALUES ('sheet-symlink', 'document-1', 3, ?, '{}')`,
  ).run(`renders/${projectId}/document-1/escape.png`);
  db.prepare("INSERT INTO unit_types (id, project_id, code, name, accessibility) VALUES ('unit-1', ?, 'A1', 'A1', 'standard')").run(projectId);
  db.prepare(
    `INSERT INTO cabinet_instances
     (id, project_id, unit_type_id, room, category, quantity_per_unit, status)
     VALUES ('cabinet-1', ?, 'unit-1', 'Kitchen', 'base', 1, 'approved')`,
  ).run(projectId);
  db.prepare(
    `INSERT INTO takeoff_lines
     (id, bid_job_id, cabinet_instance_id, unit_type_id, quantity_per_unit, status)
     VALUES ('takeoff-1', ?, 'cabinet-1', 'unit-1', 1, 'approved')`,
  ).run(jobId);
  db.prepare(
    `INSERT INTO qa_results
     (id, bid_job_id, safe_to_send, issues_json, reconciliation_json, reviewer_requirements_json,
      calculation_version, executed_at)
     VALUES ('qa-1', ?, 0, ?, '{}', '[]', 'test-v1', ?)`,
  ).run(jobId, JSON.stringify([{ id: 'qa-issue-1', code: 'MISSING_EVIDENCE' }]), now);

  const renderDirectory = path.join(dataDirectory, 'renders', projectId, 'document-1');
  mkdirSync(renderDirectory, { recursive: true });
  writeFileSync(path.join(renderDirectory, 'page-1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  writeFileSync(path.join(directory, 'outside.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]));
  symlinkSync(path.join(directory, 'outside.png'), path.join(renderDirectory, 'escape.png'));
});

afterAll(() => {
  closeDatabasesForTests();
  delete process.env.AUTOBIDDER_DATABASE_PATH;
  delete process.env.AUTOBIDDER_DATA_DIR;
  rmSync(directory, { recursive: true, force: true });
});

describe('page image access', () => {
  it('reads only an organization-owned render contained by the data root', async () => {
    const image = await readPlanSheetImage(principal, 'sheet-1');
    expect(image.mimeType).toBe('image/png');
    expect(image.bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await expect(readPlanSheetImage(principal, 'sheet-traversal')).rejects.toMatchObject({ code: 'INVALID_RENDER_PATH', status: 422 });
    await expect(readPlanSheetImage(principal, 'sheet-symlink')).rejects.toMatchObject({ code: 'INVALID_RENDER_PATH', status: 422 });
    await expect(
      readPlanSheetImage({ ...principal, organizationId: 'another-organization' }, 'sheet-1'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
});

describe('measurement persistence', () => {
  it('persists normalized geometry/calibration while refusing printed-dimension authority', () => {
    const measurement = createMeasurement(principal, {
      projectId,
      planSheetId: 'sheet-1',
      kind: 'distance',
      geometry: { points: [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.2 }] },
      calibration: { points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }], knownDistance: 12, unit: 'in' },
      printedDimensionOverride: true,
    });

    expect(measurement.printedDimensionOverride).toBe(false);
    expect(measurement.value).toBeCloseTo(24);
    expect(listMeasurements(principal, projectId, 'sheet-1')).toContainEqual(measurement);
    const persisted = getDatabase().prepare('SELECT printed_dimension_override FROM measurements WHERE id = ?').get(measurement.id) as {
      printed_dimension_override: number;
    };
    expect(persisted.printed_dimension_override).toBe(0);

    deleteMeasurement(principal, measurement.id);
    expect(listMeasurements(principal, projectId)).toEqual([]);
  });

  it('rejects non-normalized or degenerate geometry', () => {
    expect(() =>
      createMeasurement(principal, {
        projectId,
        planSheetId: 'sheet-1',
        kind: 'distance',
        geometry: { points: [{ x: -1, y: 0 }, { x: 0.5, y: 0.2 }] },
        calibration: { points: [{ x: 0, y: 0 }, { x: 0.2, y: 0 }], knownDistance: 12, unit: 'in' },
      }),
    ).toThrowError(/between 0 and 1/);
  });
});

describe('evidence snippet persistence', () => {
  it('links snippets to an owned sheet and exactly one takeoff or QA target', () => {
    const takeoffSnippet = createEvidenceSnippet(principal, {
      projectId,
      planSheetId: 'sheet-1',
      title: 'Kitchen base cabinet callout',
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
      scale: 2,
      annotations: [{ type: 'label', text: 'B24', points: [{ x: 0.2, y: 0.3 }] }],
      takeoffLineId: 'takeoff-1',
    });
    const qaSnippet = createEvidenceSnippet(principal, {
      projectId,
      planSheetId: 'sheet-1',
      title: 'Missing dimension evidence',
      region: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
      qaIssueId: 'qa-issue-1',
    });

    expect(listEvidenceSnippets(principal, projectId, 'sheet-1')).toEqual([takeoffSnippet, qaSnippet]);
    expect(() =>
      createEvidenceSnippet(principal, {
        projectId,
        planSheetId: 'sheet-1',
        title: 'Unlinked',
        region: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
      }),
    ).toThrowError(/exactly one/);
  });
});

describe('principal-scoped notifications', () => {
  it('persists internal deep links and independently supports read and dismiss', () => {
    const created = createNotification({
      principalId: principal.id,
      projectId,
      bidJobId: jobId,
      type: 'qa.blocked',
      severity: 'critical',
      title: 'QA review required',
      body: 'One critical issue is unresolved.',
      targetPath: `/projects/${projectId}/jobs/${jobId}?panel=qa&issue=qa-issue-1`,
    });
    createNotification({
      principalId: otherPrincipal.id,
      type: 'run.complete',
      severity: 'success',
      title: 'Other user notification',
      body: 'This is private to another principal.',
      targetPath: '/projects',
    });

    expect(listNotifications(principal)).toEqual([created]);
    const read = updateNotificationState(principal, created.id, 'read', '2026-09-25T10:00:00.000Z');
    expect(read.readAt).toBe('2026-09-25T10:00:00.000Z');
    expect(listNotifications(principal, { unreadOnly: true })).toEqual([]);
    const dismissed = updateNotificationState(principal, created.id, 'dismiss', '2026-09-25T10:01:00.000Z');
    expect(dismissed.dismissedAt).toBe('2026-09-25T10:01:00.000Z');
    expect(listNotifications(principal)).toEqual([]);
    expect(listNotifications(principal, { includeDismissed: true })).toHaveLength(1);
    expect(() => updateNotificationState(otherPrincipal, created.id, 'read')).toThrowError(/not found/i);
  });

  it('rejects external notification targets', () => {
    expect(() =>
      createNotification({
        principalId: principal.id,
        type: 'unsafe-link',
        severity: 'warning',
        title: 'Unsafe',
        body: 'Unsafe external target.',
        targetPath: 'https://example.com',
      }),
    ).toThrowError(/application-relative/);
  });
});

describe('viewer and notification API routes', () => {
  it('serves a contained sheet image with explicit safe content headers', async () => {
    const response = await getPlanImage(new Request('http://localhost/api/plan-sheets/sheet-1/image'), {
      params: Promise.resolve({ id: 'sheet-1' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('creates and lists measurements through authenticated project routes', async () => {
    const createResponse = await postMeasurement(
      new Request(`http://localhost/api/projects/${projectId}/measurements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planSheetId: 'sheet-1',
          kind: 'polyline',
          geometry: { points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }] },
          calibration: { points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }], knownDistance: 12, unit: 'in' },
          printedDimensionOverride: true,
        }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created.data.measurement.printedDimensionOverride).toBe(false);

    const listResponse = await getMeasurements(
      new Request(`http://localhost/api/projects/${projectId}/measurements?planSheetId=sheet-1`),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).data.measurements).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.data.measurement.id, printedDimensionOverride: false })]),
    );
  });

  it('lists and updates only the authenticated principal notification', async () => {
    const notification = createNotification({
      principalId: 'local-development-user',
      projectId,
      bidJobId: jobId,
      type: 'run.stalled',
      severity: 'warning',
      title: 'Processing needs attention',
      body: 'No progress was recorded within the configured threshold.',
      targetPath: `/projects/${projectId}/jobs/${jobId}?panel=diagnostics`,
    });
    const listResponse = await getNotifications(new Request('http://localhost/api/notifications?unreadOnly=true'));
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).data.notifications).toEqual([
      expect.objectContaining({ id: notification.id, targetPath: notification.targetPath }),
    ]);

    const patchResponse = await patchNotification(
      new Request(`http://localhost/api/notifications/${notification.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read' }),
      }),
      { params: Promise.resolve({ id: notification.id }) },
    );
    expect(patchResponse.status).toBe(200);
    expect((await patchResponse.json()).data.notification.readAt).toBeTruthy();
  });
});
