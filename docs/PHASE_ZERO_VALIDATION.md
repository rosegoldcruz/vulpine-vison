# PHASE_ZERO_VALIDATION

Repository: /opt/vulpine-vision
Date: 2026-09-18

## Baseline Environment Verification
- pwd: /opt/vulpine-vision
- branch: main
- node: v22.23.2
- npm: 10.9.8
- scripts (package.json): dev=next dev, build=next build, start=next start, lint=tsc --noEmit, test=vitest run

## Gate Results

### [x] Next.js runtime — PASS
TEST: runtime script verification + build + start smoke
COMMAND: `node -e "console.log(require('./package.json').scripts)"`, `npm run build`, `npx next start -p 3335`
INPUT: current repository package scripts and production server boot
EXPECTED: runtime scripts point to Next; server boots under Next
ACTUAL: scripts are Next; production server started on port 3335
EVIDENCE: package scripts output, Next startup logs, HTTP 201 from `/api/projects`
NOTES: port 3000 may be occupied by another process in this environment, so validation used a free port.

### [x] Express removed from runtime — PASS
TEST: search production runtime/config for Express usage
COMMAND: `rg -n "express|server.ts" -S package.json app components lib tests types next.config.mjs postcss.config.mjs`
INPUT: runtime/config/source files
EXPECTED: no Express dependency or production imports
ACTUAL: no runtime imports or script references found
EVIDENCE: empty runtime-reference search output
NOTES: legacy Express code is quarantined under `legacy/vite-prototype`.

### [x] Vite removed from runtime — PASS
TEST: script and import reference check
COMMAND: `rg -n "vite|vite.config.ts|src/main.tsx|index.html" -S package.json app components lib tests types next.config.mjs postcss.config.mjs`
INPUT: runtime/config/source files
EXPECTED: no production script/import dependence on Vite runtime entrypoints
ACTUAL: no runtime references found
EVIDENCE: empty reference output
NOTES: old Vite config and SPA entrypoints moved to legacy.

### [x] legacy files retired — PASS
TEST: legacy runtime relocation
COMMAND: `mv server.ts index.html vite.config.ts src/App.tsx src/main.tsx legacy/vite-prototype/...`
INPUT: legacy runtime files
EXPECTED: files no longer at root production locations
ACTUAL: files moved under `legacy/vite-prototype/`
EVIDENCE: `ls legacy/vite-prototype` shows all retired files
NOTES: protects against accidental resurrection by future edits.

### [x] PDF production-route ingestion — PASS
TEST: integration route test + manual runtime route test
COMMAND: `npm run test` (test: `tests/phase-zero-routes.integration.test.ts`), plus manual `POST /api/uploads` then `POST /api/jobs/{id}/process`
INPUT: `fixtures/phase-zero/real-plan-a.pdf` + `fixtures/phase-zero/route-workbook.xlsx`
EXPECTED: upload accepted, job created, process executes, page count extracted
ACTUAL: upload=201, process=200, pageCount=2, state=`unit_mix_review_required`
EVIDENCE: integration test pass + manual JSON output snapshot
NOTES: no unit mix/takeoff generation performed.

### [x] ZIP production-route ingestion — PASS
TEST: integration route test + manual runtime test
COMMAND: `npm run test` and manual `POST /api/uploads` with nested ZIP
INPUT: ZIP containing `plans/architectural/plan-a.pdf`, `plan-b.pdf`, plus ignored text file
EXPECTED: ZIP accepted, nested PDFs discovered, non-PDF ignored
ACTUAL: upload=201, pdfFiles include both nested PDFs, `.txt` ignored
EVIDENCE: test pass + manual JSON `zipPdfFiles` output
NOTES: extraction preserves nested entry names in manifest.

### [x] nested ZIP ingestion — PASS
TEST: integration route test `verifies real ZIP ingestion with nested directories and ignored files`
COMMAND: `npm run test`
INPUT: nested ZIP fixture
EXPECTED: recursive extraction works
ACTUAL: both nested PDFs discovered
EVIDENCE: passing integration test
NOTES: verified through production upload route path.

### [x] ZIP path traversal protection — PASS
TEST: malicious ZIP integration test
COMMAND: `npm run test`
INPUT: ZIP entry `../../escape.pdf` generated via Python zipfile in test
EXPECTED: request rejected with structured traversal error
ACTUAL: endpoint returns canonical `ZIP_PATH_TRAVERSAL`
EVIDENCE: passing integration test `rejects ZIP path traversal entries`
NOTES: implemented traversal guard in `lib/autobidder/services/zip-service.ts`.

### [x] XLSX production-route ingestion — PASS
TEST: upload + workbook discovery + process route
COMMAND: `POST /api/uploads`, `POST /api/workbook`, `POST /api/jobs/{id}/process`
INPUT: `fixtures/phase-zero/route-workbook.xlsx` (real .xlsx with hidden sheet)
EXPECTED: .xlsx accepted, schema discovered, workbook rows parsed with numeric handling
ACTUAL: workbook route 200; schema includes `Pricing` and hidden `HiddenMeta`; process route parses workbook rows with `unitCostCents`
EVIDENCE: manual JSON output + passing integration test
NOTES: formula metadata is exposed via schema discovery (`formulaCellCount`).

### [x] multi-file project ingestion — PASS
TEST: multi-upload integration case
COMMAND: `npm run test`
INPUT: direct PDF A, direct PDF B, ZIP with two PDFs, one workbook
EXPECTED: one project manifest tracks all files; correct pdf/workbook counts
ACTUAL: `files.length=5`, `pdfFiles.length=4`, `workbookFiles.length=1` under one project
EVIDENCE: passing integration test `verifies multi-file project ingestion counts and association`
NOTES: avoids accidental per-file project splitting.

### [x] PDF parser execution — PASS
TEST: process route logs
COMMAND: `POST /api/jobs/{id}/process` + inspect returned job logs
INPUT: real PDF fixture
EXPECTED: parser executes metadata + text extraction attempts
ACTUAL: `pdf_parse` log includes `pageCount`, `metadataDurationMs`, `textExtractionDurationMs`, `textExtractionAttempts`
EVIDENCE: manual process response log block
NOTES: parser errors now mapped to canonical `CORRUPT_PDF`/page extraction codes.

### [x] workbook parser execution — PASS
TEST: process route + workbook route
COMMAND: `POST /api/workbook`, `POST /api/jobs/{id}/process`
INPUT: route workbook fixture
EXPECTED: schema and parsed rows returned with source traceability
ACTUAL: workbook schema discovered; rows parsed with `sourceSheet` and `sourceRow`
EVIDENCE: manual process/workbook JSON output + integration test pass
NOTES: unsupported or empty schema now returns `WORKBOOK_SCHEMA_UNSUPPORTED`.

### [x] persistent job storage across restart — PASS
TEST: restart integration
COMMAND: `npm run test` (test stops and restarts Next server, then GET job)
INPUT: created project/job with uploaded files
EXPECTED: same project/job retrievable after restart
ACTUAL: same IDs and file manifest retrieved after restart
EVIDENCE: passing integration test `persists project/job state across Next server restart`
NOTES: file-backed persistence located under `.data/autobidder`.

### [x] canonical API errors — PASS
TEST: error-contract integration cases
COMMAND: `npm run test`
INPUT: unsupported file, corrupt PDF, corrupt XLSX/schema, invalid ZIP, empty ZIP, ZIP without PDFs, missing project ID, unknown job ID, invalid state transition
EXPECTED: structured `{ ok:false, error:{ code, message, details } }`
ACTUAL: all listed cases return canonical structure and specific codes
EVIDENCE: passing integration test `returns canonical errors for unsupported, corrupt, invalid, and unknown cases`
NOTES: routes now map typed service errors with status + code.

### [x] server-only boundaries — PASS
TEST: integration boundary audit
COMMAND: `npm run test`
INPUT: client source + `.next/static/chunks` output
EXPECTED: client does not import server packages/secrets; server modules enforce `server-only`
ACTUAL: boundary assertions pass
EVIDENCE: passing integration test `enforces server-only boundaries in runtime artifacts`
NOTES: all `lib/autobidder/**/*.ts` modules now declare `import 'server-only';`.

### [x] npm run test — PASS
TEST: full test suite
COMMAND: `npm run test`
INPUT: repository tests
EXPECTED: all tests pass
ACTUAL: 5 files passed, 14 tests passed
EVIDENCE: command result summary
NOTES: includes route-level production integration suite.

### [x] npm run lint — PASS
TEST: typecheck
COMMAND: `npm run lint`
INPUT: repository code
EXPECTED: no TypeScript errors
ACTUAL: pass
EVIDENCE: `tsc --noEmit` exits 0
NOTES: legacy code excluded from active compilation via `tsconfig.json`.

### [x] npm run build — PASS
TEST: production build
COMMAND: `npm run build`
INPUT: repository code
EXPECTED: Next production build succeeds
ACTUAL: pass; app and route handlers compiled
EVIDENCE: Next build route summary output
NOTES: confirms route handlers and app router compatibility.

### [x] production next start — PASS
TEST: production runtime startup
COMMAND: `npx next start -p 3335`
INPUT: built app
EXPECTED: production server starts and serves requests
ACTUAL: server ready; API calls return expected statuses (201 for project creation)
EVIDENCE: startup logs and runtime API responses
NOTES: using alternate port avoids host conflict on 3000.

## Performance Baseline (Representative Real PDF)
TEST: production-route process run with real plan + workbook
COMMAND: `POST /api/uploads` then `POST /api/jobs/{id}/process`
INPUT: `fixtures/phase-zero/real-plan-a.pdf` (9,170,610 bytes, 2 pages), `fixtures/phase-zero/route-workbook.xlsx`
EXPECTED: metadata/text extraction timings captured without full-document hi-res raster pipeline
ACTUAL:
- file size: 9,170,610 bytes
- page count: 2
- metadata extraction duration: 100ms
- text extraction duration: 19ms
- text extraction attempts: 2
- preview generation duration: not applicable (not enabled in current route)
- memory usage: not yet instrumented in API log payload
EVIDENCE: `pdf_parse` log in process response
NOTES: memory metrics are the remaining baseline gap and should be added in a follow-up infra-only patch.

## Phase Zero Conclusion
Status: PASS for infrastructure ingestion gates, with estimator intelligence quarantined.

Hard-stop compliance:
- Unit mix generation remains disabled.
- Cabinet takeoff generation remains disabled.
- SKU/pricing/SAFE_TO_SEND intelligence remains disabled.
