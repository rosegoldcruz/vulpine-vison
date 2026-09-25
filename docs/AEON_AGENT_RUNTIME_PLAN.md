# AEON Agent Runtime Plan (Valerie Core)

## Goal

Move the current chat path from direct model calls into a real turn orchestrator that powers both text and voice through one shared agent core.

Target runtime shape:

1. Input channel: voice or text
2. Transport: API request to chat route
3. Runtime: AEON turn orchestrator
4. Execution loop: model + tools + policy
5. Persistence and audit
6. Output channel: text UI and optional voice playback

This keeps Valerie as one intelligence with one state model, one tool model, and one permission model.

## Non-Goals For Milestone 1

1. No broad tool catalog.
2. No external side effects.
3. No write actions.
4. No email or dialing mutations.
5. No route-level business logic growth.

Milestone 1 proves architecture with read-only tools only.

## Constraints

1. Preserve current working voice and text experience.
2. Keep route thin.
3. Keep agent runtime modular, not a monolith.
4. Enforce permissions from day one, even with read-only tools.
5. Ensure all turns are auditable.

## Proposed Package Layout

Create the following under the Vision app codebase:

1. agent
2. agent/runtime.ts
3. agent/turn.ts
4. agent/context.ts
5. agent/state.ts
6. agent/registry.ts
7. agent/permissions.ts
8. tools
9. tools/types.ts
10. tools/registry.ts
11. tools/dispatcher.ts
12. tools/bids
13. tools/drive
14. tools/vision
15. llm
16. llm/types.ts
17. llm/router.ts
18. llm/providers
19. chat
20. chat/service.ts
21. chat/persistence.ts

## Route Contract (Thin)

The chat route should only do:

1. authenticate actor
2. validate request
3. invoke agent runtime turn
4. return or stream response

No tool logic. No model routing policy details. No context assembly.

## Runtime Responsibilities

The orchestrator handles these steps per turn:

1. authenticate actor identity and org scope
2. identify target agent persona (Valerie)
3. load conversation state
4. load relevant context for this turn
5. select model and capabilities
6. expose permitted tools
7. call model with tool schema
8. capture tool requests
9. dispatch and execute permitted tools
10. feed tool results back to model
11. repeat loop until completion rule is met
12. persist transcript, tool usage, and audit events

## Tooling Scope (Milestone 1)

Read-only tools only:

1. search_projects
2. get_project
3. get_latest_bid
4. search_documents

All tools must return typed, structured payloads and must be org-scoped.

## Permission Model

Implement tiering now, even though Milestone 1 is read-only:

1. READ: automatic
2. PREPARE: automatic
3. WRITE_INTERNAL: authorized users only
4. EXTERNAL_ACTION: approval required
5. FINANCIAL_CONTRACTUAL: explicit approval required

Milestone 1 tools are READ tier.

## Model and Provider Policy

Keep existing policy while introducing runtime abstractions:

1. non-voice turns continue Muse contributor path
2. voice transport stays current implementation path
3. backend turn reasoning always uses AEON runtime path
4. model provider decisions live in llm/router.ts, not routes

## Context Strategy (Milestone 1)

Start minimal and deterministic:

1. active conversation history
2. actor identity and org
3. latest referenced project ids in session
4. top document snippets from search_documents

Avoid broad retrieval or heavy memory layers in first cut.

## State and Persistence

Introduce turn records with:

1. turn id
2. conversation id
3. actor id
4. input channel (text or voice)
5. selected model
6. tool calls requested
7. tool calls executed
8. policy decisions
9. final response
10. timestamps

Persist this through chat/persistence.ts and keep append-only audit semantics.

## Delivery Phases

### Phase 1: Skeleton and Contracts

1. scaffold agent, tools, llm, and chat modules
2. define shared types for turn, tool, permission, and result envelopes
3. move current chat service entrypoint behind agent/runtime.ts

Exit criteria:

1. route compiles and delegates to runtime
2. no behavior regression for text path

### Phase 2: Single-Turn Runtime Without Tool Loop

1. implement runtime step sequence minus tool execution loop
2. load Valerie system prompt from configured prompt file
3. persist turn audit skeleton

Exit criteria:

1. text and voice-backed requests both hit runtime
2. response quality unchanged
3. turn audit rows are persisted

### Phase 3: Read-Only Tool Loop

1. add tool schema exposure to model calls
2. implement dispatcher with four read-only tools
3. implement iterative loop with max-iteration guard

Exit criteria:

1. model can request tools and receive typed results
2. real data can answer project and bid lookup queries
3. full loop is auditable

### Phase 4: Policy and Approval Harness

1. enforce permission layer around tool calls
2. introduce approval event shape for non-read tiers
3. keep non-read tools disabled for now

Exit criteria:

1. READ tools auto-run
2. non-READ calls are blocked or flagged cleanly

### Phase 5: Voice and Text Unification Hardening

1. ensure both channels produce identical runtime behavior
2. ensure channel-specific output shaping only at I/O edges
3. verify no alternate shadow runtime exists for voice

Exit criteria:

1. one runtime path, two channels
2. parity tests pass

## Streaming

Add runtime event streaming after loop stability, not before:

1. start with synchronous final response path
2. then stream structured runtime events
3. finally stream partial assistant content where useful

## Reliability Guards

1. max tool loop iterations per turn
2. per-tool timeout
3. circuit breaker for repeated tool failures
4. strict JSON parsing and schema validation
5. no silent fallbacks on policy-denied operations

## Security and Governance

1. require actor and org context on every tool call
2. redact sensitive data in logs where required
3. persist policy decisions in audit trail
4. never execute external side effects without appropriate permission tier

## Initial Test Matrix

1. route remains thin and delegates to runtime
2. runtime loads Valerie prompt from configured file
3. runtime performs read-only tool loop to completion
4. runtime rejects unauthorized non-read tool intents
5. runtime persists turn audit data
6. voice and text channel parity for same question

## Acceptance Criteria For Milestone 1

1. User asks for project status and latest bid details.
2. Agent uses read-only tools to fetch real data.
3. Agent answers with grounded, cited result context.
4. No write-side effects occur.
5. Turn audit shows full loop and tool usage.

## Migration Notes

1. Keep existing LLM service implementation available while runtime is introduced.
2. Incrementally reroute calls to new runtime from chat/service.ts.
3. Avoid stuffing new orchestration logic into the route file.

## Immediate Implementation Checklist

First commit (skeleton only):

1. add agent/runtime.ts with runTurn entrypoint signature
2. add agent/types for turn context and turn result
3. add tools/types.ts with tool contract and permission tier enum
4. add tools/registry.ts with four read-only tool stubs
5. add llm/router.ts adapter that wraps existing llm service
6. update chat/service.ts to call runtime.runTurn
7. keep app/api/chat/route.ts unchanged except delegation target

Second commit (working loop v1):

1. implement tool dispatcher for read-only tools
2. implement one iterative loop with max loop guard
3. persist turn audit envelope in chat/persistence.ts
4. add tests for a project lookup turn with two tool calls

Third commit (voice parity validation):

1. assert voice-originated turn hits identical runtime path
2. assert response parity for equivalent text and voice prompts
3. verify no direct model-only response path bypasses runtime
