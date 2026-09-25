import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabasesForTests } from '@/lib/autobidder/db/database';
import { ProjectRepository } from '@/lib/autobidder/repositories/project-repository';
import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import { POST as queryRoute } from '@/app/api/assistant/query/route';
import { POST as optimizeRoute } from '@/app/api/assistant/optimize/route';
import { POST as chatRoute } from '@/app/api/chat/route';

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'assistant-routes-'));
  process.env.AUTOBIDDER_DATABASE_PATH = path.join(directory, 'test.sqlite');
});

afterEach(() => {
  closeDatabasesForTests();
  delete process.env.AUTOBIDDER_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});

async function fixture() {
  const project = await new ProjectRepository().create('Assistant Route Fixture');
  const repository = new BidJobRepository();
  const job = await repository.create(project);
  job.state = 'bid_review_required';
  job.qaResult = {
    safeToSend: false,
    criticalIssues: [{ code: 'UNRESOLVED_SKU', message: 'Mapping review is required.' }],
    warnings: [], assumptions: [],
  };
  job.workbookRecords = [{
    sku: 'B24', cabinetCode: 'B24', sourceWorkbook: 'approved.xlsx', sourceSheet: 'Catalog', sourceRow: 7,
  }];
  await repository.save(job);
  return job;
}

describe('authenticated project assistant routes', () => {
  it('returns deterministic read-only facts with citations', async () => {
    const job = await fixture();
    const response = await queryRoute(new Request('http://localhost/api/assistant/query', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: job.id, tool: 'qa_blockers' }),
    }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.result).toMatchObject({ tool: 'qa_blockers', readOnly: true });
    expect(payload.data.result.facts[0].citations[0].kind).toBe('qa_issue');
  });

  it('optimizes against server-loaded project context with preview and undo', async () => {
    const job = await fixture();
    const response = await optimizeRoute(new Request('http://localhost/api/assistant/optimize', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: job.id, prompt: 'Explain the B24 mapping.', context: { sheet: 'A5.1' } }),
    }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.revision.optimizedPrompt).toContain('Assistant Route Fixture');
    expect(payload.data.revision.optimizedPrompt).toContain('approved.xlsx');
    expect(payload.data.revision.undo.restoresPrompt).toBe('Explain the B24 mapping.');
  });

  it('rejects unknown or mutation tools at request validation', async () => {
    const job = await fixture();
    const response = await queryRoute(new Request('http://localhost/api/assistant/query', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: job.id, tool: 'approve_unit_mix' }),
    }));
    expect(response.status).toBe(400);
  });

  it('grounds active-project chat in deterministic records and returns citations', async () => {
    const job = await fixture();
    const response = await chatRoute(new Request('http://localhost/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: job.id, message: 'What QA blockers remain?', history: [] }),
    }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.text).toContain('UNRESOLVED_SKU');
    expect(payload.data.citations[0]).toMatchObject({ kind: 'qa_issue', jobId: job.id });
  });
});
