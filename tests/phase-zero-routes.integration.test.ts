import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { execSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import net from 'net';
import AdmZip from 'adm-zip';
import { createHmac, randomUUID } from 'node:crypto';

const REPO_ROOT = path.resolve(__dirname, '..');
let port = 0;
let baseUrl = '';

const REAL_PDF_A = path.join(REPO_ROOT, 'fixtures/phase-zero/real-plan-a.pdf');
const REAL_PDF_B = path.join(REPO_ROOT, 'fixtures/phase-zero/real-plan-b.pdf');
const ROUTE_XLSX = path.join(REPO_ROOT, 'fixtures/phase-zero/route-workbook.xlsx');
const VISION_API_TOKEN = 'phase-zero-vision-api-token-with-sufficient-entropy';

let server: ChildProcessWithoutNullStreams | null = null;
let restartProjectId = '';
let restartJobId = '';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(url: string, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (server && server.exitCode !== null) {
      throw new Error(`Server exited during startup with code ${server.exitCode}`);
    }
    try {
      const res = await fetch(url);
      if (res.status === 200) {
        return;
      }
    } catch {
      // Keep retrying.
    }
    await sleep(500);
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms`);
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      if (!address || typeof address === 'string') {
        socket.close();
        reject(new Error('Unable to resolve ephemeral port'));
        return;
      }
      const resolved = address.port;
      socket.close(() => resolve(resolved));
    });
    socket.on('error', reject);
  });
}

async function startServer() {
  server = spawn('npm', ['run', 'start', '--', '-p', `${port}`], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LEADS_INTEGRATION_KEY: process.env.LEADS_INTEGRATION_KEY || 'test-integration-key',
      VISION_API_TOKEN,
    },
    stdio: 'pipe',
  });
  await waitForServerReady(`${baseUrl}/`);
}

function visionAuthHeaders(): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  const encoded = Buffer.from(JSON.stringify({
    v: 1,
    sub: 'phase-zero-admin',
    org: 'local',
    role: 'admin',
    scopes: [],
    iat: now - 5,
    exp: now + 120,
    nonce: randomUUID(),
  }), 'utf8').toString('base64url');
  const signature = createHmac('sha256', VISION_API_TOKEN).update(encoded, 'utf8').digest('base64url');
  return {
    authorization: `Bearer ${VISION_API_TOKEN}`,
    'x-vulpine-principal': `${encoded}.${signature}`,
  };
}

async function stopServer() {
  if (!server) {
    return;
  }
  server.kill('SIGTERM');
  await sleep(1000);
  if (!server.killed) {
    server.kill('SIGKILL');
  }
  server = null;
}

async function createProject(name: string) {
  const res = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...visionAuthHeaders() },
    body: JSON.stringify({ projectName: name }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

function fileFromPath(filePath: string, fileName: string, mimeType: string) {
  const bytes = readFileSync(filePath);
  return new File([bytes], fileName, { type: mimeType });
}

async function uploadFiles(projectId: string | null, files: File[]) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  const headers: Record<string, string> = visionAuthHeaders();
  if (projectId) {
    headers['x-project-id'] = projectId;
  }
  const res = await fetch(`${baseUrl}/api/uploads`, {
    method: 'POST',
    headers,
    body: form,
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function processJob(jobId: string) {
  const res = await fetch(`${baseUrl}/api/jobs/${jobId}/process`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...visionAuthHeaders() },
    body: JSON.stringify({ jobId }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

function expectErrorContract(payload: any, expectedCode?: string) {
  expect(payload).toHaveProperty('ok', false);
  expect(payload).toHaveProperty('error');
  expect(typeof payload.error.code).toBe('string');
  expect(typeof payload.error.message).toBe('string');
  expect(payload.error).toHaveProperty('details');
  if (expectedCode) {
    expect(payload.error.code).toBe(expectedCode);
  }
}

function buildValidNestedZip() {
  const zip = new AdmZip();
  zip.addFile('plans/architectural/plan-a.pdf', readFileSync(REAL_PDF_A));
  zip.addFile('plans/architectural/plan-b.pdf', readFileSync(REAL_PDF_B));
  zip.addFile('plans/architectural/readme.txt', Buffer.from('ignore me'));
  return new File([zip.toBuffer()], 'nested-plans.zip', { type: 'application/zip' });
}

function buildMaliciousZipFromPython() {
  const outPath = path.join(tmpdir(), `phase-zero-malicious-${Date.now()}.zip`);
  const escapedOut = outPath.replace(/'/g, "'\\''");
  const escapedPdf = REAL_PDF_A.replace(/'/g, "'\\''");
  execSync(
    `python3 - <<'PY'\nimport zipfile\nwith zipfile.ZipFile('${escapedOut}','w',compression=zipfile.ZIP_DEFLATED) as z:\n    z.write('${escapedPdf}', arcname='../../escape.pdf')\nPY`,
    { cwd: REPO_ROOT, stdio: 'pipe' },
  );
  return new File([readFileSync(outPath)], 'malicious.zip', { type: 'application/zip' });
}

describe.sequential('Phase Zero route-level validation', () => {
  beforeAll(async () => {
    port = await reservePort();
    baseUrl = `http://127.0.0.1:${port}`;
    execSync('npm run build', { cwd: REPO_ROOT, stdio: 'pipe' });
    await startServer();
  }, 240000);

  afterAll(async () => {
    await stopServer();
  });

  it('verifies real PDF ingestion and processing via production routes', async () => {
    const created = await createProject('phase-zero-real-pdf');
    expect(created.status).toBe(201);
    const projectId = created.json.data.project.projectId;

    const upload = await uploadFiles(projectId, [
      fileFromPath(REAL_PDF_A, 'real-plan-a.pdf', 'application/pdf'),
      fileFromPath(ROUTE_XLSX, 'route-workbook.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ]);
    expect(upload.status).toBe(201);
    expect(upload.json.data.project.pdfFiles.length).toBe(1);
    expect(upload.json.data.project.workbookFiles.length).toBe(1);

    const jobId = upload.json.data.job.id;
    const processed = await processJob(jobId);
    expect(processed.status).toBe(200);
    expect(processed.json.data.job.manifest.pageCount).toBeGreaterThan(0);

    const pdfLogs = processed.json.data.job.logs.filter((item: any) => item.stage === 'pdf_parse');
    expect(pdfLogs.length).toBeGreaterThan(0);
    expect(pdfLogs[0].metadataDurationMs).toBeGreaterThanOrEqual(0);
    expect(pdfLogs[0].textExtractionAttempts).toBeGreaterThan(0);

    const getRes = await fetch(`${baseUrl}/api/jobs/${jobId}`, { headers: visionAuthHeaders() });
    const getJson = await getRes.json();
    expect(getRes.status).toBe(200);
    expect(getJson.data.job.id).toBe(jobId);
  }, 240000);

  it('verifies real ZIP ingestion with nested directories and ignored files', async () => {
    const created = await createProject('phase-zero-zip');
    expect(created.status).toBe(201);
    const projectId = created.json.data.project.projectId;

    const upload = await uploadFiles(projectId, [
      buildValidNestedZip(),
      fileFromPath(ROUTE_XLSX, 'route-workbook.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ]);
    expect(upload.status).toBe(201);

    const pdfNames = upload.json.data.project.pdfFiles.map((f: any) => f.name);
    expect(pdfNames).toContain('plans/architectural/plan-a.pdf');
    expect(pdfNames).toContain('plans/architectural/plan-b.pdf');
    expect(pdfNames.find((name: string) => name.endsWith('.txt'))).toBeUndefined();

    const process = await processJob(upload.json.data.job.id);
    expect(process.status).toBe(200);
    expect(process.json.data.job.manifest.pageCount).toBeGreaterThan(0);
  }, 240000);

  it('rejects ZIP path traversal entries', async () => {
    const created = await createProject('phase-zero-zip-traversal');
    const projectId = created.json.data.project.projectId;

    const malicious = buildMaliciousZipFromPython();

    const upload = await uploadFiles(projectId, [malicious]);
    expect(upload.status).toBe(400);
    expectErrorContract(upload.json, 'ZIP_PATH_TRAVERSAL');
  });

  it('rejects unauthenticated lead handoff requests', async () => {
    const res = await fetch(`${baseUrl}/api/integrations/leads/handoff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectName: 'lead-handoff-missing-auth',
        sourceSystem: 'vulpine-leads',
        leadId: 'lead-missing-auth',
      }),
    });
    const json = await res.json();
    expect(res.status).toBe(401);
    expectErrorContract(json, 'UNAUTHORIZED');
  });

  it('creates a lead handoff project with integration auth', async () => {
    const res = await fetch(`${baseUrl}/api/integrations/leads/handoff`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-integration-key': 'test-integration-key',
      },
      body: JSON.stringify({
        projectName: 'lead-handoff-success',
        sourceSystem: 'vulpine-leads',
        leadId: 'lead-001',
        accountName: 'Example Development',
        opportunityName: 'Riverwalk Phase 2',
        attachmentRefs: ['drive://opps/riverwalk/plan-set.zip'],
        correlationId: 'corr-route-test-001',
      }),
    });
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.data.project.leadHandoff.leadId).toBe('lead-001');
    expect(json.data.project.leadHandoff.correlationId).toBe('corr-route-test-001');
    expect(json.data.handoff.projectId).toBe(json.data.project.projectId);
  });

  it('verifies real XLSX ingestion and workbook schema metadata via routes', async () => {
    const created = await createProject('phase-zero-xlsx');
    const projectId = created.json.data.project.projectId;

    const upload = await uploadFiles(projectId, [
      fileFromPath(REAL_PDF_A, 'real-plan-a.pdf', 'application/pdf'),
      fileFromPath(ROUTE_XLSX, 'route-workbook.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ]);
    expect(upload.status).toBe(201);

    const workbookRes = await fetch(`${baseUrl}/api/workbook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...visionAuthHeaders() },
      body: JSON.stringify({ projectId }),
    });
    const workbookJson = await workbookRes.json();
    expect(workbookRes.status).toBe(200);
    expect(workbookJson.data.schema.length).toBeGreaterThan(0);
    expect(typeof workbookJson.data.schema[0].hidden).toBe('boolean');
    expect(typeof workbookJson.data.schema[0].formulaCellCount).toBe('number');

    const processed = await processJob(upload.json.data.job.id);
    expect(processed.status).toBe(200);
    const records = processed.json.data.job.workbookRecords;
    expect(records.length).toBeGreaterThan(0);
    expect(records[0].sourceSheet.length).toBeGreaterThan(0);
    expect(records[0].sourceRow).toBeGreaterThan(0);

    const numericCosts = records.filter((r: any) => typeof r.unitCostCents === 'number');
    expect(numericCosts.length).toBeGreaterThan(0);
  }, 240000);

  it('verifies multi-file project ingestion counts and association', async () => {
    const created = await createProject('phase-zero-multifile');
    const projectId = created.json.data.project.projectId;

    const upload = await uploadFiles(projectId, [
      fileFromPath(REAL_PDF_A, 'direct-a.pdf', 'application/pdf'),
      fileFromPath(REAL_PDF_B, 'direct-b.pdf', 'application/pdf'),
      buildValidNestedZip(),
      fileFromPath(ROUTE_XLSX, 'route-workbook.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ]);

    expect(upload.status).toBe(201);
    expect(upload.json.data.project.projectId).toBe(projectId);
    expect(upload.json.data.project.files.length).toBe(5);
    expect(upload.json.data.project.pdfFiles.length).toBe(4);
    expect(upload.json.data.project.workbookFiles.length).toBe(1);
    expect(upload.json.data.job.projectId).toBe(projectId);
  });

  it('persists project/job state across Next server restart', async () => {
    const created = await createProject('phase-zero-restart');
    restartProjectId = created.json.data.project.projectId;

    const upload = await uploadFiles(restartProjectId, [
      fileFromPath(REAL_PDF_A, 'restart-a.pdf', 'application/pdf'),
      fileFromPath(ROUTE_XLSX, 'route-workbook.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ]);
    restartJobId = upload.json.data.job.id;
    expect(upload.status).toBe(201);

    await stopServer();
    await startServer();

    const resumed = await fetch(`${baseUrl}/api/jobs/${restartJobId}`, { headers: visionAuthHeaders() });
    const resumedJson = await resumed.json();
    expect(resumed.status).toBe(200);
    expect(resumedJson.data.job.id).toBe(restartJobId);
    expect(resumedJson.data.project.projectId).toBe(restartProjectId);
    expect(resumedJson.data.project.files.length).toBeGreaterThan(0);
  }, 300000);

  it('returns canonical errors for unsupported, corrupt, invalid, and unknown cases', async () => {
    const missingHeaderUpload = await fetch(`${baseUrl}/api/uploads`, {
      method: 'POST',
      headers: visionAuthHeaders(),
      body: new FormData(),
    });
    const missingHeaderJson = await missingHeaderUpload.json();
    expect(missingHeaderUpload.status).toBe(400);
    expectErrorContract(missingHeaderJson, 'PROJECT_ID_REQUIRED');

    const createdUnsupported = await createProject('phase-zero-unsupported');
    const unsupportedFile = new File([Buffer.from('hello')], 'unsupported.txt', { type: 'text/plain' });
    const unsupported = await uploadFiles(createdUnsupported.json.data.project.projectId, [unsupportedFile]);
    expect(unsupported.status).toBe(400);
    expectErrorContract(unsupported.json, 'UNSUPPORTED_FILE_TYPE');

    const createdInvalidZip = await createProject('phase-zero-invalid-zip');
    const invalidZip = new File([Buffer.from('not-a-zip')], 'bad.zip', { type: 'application/zip' });
    const invalidZipRes = await uploadFiles(createdInvalidZip.json.data.project.projectId, [invalidZip]);
    expect(invalidZipRes.status).toBe(400);
    expectErrorContract(invalidZipRes.json, 'INVALID_ZIP');

    const createdEmptyZip = await createProject('phase-zero-empty-zip');
    const emptyZip = new AdmZip();
    const emptyZipRes = await uploadFiles(createdEmptyZip.json.data.project.projectId, [
      new File([emptyZip.toBuffer()], 'empty.zip', { type: 'application/zip' }),
    ]);
    expect(emptyZipRes.status).toBe(400);
    expectErrorContract(emptyZipRes.json, 'EMPTY_ZIP');

    const createdZipWithoutPdf = await createProject('phase-zero-zip-without-pdf');
    const zipWithoutPdf = new AdmZip();
    zipWithoutPdf.addFile('plans/data.csv', Buffer.from('a,b\n1,2\n'));
    const zipWithoutPdfRes = await uploadFiles(createdZipWithoutPdf.json.data.project.projectId, [
      new File([zipWithoutPdf.toBuffer()], 'without-pdf.zip', { type: 'application/zip' }),
    ]);
    expect(zipWithoutPdfRes.status).toBe(400);
    expectErrorContract(zipWithoutPdfRes.json, 'ZIP_WITHOUT_PDFS');

    const createdCorruptPdf = await createProject('phase-zero-corrupt-pdf');
    const corruptPdfUpload = await uploadFiles(createdCorruptPdf.json.data.project.projectId, [
      new File([Buffer.from('broken-pdf')], 'broken.pdf', { type: 'application/pdf' }),
      fileFromPath(ROUTE_XLSX, 'route-workbook.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ]);
    expect(corruptPdfUpload.status).toBe(201);
    const corruptPdfProcess = await processJob(corruptPdfUpload.json.data.job.id);
    expect(corruptPdfProcess.status).toBe(400);
    expectErrorContract(corruptPdfProcess.json, 'CORRUPT_PDF');

    const createdCorruptXlsx = await createProject('phase-zero-corrupt-xlsx');
    const corruptXlsxUpload = await uploadFiles(createdCorruptXlsx.json.data.project.projectId, [
      fileFromPath(REAL_PDF_A, 'real-plan-a.pdf', 'application/pdf'),
      new File([Buffer.from('broken-xlsx')], 'broken.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    ]);
    expect(corruptXlsxUpload.status).toBe(201);
    const corruptXlsxProcess = await processJob(corruptXlsxUpload.json.data.job.id);
    expect(corruptXlsxProcess.status).toBe(400);
    expectErrorContract(corruptXlsxProcess.json);
    expect(['CORRUPT_WORKBOOK', 'WORKBOOK_SCHEMA_UNSUPPORTED']).toContain(corruptXlsxProcess.json.error.code);

    const unknownJob = await fetch(`${baseUrl}/api/jobs/00000000-0000-0000-0000-000000000000`, { headers: visionAuthHeaders() });
    const unknownJobJson = await unknownJob.json();
    expect(unknownJob.status).toBe(404);
    expectErrorContract(unknownJobJson, 'NOT_FOUND');

    const createdState = await createProject('phase-zero-invalid-state');
    const uploadState = await uploadFiles(createdState.json.data.project.projectId, [
      fileFromPath(REAL_PDF_A, 'real-plan-a.pdf', 'application/pdf'),
      fileFromPath(ROUTE_XLSX, 'route-workbook.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ]);
    const approve = await fetch(`${baseUrl}/api/jobs/${uploadState.json.data.job.id}/approve-unit-mix`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...visionAuthHeaders() },
      body: JSON.stringify({ approvedBy: 'tester' }),
    });
    const approveJson = await approve.json();
    expect(approve.status).toBe(410);
    expectErrorContract(approveJson, 'LEGACY_ROUTE_DISABLED');
  }, 300000);

  it('enforces server-only boundaries in runtime artifacts', async () => {
    const clientFile = path.join(REPO_ROOT, 'components/autobidder/workspace-client.tsx');
    const clientCode = readFileSync(clientFile, 'utf-8');
    expect(clientCode).not.toMatch(/from ['"]fs['"]/);
    expect(clientCode).not.toMatch(/from ['"]xlsx['"]/);
    expect(clientCode).not.toMatch(/from ['"]adm-zip['"]/);
    expect(clientCode).not.toMatch(/GEMINI_API_KEY|AUTOBIDDER_DATA_DIR/);

    const libRoot = path.join(REPO_ROOT, 'lib/autobidder');
    const stack: string[] = [libRoot];
    while (stack.length) {
      const current = stack.pop() as string;
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile() && full.endsWith('.ts')) {
          const code = readFileSync(full, 'utf-8');
          expect(code.startsWith("import 'server-only';") || code.startsWith('import "server-only";')).toBe(true);
        }
      }
    }

    const staticDir = path.join(REPO_ROOT, '.next/static/chunks');
    const staticStack: string[] = [staticDir];
    const jsFiles: string[] = [];
    while (staticStack.length) {
      const current = staticStack.pop() as string;
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          staticStack.push(full);
        } else if (entry.isFile() && full.endsWith('.js')) {
          jsFiles.push(full);
        }
      }
    }

    const forbidden = ['pdfjs-dist', 'adm-zip', 'AUTOBIDDER_DATA_DIR', 'GEMINI_API_KEY'];
    for (const file of jsFiles) {
      const code = readFileSync(file, 'utf-8');
      for (const token of forbidden) {
        expect(code.includes(token)).toBe(false);
      }
    }
  }, 180000);

  it('records performance baseline telemetry for real PDF parsing', async () => {
    const created = await createProject('phase-zero-performance');
    const projectId = created.json.data.project.projectId;

    const upload = await uploadFiles(projectId, [
      fileFromPath(REAL_PDF_A, 'real-plan-a.pdf', 'application/pdf'),
      fileFromPath(ROUTE_XLSX, 'route-workbook.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ]);

    const processed = await processJob(upload.json.data.job.id);
    expect(processed.status).toBe(200);

    const log = processed.json.data.job.logs.find((item: any) => item.stage === 'pdf_parse');
    expect(log).toBeTruthy();
    expect(log.fileSizeBytes).toBeGreaterThan(0);
    expect(log.pageCount).toBeGreaterThan(0);
    expect(log.metadataDurationMs).toBeGreaterThanOrEqual(0);
    expect(log.textExtractionDurationMs).toBeGreaterThanOrEqual(0);
    expect(log.textExtractionAttempts).toBeGreaterThan(0);
  }, 240000);
});
