import 'server-only';

import {
  PROJECT_ASSISTANT_QUERY_TOOLS,
  type AssistantToolPolicyDecision,
  type ProjectAssistantQueryTool,
} from './contracts';

const readOnlyTools = new Set<string>(PROJECT_ASSISTANT_QUERY_TOOLS);

const authoritativeArithmetic = /(?:calculate|compute|compile).*(?:bid|estimate|price|pricing|total)|authoritative.*(?:arithmetic|total)/i;
const approval = /approve|approval|safe[_ -]?to[_ -]?send|verify[_ -]?unit[_ -]?mix/i;
const stateChange = /transition|advance|change[_ -]?(?:state|workflow)|mark[_ -]?(?:safe|complete)|export/i;
const mutation = /create|update|delete|remove|override|resolve|write|edit|send[_ -]?bid/i;

export function evaluateAssistantToolPolicy(toolName: string): AssistantToolPolicyDecision {
  if (readOnlyTools.has(toolName)) {
    return {
      allowed: true,
      readOnly: true,
      code: 'READ_ONLY_ALLOWED',
      reason: 'Tool is an allowlisted, deterministic read-only project query.',
    };
  }

  if (authoritativeArithmetic.test(toolName)) {
    return {
      allowed: false,
      readOnly: false,
      code: 'AUTHORITATIVE_ARITHMETIC_FORBIDDEN',
      reason: 'The assistant may explain persisted calculations but may not perform authoritative estimate arithmetic.',
    };
  }
  if (approval.test(toolName)) {
    return {
      allowed: false,
      readOnly: false,
      code: 'APPROVAL_FORBIDDEN',
      reason: 'The assistant may describe approval status but may not approve or verify controlled workflow gates.',
    };
  }
  if (stateChange.test(toolName)) {
    return {
      allowed: false,
      readOnly: false,
      code: 'STATE_CHANGE_FORBIDDEN',
      reason: 'The assistant may explain workflow state but may not transition state or trigger exports.',
    };
  }
  if (mutation.test(toolName)) {
    return {
      allowed: false,
      readOnly: false,
      code: 'MUTATION_FORBIDDEN',
      reason: 'The assistant query surface is read-only and rejects mutations.',
    };
  }

  return {
    allowed: false,
    readOnly: false,
    code: 'UNKNOWN_TOOL_FORBIDDEN',
    reason: 'Unknown tools are denied by default.',
  };
}

export function assertAssistantQueryTool(toolName: string): asserts toolName is ProjectAssistantQueryTool {
  const decision = evaluateAssistantToolPolicy(toolName);
  if (!decision.allowed) {
    throw new Error(`${decision.code}: ${decision.reason}`);
  }
}
