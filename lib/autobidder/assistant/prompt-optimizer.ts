import 'server-only';

import { createHash } from 'node:crypto';
import type { PromptOptimizationContext, PromptRevision } from './contracts';

function appendContext(lines: string[], label: string, value: string | undefined, applied: string[]) {
  const normalized = value?.trim();
  if (!normalized) return;
  lines.push(`- ${label}: ${normalized}`);
  applied.push(label);
}

function appendList(lines: string[], label: string, values: string[] | undefined, applied: string[]) {
  const normalized = (values || []).map((value) => value.trim()).filter(Boolean);
  if (!normalized.length) return;
  lines.push(`- ${label}: ${normalized.join('; ')}`);
  applied.push(label);
}

/**
 * Adds explicit project/evidence constraints around the user's verbatim request.
 * It deliberately does not paraphrase the request, so optimization cannot silently
 * substitute a different user intent.
 */
export function optimizeProjectPrompt(input: {
  prompt: string;
  context?: PromptOptimizationContext;
  now?: Date;
}): PromptRevision {
  if (!input.prompt.trim()) {
    throw new Error('Prompt optimization requires a non-empty prompt.');
  }

  const context = input.context || {};
  const contextLines: string[] = [];
  const appliedContext: string[] = [];
  appendContext(contextLines, 'Project', context.projectName, appliedContext);
  appendContext(contextLines, 'Project ID', context.projectId, appliedContext);
  appendContext(contextLines, 'Sheet', context.sheet, appliedContext);
  appendContext(contextLines, 'Unit type', context.unitType, appliedContext);
  appendList(contextLines, 'Cabinet terminology', context.cabinetTerminology, appliedContext);
  appendContext(contextLines, 'Authoritative workbook', context.workbookName, appliedContext);
  appendList(contextLines, 'Requested evidence', context.requestedEvidence, appliedContext);
  appendList(contextLines, 'QA criteria', context.qaCriteria, appliedContext);
  appendContext(contextLines, 'Desired output', context.desiredOutputStructure, appliedContext);

  const optimizedParts = [
    'Preserve the exact intent of the original request below. Do not broaden it, infer unsupported facts, or perform authoritative estimate arithmetic, approvals, or workflow changes.',
    '',
    'Original request (verbatim):',
    input.prompt,
  ];
  if (contextLines.length) {
    optimizedParts.push('', 'Relevant active-project context:', ...contextLines);
  }
  optimizedParts.push(
    '',
    'Answer only from persisted project records. Cite each factual project claim to its underlying plan evidence, workbook row, mapping, QA issue, workflow record, or audit event. State clearly when the records do not support an answer.',
  );

  const optimizedPrompt = optimizedParts.join('\n');
  const createdAt = (input.now || new Date()).toISOString();
  const revisionId = `prompt-revision-${createHash('sha256')
    .update(`${createdAt}\u0000${input.prompt}\u0000${JSON.stringify(context)}`)
    .digest('hex')
    .slice(0, 20)}`;

  return {
    revisionId,
    createdAt,
    originalPrompt: input.prompt,
    optimizedPrompt,
    preview: optimizedPrompt,
    intentPreserved: true,
    appliedContext,
    undo: {
      available: true,
      restoresPrompt: input.prompt,
    },
  };
}

export function undoPromptRevision(revision: PromptRevision): string {
  return revision.originalPrompt;
}
