# CABINET_INTELLIGENCE_AUDIT

Repository: /opt/vulpine-vision
Date: 2026-09-18

## Scope
Audit of estimator-specific logic related to unit mix, takeoff, cabinet classification, normalization, SKU mapping, pricing, QA and safe-to-send gates.

## Classification Key
- UNVERIFIED
- MOCKED
- PARTIAL
- DANGEROUS
- REUSABLE_INFRASTRUCTURE

## Findings

### legacy/vite-prototype/server.ts
- CabinetWorkbookIngestionAgent: PARTIAL
  - Parses workbook rows with loose column matching.
  - No robust schema validation or traceability guarantees.
- CabinetPlanClassifierAgent: MOCKED + DANGEROUS
  - Uses random classification (`Math.random`) for page types.
- CabinetPageExtractorAgent: MOCKED
  - Injects synthetic extraction strings.
- CabinetTakeoffAgent: MOCKED + DANGEROUS
  - Hardcoded takeoff rows, not drawing-derived.
- UnitMixAgent: MOCKED + DANGEROUS
  - Hardcoded unit mix rows.
- CabinetSkuMapperAgent: PARTIAL
  - Deterministic lookup against workbook rows but built on mocked takeoff.
- CabinetEstimateAgent: PARTIAL
  - Deterministic multiplication logic but fed by mocked upstream structures.
- CabinetQaAgent: PARTIAL
  - Basic unresolved checks only; not full mandatory gate model.
- sampleTotal generation branch: MOCKED + DANGEROUS
  - Synthetic bid totals using arbitrary formula.
- safe-to-send promotion in prototype: DANGEROUS
  - Could mark output final on mocked pipeline data.

Current status: quarantined in legacy runtime path and not used by production scripts.

### legacy/vite-prototype/src/App.tsx
- UI-driven estimator workflow assumptions: MOCKED/PARTIAL
- Simulated progress and estimated durations: MOCKED
- LocalStorage as workflow truth: DANGEROUS for production
- Manual resolve prompts: PARTIAL

Current status: quarantined in legacy runtime path and not used by production scripts.

### lib/autobidder/services/workflow-service.ts
- Workflow plumbing and state transitions: REUSABLE_INFRASTRUCTURE
- Unit mix extraction: UNVERIFIED (intentionally returns empty)
- Takeoff generation: UNVERIFIED (intentionally absent)
- SKU mapping and pricing execution endpoints: DISABLED via `ESTIMATOR_INTELLIGENCE_DISABLED`
- SAFE_TO_SEND: forced false by quarantine marker `SAFE_TO_SEND_QUARANTINED`

Current status: active production path with estimator intelligence disabled.

### lib/autobidder/services/pdf-service.ts
- PDF metadata and text extraction: REUSABLE_INFRASTRUCTURE
- Keyword-based sheet classification: PARTIAL/UNVERIFIED
  - Heuristic-only and not accepted as estimator intelligence.

### lib/autobidder/services/workbook-parser.ts
- Workbook ingestion and traceability: REUSABLE_INFRASTRUCTURE
- Cabinet row mapping assumptions: PARTIAL
  - Column heuristics may require stronger schema contracts for production estimator.

### types/* workflow/estimator models
- Canonical type definitions: REUSABLE_INFRASTRUCTURE
- Does not validate estimator correctness by itself.

## Quarantine Actions Completed
- Legacy prototype runtime moved to:
  - legacy/vite-prototype/server.ts
  - legacy/vite-prototype/src/App.tsx
  - legacy/vite-prototype/src/main.tsx
  - legacy/vite-prototype/index.html
  - legacy/vite-prototype/vite.config.ts
- Estimator-sensitive endpoints now blocked by design:
  - `/api/jobs/[id]/approve-unit-mix` returns `INVALID_STATE_TRANSITION` or `ESTIMATOR_INTELLIGENCE_DISABLED`
  - `/api/jobs/[id]/resolve` returns `ESTIMATOR_INTELLIGENCE_DISABLED`
- SAFE_TO_SEND remains disabled globally in active workflow service.

## Verified Infrastructure Kept
- Next.js App Router and Route Handlers
- Upload ingestion and ZIP extraction safeguards
- PDF metadata/text ingestion path
- Workbook ingestion path with schema discovery and traceability
- File-backed project/job persistence across restart
- Canonical API error contract
- Server-only module boundaries

## New Estimator Core Scaffold
Created for rebuild-from-first-principles:
- lib/autobidder/estimator/rules
- lib/autobidder/estimator/observations
- lib/autobidder/estimator/unit-mix
- lib/autobidder/estimator/takeoff
- lib/autobidder/estimator/normalization
- lib/autobidder/estimator/sku-mapper
- lib/autobidder/estimator/pricing
- lib/autobidder/estimator/qa
- lib/autobidder/estimator/traceability

## Quarantine Conclusion
- No pre-existing prototype estimator intelligence is trusted.
- Existing estimator behavior is either quarantined to legacy files or explicitly disabled in active runtime.
- Infrastructure remains active and validated for Phase Zero ingestion/testing goals.
