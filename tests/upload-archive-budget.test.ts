import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { closeDatabasesForTests } from '@/lib/autobidder/db/database';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import type { Principal } from '@/types/canonical';

vi.mock('@/lib/autobidder/ingestion/upload-limits', () => ({ VISION_UPLOAD_LIMITS: { maxBodyBytes: 1024, maxFileBytes: 1024, maxExpandedBytes: 100, maxFiles: 2, maxEntries: 5 } }));
import { ingestUploads } from '@/lib/autobidder/services/upload-ingestion';
const principal: Principal = { id: 'test-estimator', kind: 'user', displayName: 'Estimator', role: 'estimator', organizationId: 'tenant-a', scopes: [] };
let directory = '';
beforeEach(() => { directory = mkdtempSync(path.join(os.tmpdir(), 'upload-budget-')); process.env.AUTOBIDDER_DATABASE_PATH = path.join(directory, 'test.sqlite'); });
afterEach(() => { closeDatabasesForTests(); delete process.env.AUTOBIDDER_DATABASE_PATH; rmSync(directory, { recursive: true, force: true }); });

describe('combined ingestion budgets', () => {
  it('rejects file-count overflow before any file arrayBuffer is called', async () => {
    const project = await new ProjectRepository().create('Budget test', principal.organizationId);
    const form = new FormData();
    const file = new File(['%PDF plan'], 'plan.pdf');
    const read = vi.spyOn(file, 'arrayBuffer');
    for (let index = 0; index < 3; index++) form.append('files', file);
    await expect(ingestUploads(project.projectId, form, principal)).rejects.toMatchObject({ status: 413, code: 'UPLOAD_FILE_LIMIT_EXCEEDED' });
    expect(read).not.toHaveBeenCalled();
  });

  it('counts expanded bytes across separate individually safe ZIP archives', async () => {
    const project = await new ProjectRepository().create('Budget test', principal.organizationId);
    const form = new FormData();
    for (let index = 0; index < 2; index++) {
      const zip = new AdmZip();
      zip.addFile(`plan-${index}.pdf`, Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(52, index + 1)]));
      form.append('files', new File([zip.toBuffer()], `archive-${index}.zip`));
    }
    await expect(ingestUploads(project.projectId, form, principal)).rejects.toMatchObject({ status: 413, code: 'ARCHIVE_UNCOMPRESSED_LIMIT_EXCEEDED' });
    expect((await new ProjectRepository().get(project.projectId))?.files).toHaveLength(0);
  });
});
