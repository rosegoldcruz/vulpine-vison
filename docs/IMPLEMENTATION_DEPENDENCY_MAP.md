# Cabinet Brain Implementation Dependency Map

## Baseline

The production path is the Next.js application under `app/`, `components/`, `lib/`, and `types/`. The richer Vite prototype is quarantined under `legacy/vite-prototype` and is not implementation evidence.

Baseline verification before changes:

- `npm test`: 7 files / 22 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- Real today: upload ingestion, ZIP safety, workbook parsing, PDF metadata/text extraction, heuristic classification, file-backed restart persistence, structured API errors, partial integration authentication.
- Deliberately absent/quarantined: unit mix, takeoff, mapping, pricing, safe-to-send, review workspace, durable job control, production auth/database, exports beyond a blocked prototype route.

## Canonical dependency order

1. **Shared contracts and invariants**
   - Canonical IDs and entities for Project, BidJob, WorkflowState, SourceDocument, PlanSheet, VisionEvidence, UnitType, UnitMixEntry, CabinetInstance, TakeoffLine, CatalogSku, SkuMapping, EstimateLine, QAResult, Approval, AuditEvent, and ExportArtifact.
   - Separate estimating workflow state from operational execution status.
   - Integer minor-unit money, normalized evidence geometry, optimistic version, authenticated actor, immutable provenance links.

2. **Persistence, object storage, and trusted principal**
   - A real relational database with migrations and repository interfaces.
   - Transactional workflow event + audit event writes.
   - Binary/object-storage abstraction for plans, page renders, snippets, and exports.
   - User/service principal separation, project/org authorization, role/action policy.

3. **Controlled compiler (Phase 1)**
   - Workflow transition engine and invalid-attempt recording.
   - Workbook catalog ingestion/validation.
   - Classification/extraction, unit-mix reconciliation and approval, takeoff, deterministic mapping, deterministic quantity/pricing compiler, QA hard stop, review/resolution, provenance graph.

4. **Plan ingestion and evidence workspace (Phase 2)**
   - Manifest/dedupe and per-document identity.
   - Durable high-resolution page artifacts using the same PlanSheet/evidence coordinate contract.
   - Viewer, measurement/markup, and evidence snippets.

5. **Durable execution control (Phase 3)**
   - Asynchronous/idempotent run model, progress events, page/file checkpoints, bounded retry, pause/resume/cancel, heartbeat/stall detection, throughput-based ETA, user settings, persisted diagnostics.

6. **Estimator UI and queue UX (Phases 1, 2, 8)**
   - Implement the approved concept in `docs/design/cabinet-brain-workspace-concept.png` using focused components.
   - UI consumes server truth only and exposes provisional labels, unsafe state, required actions, provenance, queue controls, and meaningful notifications.

7. **Immutable exports (Phase 6)**
   - Versioned JSON/CSV/XLSX and internal review PDF generated from an immutable estimate snapshot.
   - Internal-review and customer-facing policies are distinct; customer artifacts require current QA approval.

8. **Evidence-grounded assistants (Phase 5)**
   - Read-only project query tools/citations first; optimization preview/undo; voice through the same authorization/context path; admin-only repository/runtime assistant.
   - AI never supplies authoritative arithmetic, pricing, workflow transitions, or approvals.

9. **Deal operations (Phase 7)**
   - Separate deal/bid/event model, safe-to-send outreach gate, live pipeline/trends/value aggregation.
   - Provider abstractions for email, company intelligence, and maps with honest `not_configured` states.

10. **Hardening and acceptance (Phase 9)**
    - Storage corruption cannot masquerade as absence; no swallowed exceptions; no browser-authoritative bid data; no legacy mock totals; negative security/concurrency/runtime tests; requirement-by-requirement evidence.

## Shared contract ownership

| Surface | Root-owned contract | Primary consumers |
|---|---|---|
| Workflow | estimating state, transition attempt/history, prerequisites | Phases 1, 3, 6, 8 |
| Execution | run status, progress event, checkpoint, attempt, control request | Phases 2, 3, 8 |
| Evidence | document/sheet/artifact IDs, normalized/PDF coordinates, checksum | Phases 1, 2, 5, 6 |
| Catalog and estimate | immutable workbook record, takeoff/mapping/estimate IDs, money | Phases 1, 5, 6, 7 |
| Identity | Principal, role/action policy, project scope, service scope | All mutation/read surfaces |
| Audit | append-only event with actor, correlation, resource, before/after | Phases 1, 3, 4, 5, 6, 7 |
| Artifacts | object key, MIME, checksum, source snapshot, audience | Phases 2, 6, 7 |

## Merge hotspots

Edits must be serialized around:

- `types/*.ts`
- database schema/migrations
- repositories and `lib/autobidder/services/workflow-service.ts`
- `lib/autobidder/validation/schemas.ts`
- `app/page.tsx`, `app/layout.tsx`, and `components/autobidder/workspace-client.tsx`
- authentication middleware/policy
- `tests/phase-zero-routes.integration.test.ts`

The current dirty worktree contains user/in-flight chat, voice, lead-handoff, validation, environment, UI, and test changes. They must be preserved and integrated rather than overwritten.

## External blockers

Missing credentials do not block internal implementation. Provider-backed behavior must expose disconnected state and is marked `BLOCKED_EXTERNAL` only after the abstraction, configuration validation, authorization, and local fixture tests are complete. Current likely live blockers are company intelligence, maps/routing, outbound email/CRM, and model/voice providers without configured credentials.

