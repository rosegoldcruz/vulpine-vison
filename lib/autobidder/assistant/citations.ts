import 'server-only';

import type {
  AssistantCitation,
  AssistantCitationKind,
  ProjectAssistantContext,
} from './contracts';

function cleanPart(value: string | number | undefined): string {
  return String(value ?? 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
}

export function citationId(kind: AssistantCitationKind, ...parts: Array<string | number | undefined>): string {
  return [kind, ...parts].map(cleanPart).join(':');
}

export function projectCitation(context: ProjectAssistantContext): AssistantCitation {
  return {
    id: citationId('project', context.project.projectId),
    kind: 'project',
    projectId: context.project.projectId,
    jobId: context.job.id,
    entityId: context.project.projectId,
    label: `Project ${context.project.projectName}`,
  };
}

export function workflowCitation(context: ProjectAssistantContext): AssistantCitation {
  return {
    id: citationId('workflow', context.job.id, context.job.state),
    kind: 'workflow',
    projectId: context.project.projectId,
    jobId: context.job.id,
    entityId: context.job.id,
    label: `BidJob ${context.job.id} workflow state ${context.job.state}`,
  };
}
