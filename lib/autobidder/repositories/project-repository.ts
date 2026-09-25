import 'server-only';
import { randomUUID } from 'crypto';
import type { ProjectManifest } from '@/types';
import { getDatabase } from '@/lib/autobidder/db/database';

type ProjectRow = { payload_json: string };

function parseProject(row: ProjectRow | undefined): ProjectManifest | null {
  if (!row) return null;
  return JSON.parse(row.payload_json) as ProjectManifest;
}

export class ProjectRepository {
  async create(projectName: string, organizationId = 'local'): Promise<ProjectManifest> {
    const projectId = randomUUID();
    const now = new Date().toISOString();
    const manifest: ProjectManifest = {
      projectId,
      projectName,
      files: [],
      pdfFiles: [],
      workbookFiles: [],
      pageCount: 0,
      createdAt: now,
      processingStatus: 'created',
    };
    getDatabase()
      .prepare(
        `INSERT INTO projects
          (id, organization_id, name, status, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(projectId, organizationId, projectName, manifest.processingStatus, JSON.stringify(manifest), now, now);
    return manifest;
  }

  async get(projectId: string, organizationId?: string): Promise<ProjectManifest | null> {
    const row = getDatabase().prepare(`SELECT payload_json FROM projects WHERE id = ?${organizationId ? ' AND organization_id = ?' : ''}`).get(...(organizationId ? [projectId, organizationId] : [projectId])) as
      | ProjectRow
      | undefined;
    return parseProject(row);
  }

  async save(project: ProjectManifest): Promise<void> {
    const result = getDatabase()
      .prepare(
        `UPDATE projects
         SET name = ?, status = ?, payload_json = ?, updated_at = ?, version = version + 1
         WHERE id = ?`,
      )
      .run(
        project.projectName,
        project.processingStatus,
        JSON.stringify(project),
        new Date().toISOString(),
        project.projectId,
      );
    if (result.changes !== 1) throw new Error(`Project not found: ${project.projectId}`);
  }

  async list(organizationId?: string): Promise<ProjectManifest[]> {
    const rows = getDatabase()
      .prepare(`SELECT payload_json FROM projects${organizationId ? ' WHERE organization_id = ?' : ''} ORDER BY created_at DESC`)
      .all(...(organizationId ? [organizationId] : [])) as ProjectRow[];
    return rows.map((row) => parseProject(row)).filter((value): value is ProjectManifest => value !== null);
  }
}
