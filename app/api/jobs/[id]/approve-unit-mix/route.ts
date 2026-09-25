export const runtime = 'nodejs';

import { fail } from '@/lib/autobidder/api/response';
import { withVisionUserOrIntegration } from '@/lib/platform/integration-auth';

async function legacyUnitMixApprovalDisabled() {
  return fail(
    {
      code: 'LEGACY_ROUTE_DISABLED',
      message: 'Legacy unit-mix approval is disabled. Use the canonical unit-mix verification route.',
      details: { replacement: '/api/jobs/:id/unit-mix/verify' },
    },
    410,
  );
}

export const POST = withVisionUserOrIntegration(
  'unit_mix:approve',
  'POST /api/jobs/:id/approve-unit-mix',
  legacyUnitMixApprovalDisabled,
);
