# AUTOBIDDER_AUDIT

## Repository
- Path: /opt/vulpine-vision
- Date: 2026-09-18

## Current Architecture
- Frontend: Vite React SPA
- Backend: Express in /server.ts
- Shared domain model: absent (types duplicated inline)
- Persistence: in-memory Map + browser localStorage

## Frontend Entrypoints
- /index.html
- /src/main.tsx
- /src/App.tsx

## Backend Entrypoints
- /server.ts via npm script dev=start tsx server.ts
- Production start depends on built dist/server.cjs

## Upload Routes and Strategy
- POST /api/convert
- upload middleware: multer memory storage (50MB)
- accepts single file field named pdf and optional workbook
- ZIP extraction via adm-zip

## Storage Strategy
- Server: inMemoryJobs Map in /server.ts
- Browser: localStorage key raster_jobs
- No database layer, no repository abstraction

## PDF / Workbook / ZIP Libraries
- PDF: pdfjs-dist
- Rasterization: canvas
- Workbook: xlsx
- ZIP: adm-zip

## AI/Model Integrations
- @google/genai
- /api/chat endpoint directly calls model generateContent
- GEMINI_API_KEY read from process.env

## Environment Variables Referenced
- GEMINI_API_KEY
- NODE_ENV
- APP_URL documented in .env.example but not actively used in runtime code

## Workflow State Implementation
- States (partial): pending_workbook, workbook_ingested, cabinet_pages_classified, cabinet_takeoff_draft, unit_mix_required, pricing_mapping_required, cabinet_bid_review_required, cabinet_bid_safe_to_send
- State transitions implemented in ad hoc function sequencing
- Transition validation is partial

## Tests Present
- No /tests directory present
- No automated coverage for uploads/parsing/workflow gates/export

## Missing Tests
- PDF upload
- multi-PDF upload
- ZIP extraction including nested directories
- workbook upload + schema detection
- workflow transitions and blocked states
- unit mix approval path
- deterministic mapping and pricing checks
- export correctness

## Fake/Mock/Hardcoded Findings
- Random classification in server logic: BROKEN for production reliability
- Hardcoded takeoff + unit mix: MOCKED
- Sample final totals: MOCKED
- UI estimated timers/progress simulation: PARTIAL/MOCKED
- Footer output path and infra labels appear decorative: PARTIAL

## Dead or Duplicate Logic Risks
- Business types duplicated across frontend and backend inline interfaces
- UI contains workflow assumptions duplicated from backend states
- Monolithic App.tsx (>1000 lines) mixes UI + orchestration logic
- Monolithic server.ts mixes routing + domain + parser + AI + export

## Feature Reality Classification
- File upload UI: VERIFIED (code exists and request path wired)
- PDF/ZIP ingestion backend path: PARTIAL (exists, no persistence guarantees, full-page raster approach expensive)
- Workbook ingestion: PARTIAL (basic parsing only)
- Workflow state machine: PARTIAL (states exist, includes mock branches)
- Unit mix extraction: MOCKED
- Cabinet takeoff extraction: MOCKED
- SKU mapping: PARTIAL (deterministic against parsed workbook rows but based on mocked takeoff)
- Pricing calculation: PARTIAL (deterministic math but depends on mocked upstream data)
- QA gate: PARTIAL (basic unresolved checks)
- Export CSV/JSON: VERIFIED (endpoint exists)
- Production-safe persistence: BROKEN (in-memory only)
- Next.js architecture: NOT IMPLEMENTED

## Known Runtime Failures Observed
- npm run dev failed without installed dependencies: tsx not found
- npm run start failed before build: dist/server.cjs missing

## Migration Decision Summary
- Move to Next.js App Router + Route Handlers.
- Keep useful UI concepts but split into focused components.
- Move backend logic to /lib with server-only boundaries.
- Introduce canonical shared types + storage abstraction.
- Remove prototype/mocked pipeline outputs from production path.
