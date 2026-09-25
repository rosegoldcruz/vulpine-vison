# Cabinet Brain implementation ledger

Final acceptance date: 2026-09-25. Status values are `VERIFIED` and `BLOCKED_EXTERNAL`. A requirement is `VERIFIED` only when its in-repository behavior is implemented and covered by automated or browser runtime evidence. Optional live providers are not configured in this environment; their provider boundaries, persistence, authorization, and honest disconnected states are verified without claiming a live external result.

## Acceptance summary

- TypeScript: `npm run lint` passed.
- Automated tests: `npm test` passed — 40 files, 159 tests.
- Production build: `npm run build` passed; all application and API routes compiled.
- Browser acceptance: `node scripts/browser-qa.mjs` reached `cabinet bid safe to send`, rendered two plan sheets, persisted a review comment and outreach draft across reload, and reported zero console errors.
- Visual evidence: `docs/design/cabinet-brain-canonical-safe-desktop.png`, `docs/design/cabinet-brain-backoffice-desktop.png`, and `docs/design/cabinet-brain-workspace-mobile.png`.
- Persistence restart evidence: `tests/phase-zero-routes.integration.test.ts` restarts the production Next server and verifies project/job recovery.
- External truth: email, company intelligence, maps/logistics, Cabinet Vision AI, LLM, and realtime voice remain visibly `Not Configured` unless credentials are supplied. Deterministic fallbacks never invent provider output.

## Requirement ledger

| # | Requirement | Phase | Status | Verification evidence |
|---:|---|---:|---|---|
| 01 | Controlled BidJob Workflow State Machine | 1 | VERIFIED | Exact canonical states/transitions, guarded system vs. human actions, immutable state history, invalid-attempt audit; `canonical-workflow.test.ts`, `canonical-bid-service.integration.test.ts`, browser happy path. |
| 02 | Authoritative Cabinet Workbook Ingestion | 1 | VERIFIED | XLS/XLSX/CSV parsing, authoritative source selection, workbook/sheet/row/raw-value retention, schema validation; `workbook-parser.test.ts`, `phase-zero-routes.integration.test.ts`. |
| 03 | Cabinet Plan Classification Agent | 1 | VERIFIED | Required taxonomy, provider boundary, confidence/evidence, relevant-page gate, explicit human review for uncertain pages; `cabinet-vision-provider.test.ts`, `pdf-classifier.test.ts`, browser classification review. |
| 04 | Cabinet Page Extraction Agent | 1 | VERIFIED | Structured units/cabinets/dimensions/room/configuration/adjacency/ADA/ambiguity extraction with region evidence and provider metadata; provider + canonical integration tests. |
| 05 | Unit Mix Agent | 1 | VERIFIED | Evidence-derived candidate materialization, source references, discrepancies, no fabricated counts; `compiler-unit-mix.test.ts`, canonical integration tests. |
| 06 | Mandatory Human Unit Mix Verification | 1 | VERIFIED | Edit/add/merge/verify workspace, approval identity/time/note, workflow hard gate; canonical integration test and browser path. |
| 07 | Per-Unit Cabinet Takeoff Agent | 1 | VERIFIED | Per-unit cabinet instances and takeoff rows retain room/category/configuration/dimension/evidence fields and require approval; canonical integration test. |
| 08 | Deterministic SKU Mapping Agent | 1 | VERIFIED | Normalization rules, exact/ambiguous/unresolved outcomes, confidence, manual resolution/audit, no LLM pricing; `compiler-sku-mapper.test.ts`. |
| 09 | Multifamily Quantity Compiler | 1 | VERIFIED | Verified unit mix × per-unit quantity, integer reconciliation, cabinet/panel/filler/accessory/charge categories, versioned cents math; `compiler-estimate.test.ts`. |
| 10 | QA Hard-Stop Agent | 1 | VERIFIED | Complete critical matrix, warnings/information, clean-latest-result rule, explicit approval before safe-to-send; `compiler-qa.test.ts`, canonical integration and browser path. |
| 11 | Review & Resolution Workspace | 1 | VERIFIED | Review table, evidence reopening, issue resolution, authorized overrides, comments, approval/audit surfaces; browser screenshots and canonical integration tests. |
| 12 | Full Evidence Provenance | 1 | VERIFIED | ID-linked source → sheet/region → cabinet/takeoff → mapping → estimate lineage and provenance navigation; `compiler-provenance.test.ts`, export tests. |
| 13 | High-Resolution Server-Side PDF Rasterization | 2 | VERIFIED | Bounded-DPI server rasterization, rotation/dimension/page identity and SHA-256 artifacts; `ingestion-pdf-raster.test.ts`. |
| 14 | Complete Plan Set / ZIP / Folder Ingestion | 2 | VERIFIED | Multi-file, recursive folder/drop, nested ZIP, dedupe, limits, traversal rejection, complete accepted/rejected/duplicate/failed manifest and partial isolation; ingestion tests + browser upload. |
| 15 | Multi-File Upload Queue | 2 | VERIFIED | Per-file durable states/progress/failures, bounded worker concurrency, retry/cancel/dismiss controls; `file-queue-service.test.ts`, job-control tests, browser queue. |
| 16 | Workflow-Oriented Workspace Layout | 2 | VERIFIED | Canonical stage rail, action gate, review table, QA/provenance/export inspector, ingestion/viewer panels; desktop/mobile browser screenshots. |
| 17 | Blueprint Full-Screen Viewer | 2 | VERIFIED | Persisted rendered-page viewer with thumbnails, pan/zoom/fit/actual-pixels/full-screen and sheet metadata; browser desktop/mobile evidence. |
| 18 | Architectural Measurement & Drawing Studio | 2 | VERIFIED | Calibration, distance/area geometry, markup modes, undo/redo, persisted measurements and evidence links; `viewer-evidence-notifications.test.ts`. |
| 19 | Annotated Evidence Snippet Capture | 2 | VERIFIED | Real server crop, rendered annotations, stored PNG artifact, target links, review-PDF embedding; viewer/export tests. |
| 20 | Real Processing Progress | 3 | VERIFIED | Persisted monotonic stage/unit counters, real server-sent event stream and UI consumption; `processing-control-progress.test.ts`, browser workflow. |
| 21 | Automatic Retry & Recovery | 3 | VERIFIED | Retry classification, bounded exponential backoff, attempt limit, transient-only policy and checkpoint resume; `processing-retry.test.ts`; deterministic corrupt-file status regression covered. |
| 22 | Pause / Resume / Cancel Processing | 3 | VERIFIED | Durable control requests honored at safe checkpoints with valid transition rules and UI controls; job-control and processing-control tests. |
| 23 | Stalled Job Detection | 3 | VERIFIED | Heartbeat/lease threshold, stalled diagnosis and recoverable retry state; `processing-eta-stall.test.ts`. |
| 24 | Honest Estimated Time Remaining | 3 | VERIFIED | Rolling throughput ETA only when enough real progress exists; otherwise explicitly unavailable/complete; `processing-eta-stall.test.ts`. |
| 25 | Persistent Processing Settings | 3 | VERIFIED | Validated per-principal persistence for concurrency, retries, delays and stall threshold with restore defaults; `processing-settings.test.ts`. |
| 26 | Error Diagnostics | 3 | VERIFIED | Typed/correlated API errors, persisted run/file failure evidence, diagnostics endpoint/UI, original deterministic status propagation; phase-zero negative-path suite. |
| 27 | Real Database Persistence | 4 | VERIFIED | Migrated SQLite database in WAL mode for canonical, run, audit, artifact, comment, provider and analytics records; restart and database persistence tests. |
| 28 | localStorage Session Persistence | 4 | VERIFIED | Browser stores only project/job pointers and restores server-authoritative state; browser reload test and phase-zero restart test. |
| 29 | Authentication & Authorization | 4 | VERIFIED | HMAC session cookies, role permissions, organization-scoped access, authenticated actor audit, route/resource enforcement and no admin tenant bypass; authorization/auth route tests. |
| 30 | Project-Aware Cabinet Brain Chat | 5 | VERIFIED | Authorized job grounding, canonical tools/citations/workflow guidance, conversation persistence, provider fallback without calculator authority; assistant tests. |
| 31 | Repo / Product-Aware Engineering Assistant | 5 | VERIFIED | Read-only repository/runtime inspection with bounded paths and honest outputs; assistant route/support tests. |
| 32 | Prompt Optimization Button | 5 | VERIFIED | Server optimization, preview/apply/undo flow, project context and audit-safe UI; project assistant route tests. |
| 33 | Two-Way Voice Assistant | 5 | VERIFIED | Authorized project-bound realtime transport, transcript/tool loop through the same grounded backend, cancel/interruption, and explicit disconnected state. Live provider session is optional and not configured. |
| 34 | Cabinet Data Export Agent | 6 | VERIFIED | Stable versioned JSON/CSV/XLSX snapshots, approved canonical data only, full provenance, persisted artifact metadata/bytes/hash/audit and tenant-safe download; export suites. |
| 35 | Compiled Multi-Page Review PDF | 6 | VERIFIED | Eleven required sections plus embedded evidence snippet pages, internal/customer gates, generated artifact hash; review document/artifact tests. |
| 36 | Bid Outreach Quick Action | 7 | VERIFIED | Server-sourced approved amount, recipient/scope/inclusions/exclusions/assumptions/signature/generated attachments, draft-first behavior, explicit send confirmation and provider gate; backoffice tests + browser draft. |
| 37 | Pipeline Liquidity Dashboard | 7 | VERIFIED | Persisted deals/events drive project/unit/value/stage aging/bottleneck metrics, including awaiting QA, submitted, awarded and lost values; analytics tests + browser dashboard. |
| 38 | Thirty-Day Operating Trend | 7 | VERIFIED | Daily persisted-event series and current/prior 30-day comparisons with raw counts and honest zero baseline; analytics tests + browser view. |
| 39 | Outreach Velocity Trend Indicator | 7 | VERIFIED | Current/prior outreach counts, percentage only with valid baseline, zero-baseline labeling; analytics tests + browser view. |
| 40 | Completed Bid Value Visualization | 7 | VERIFIED | Project/customer/date/status/market/consultant/cabinet-line filters/grouping; bid, expected and realized revenue remain distinct; route/analytics tests. |
| 41 | Company Intelligence / ZoomInfo Enrichment | 7 | VERIFIED | Authorized provider abstraction, separately persisted snapshots/provenance/failure state, no invented values, honest `Not Configured` UI/API; provider/logistics tests. Live provider credentials are external and absent. |
| 42 | Job Site / Supplier Map Grounding | 7 | VERIFIED | Authorized geocode/route provider abstraction, persisted evidence, estimated freight separated from approved freight, honest disconnected state; provider/logistics tests. Live credentials are external and absent. |
| 43 | Queue Item Cancel / Remove Control | 8 | VERIFIED | Controlled cancel for active runs, delete only safe queued/failed items, completed-item/run dismissal without deleting history/artifacts; queue and job-control tests. |
| 44 | Processing Notifications | 8 | VERIFIED | Durable deduplicated stage/failure/stall/review/QA/safe notifications, notification center and accessible live region; viewer/notification tests + browser UI. |
| 45 | Bento-Style Workspace Design | 8 | VERIFIED | Responsive dark/cyan bento system with compact hierarchy, consistent states and mobile reflow while retaining functional workflow controls; desktop/mobile screenshots. |
| 46 | Generic “Fix the Errors” | 9 | VERIFIED | Runtime diagnosis preserved typed errors, fixed corrupt-PDF `400` propagation, exposed partial failures, removed swallowed/mock paths, ran diff/type/test/build/browser checks and upgraded upload parsers. |
| 47 | Browser-Based Result Persistence | 9 | VERIFIED | Pointer-only local storage, server-side canonical/artifact persistence and reload recovery; browser comment/state reload plus production-server restart test. |

## External and security boundary

No requirement is deferred. Live third-party calls are configuration-dependent by design, and the product exposes that state instead of simulating a connection. `npm audit fix` plus targeted upgrades removed the upload-path advisories for `adm-zip` and `pdfjs-dist`. The residual audit is recorded in `docs/SECURITY_AUDIT.md`; it requires breaking framework/test-runner upgrades or replacement of `xlsx`, for which npm reports no fixed release.
