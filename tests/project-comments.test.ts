import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabasesForTests, getDatabase } from '@/lib/autobidder/db/database';
import { createProjectComment, listProjectComments } from '@/lib/autobidder/services/project-comment-service';
import type { Principal } from '@/types/canonical';

let directory = '';
const principal: Principal = { id: 'reviewer-1', kind: 'user', displayName: 'Reviewer', role: 'reviewer', organizationId: 'org-1', scopes: [] };

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'project-comments-'));
  process.env.AUTOBIDDER_DATABASE_PATH = path.join(directory, 'test.sqlite');
  const now = new Date().toISOString();
  getDatabase().prepare(`INSERT INTO projects (id, organization_id, name, status, currency, version, payload_json, created_at, updated_at)
    VALUES ('project-1','org-1','Comment fixture','review','USD',1,'{}',?,?)`).run(now, now);
});

afterEach(() => { closeDatabasesForTests(); delete process.env.AUTOBIDDER_DATABASE_PATH; rmSync(directory, { recursive: true, force: true }); });

describe('project review comments', () => {
  it('persists attributed comments and audit evidence within the tenant', () => {
    const comment = createProjectComment('project-1', { body: 'Verify the ADA vanity elevation.', context: 'cabinet_review' }, principal);
    expect(listProjectComments('project-1', principal)).toEqual([comment]);
    expect(getDatabase().prepare(`SELECT actor_id, action FROM audit_events WHERE resource_id=?`).get(comment.id)).toEqual({ actor_id: 'reviewer-1', action: 'project_comment.created' });
  });

  it('conceals comments from another organization', () => {
    const outsider = { ...principal, organizationId: 'org-2' };
    expect(() => listProjectComments('project-1', outsider)).toThrow(/not found/i);
  });
});
