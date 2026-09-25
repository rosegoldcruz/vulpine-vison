export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { readBackofficeAnalytics } from '@/lib/backoffice/service';
import type { CompletedBidFilters, CompletedBidGroup } from '@/lib/backoffice/analytics';

const GROUPS = new Set<CompletedBidGroup>(['project', 'customer', 'date', 'bid_status', 'market', 'consultant', 'cabinet_line']);

function csv(value: string | null): string[] | undefined {
  const values = value?.split(',').map((item) => item.trim()).filter(Boolean);
  return values?.length ? values : undefined;
}

export async function GET(request: Request) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const search = new URL(request.url).searchParams;
    const requestedGroup = search.get('groupBy') as CompletedBidGroup | null;
    if (requestedGroup && !GROUPS.has(requestedGroup)) {
      return fail({ code: 'VALIDATION_FAILED', message: 'groupBy is invalid.' }, 400);
    }
    const filters: CompletedBidFilters = {
      projectIds: csv(search.get('projectIds')),
      customerIds: csv(search.get('customerIds')),
      statuses: csv(search.get('statuses')) as CompletedBidFilters['statuses'],
      markets: csv(search.get('markets')),
      consultants: csv(search.get('consultants')),
      cabinetLines: csv(search.get('cabinetLines')),
      from: search.get('from') || undefined,
      to: search.get('to') || undefined,
    };
    return ok(readBackofficeAnalytics({ organizationId: principal.organizationId, completedGroupBy: requestedGroup || 'project', completedFilters: filters }));
  } catch (error: any) {
    return fail({ code: error.code || 'ANALYTICS_READ_FAILED', message: error.message || 'Failed to calculate analytics.' }, error.status || 500);
  }
}
