import 'server-only';

import type { BidJob, ProjectManifest } from '@/types';
import type { ProjectAssistantContext } from './contracts';

export function buildProjectAssistantContext(
  project: ProjectManifest,
  job: BidJob,
): ProjectAssistantContext {
  if (project.projectId !== job.projectId || job.manifest.projectId !== project.projectId) {
    throw new Error('Project assistant context requires matching project and BidJob identifiers.');
  }

  return {
    project,
    job,
    workflowState: job.state,
  };
}
