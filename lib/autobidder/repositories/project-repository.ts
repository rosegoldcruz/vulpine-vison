import 'server-only';
import { randomUUID } from 'crypto';
import type { ProjectManifest } from '@/types';
import { ensureDataDirs, listFiles, readJson, writeJson } from '@/lib/autobidder/storage/file-store';

function projectPath(projectId: string) {
  return `projects/${projectId}.json`;
}

export class ProjectRepository {
  async create(projectName: string): Promise<ProjectManifest> {
    await ensureDataDirs();
    const projectId = randomUUID();
    const manifest: ProjectManifest = {
      projectId,
      projectName,
      files: [],
      pdfFiles: [],
      workbookFiles: [],
      pageCount: 0,
      createdAt: new Date().toISOString(),
      processingStatus: 'created',
    };
    await writeJson(projectPath(projectId), manifest);
    return manifest;
  }

  async get(projectId: string): Promise<ProjectManifest | null> {
    await ensureDataDirs();
    return readJson<ProjectManifest>(projectPath(projectId));
  }

  async save(project: ProjectManifest): Promise<void> {
    await ensureDataDirs();
    await writeJson(projectPath(project.projectId), project);
  }

  async list(): Promise<ProjectManifest[]> {
    await ensureDataDirs();
    const files = await listFiles('projects');
    const results: ProjectManifest[] = [];
    for (const f of files) {
      const value = await readJson<ProjectManifest>(f);
      if (value) {
        results.push(value);
      }
    }
    return results.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
}
