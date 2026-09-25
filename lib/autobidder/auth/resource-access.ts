import 'server-only';

import type { Principal } from '@/types/canonical';
import { ApiServiceError } from '@/lib/autobidder/api/errors';
import { getDatabase } from '@/lib/autobidder/db/database';

function assertOrganization(organizationId: string | undefined, principal: Principal, resource: string) {
  if (!organizationId || organizationId !== principal.organizationId) {
    throw new ApiServiceError('NOT_FOUND', `${resource} not found.`, 404);
  }
}

export function assertProjectAccess(projectId: string, principal: Principal) {
  const row = getDatabase().prepare('SELECT organization_id FROM projects WHERE id=?').get(projectId) as { organization_id: string } | undefined;
  assertOrganization(row?.organization_id, principal, 'Project');
}

export function assertBidJobAccess(jobId: string, principal: Principal) {
  const row = getDatabase().prepare(`SELECT p.organization_id FROM bid_jobs b JOIN projects p ON p.id=b.project_id WHERE b.id=?`).get(jobId) as { organization_id: string } | undefined;
  assertOrganization(row?.organization_id, principal, 'Bid job');
}

export function assertRunAccess(runId: string, principal: Principal) {
  const row = getDatabase().prepare(`SELECT p.organization_id FROM job_runs r JOIN bid_jobs b ON b.id=r.bid_job_id JOIN projects p ON p.id=b.project_id WHERE r.id=?`).get(runId) as { organization_id: string } | undefined;
  assertOrganization(row?.organization_id, principal, 'Processing run');
}
