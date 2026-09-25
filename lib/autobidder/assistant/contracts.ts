import 'server-only';

import type { BidJob, ProjectManifest, WorkflowState } from '@/types';

export const PROJECT_ASSISTANT_QUERY_TOOLS = [
  'workflow_status',
  'unresolved_cabinets',
  'mapping_explanation',
  'workbook_rows',
  'qa_blockers',
  'remaining_actions',
  'audit_summary',
] as const;

export type ProjectAssistantQueryTool = (typeof PROJECT_ASSISTANT_QUERY_TOOLS)[number];

export type AssistantCitationKind =
  | 'project'
  | 'workflow'
  | 'plan_evidence'
  | 'takeoff'
  | 'sku_mapping'
  | 'workbook_row'
  | 'qa_issue'
  | 'audit_event';

export interface AssistantCitation {
  id: string;
  kind: AssistantCitationKind;
  projectId: string;
  jobId: string;
  entityId: string;
  label: string;
  sourceDocument?: string;
  sourcePage?: number;
  sourceSheet?: string;
  sourceView?: string;
  sourceWorkbook?: string;
  sourceRow?: number;
}

export interface AssistantFact {
  text: string;
  citations: AssistantCitation[];
}

export interface AssistantQueryResult<T = unknown> {
  tool: ProjectAssistantQueryTool;
  projectId: string;
  jobId: string;
  readOnly: true;
  data: T;
  facts: AssistantFact[];
  limitations: string[];
}

export interface ProjectAssistantContext {
  project: Readonly<ProjectManifest>;
  job: Readonly<BidJob>;
  workflowState: WorkflowState;
}

export type ProjectAssistantToolRequest =
  | { tool: 'workflow_status'; args?: Record<string, never> }
  | { tool: 'unresolved_cabinets'; args?: { unitType?: string } }
  | { tool: 'mapping_explanation'; args: { cabinetFamily?: string; sku?: string } }
  | { tool: 'workbook_rows'; args?: { sku?: string; usedOnly?: boolean } }
  | { tool: 'qa_blockers'; args?: Record<string, never> }
  | { tool: 'remaining_actions'; args?: Record<string, never> }
  | { tool: 'audit_summary'; args?: { limit?: number } };

export type AssistantPolicyCode =
  | 'READ_ONLY_ALLOWED'
  | 'AUTHORITATIVE_ARITHMETIC_FORBIDDEN'
  | 'APPROVAL_FORBIDDEN'
  | 'STATE_CHANGE_FORBIDDEN'
  | 'MUTATION_FORBIDDEN'
  | 'UNKNOWN_TOOL_FORBIDDEN';

export interface AssistantToolPolicyDecision {
  allowed: boolean;
  readOnly: boolean;
  code: AssistantPolicyCode;
  reason: string;
}

export type ProviderConnectivityStatus =
  | 'DISCONNECTED'
  | 'CONFIGURED_UNVERIFIED'
  | 'AVAILABLE'
  | 'DEGRADED'
  | 'UNAVAILABLE';

export interface ProviderProbeResult {
  ok: boolean;
  checkedAt: string;
  latencyMs?: number;
  errorCode?: string;
  detail?: string;
}

export interface ProviderConnectivityInput {
  providerId: string;
  displayName: string;
  capabilities: Array<'text' | 'voice' | 'realtime' | 'transcription'>;
  requiredConfiguration: string[];
  configuredConfiguration: string[];
  probe?: ProviderProbeResult;
  fallbackProviderId?: string;
}

export interface ProviderConnectivityState {
  providerId: string;
  displayName: string;
  status: ProviderConnectivityStatus;
  connected: boolean;
  capabilities: ProviderConnectivityInput['capabilities'];
  missingConfiguration: string[];
  fallbackProviderId?: string;
  checkedAt?: string;
  latencyMs?: number;
  errorCode?: string;
  detail: string;
}

export interface PromptOptimizationContext {
  projectId?: string;
  projectName?: string;
  sheet?: string;
  unitType?: string;
  cabinetTerminology?: string[];
  workbookName?: string;
  requestedEvidence?: string[];
  qaCriteria?: string[];
  desiredOutputStructure?: string;
}

export interface PromptRevision {
  revisionId: string;
  createdAt: string;
  originalPrompt: string;
  optimizedPrompt: string;
  preview: string;
  intentPreserved: true;
  appliedContext: string[];
  undo: {
    available: true;
    restoresPrompt: string;
  };
}
