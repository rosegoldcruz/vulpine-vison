# NEXTJS_MIGRATION_AUDIT

## Scope
Repository audited: /opt/vulpine-vision
Date: 2026-09-18

## Current Architecture (Before Migration)
- Frontend framework: Vite + React SPA
- Frontend entrypoints:
  - index.html -> /src/main.tsx
  - /src/main.tsx -> /src/App.tsx
- Backend framework: Express server started from /server.ts via tsx
- Backend/frontend coupling: one monolithic server with NDJSON streaming + one monolithic UI page
- Runtime mode: Vite middleware in dev; static dist serving in production

## Evidence Files
- package scripts: /package.json
- frontend app: /src/App.tsx
- backend server and APIs: /server.ts
- vite config: /vite.config.ts
- environment sample: /.env.example

## Current API Surface
From /server.ts:
- POST /api/convert
- POST /api/jobs/:id/approve
- POST /api/jobs/:id/resolve
- GET /api/jobs/:id/export
- POST /api/chat

## Data/Workflow Findings
- Job persistence: in-memory Map only (lost on restart)
- Browser persistence: localStorage key raster_jobs
- Workflow state exists but mixed with mock behavior
- NDJSON streaming in /api/convert

## Parsing/Processing Findings
- Upload handling: multer in-memory, single field pdf, optional workbook
- ZIP extraction: adm-zip, supports PDFs and image files in zip
- PDF processing: pdfjs-dist + canvas rasterization (all pages)
- Workbook parsing: xlsx first sheet, loose column heuristics
- AI integration: @google/genai in /api/chat, optional in processing flow

## Mock/Prototype Risks Identified
- Random page classification using Math.random
- Hardcoded/mock extraction text
- Hardcoded takeoff rows
- Hardcoded unit mix rows
- Sample total generation (not deterministic pricing from real takeoff)
- Multiple UI labels indicate sample/demo behavior

## Keep / Move / Rewrite / Delete

### KEEP
- Existing React UI concepts and section labels (Ingestion Hub, Workflow Control Center, Workspace Draft Viewer)
- Existing PDF + ZIP + workbook libraries where feasible
- Existing chat integration concept (migrate to Next route handler)

### MOVE
- Server-side business logic from /server.ts into /lib/autobidder/*
- API routes from Express into Next Route Handlers under /app/api/**/route.ts
- Workflow state model into domain layer
- Shared types into canonical /types files used by UI and server

### REWRITE
- App shell from Vite SPA entrypoints to Next App Router (app/layout.tsx, app/page.tsx)
- Upload and processing split into separate actions with persisted job state
- Error contract to consistent { ok: false, error: { code, message, details } }
- Validation via Zod on API inputs

### DELETE
- Architectural dependency on Express runtime for production
- Reliance on localStorage as source-of-truth for jobs
- Fake totals/mock workflow output from production pipeline

## Migration Plan (Phase Zero)
1. Introduce Next.js App Router + route handlers and runtime configuration.
2. Create canonical types and domain workflow transition rules.
3. Create repository abstraction with temporary file-backed storage.
4. Port upload ingestion into server-side services under /lib with Node runtime.
5. Port workflow actions and chat endpoint to route handlers.
6. Build a focused client page that supervises backend state rather than simulating it.
7. Add migration-focused tests for parsers, transitions, and route contracts.
8. Verify no Express server is required to run app.
