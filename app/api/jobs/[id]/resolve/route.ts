export const runtime = 'nodejs';

import { fail } from '@/lib/autobidder/api/response';
import { withVisionUserOrIntegration } from '@/lib/platform/integration-auth';

async function legacyMappingResolutionDisabled() {
  return fail(
    {
      code: 'LEGACY_ROUTE_DISABLED',
      message: 'Legacy SKU resolution is disabled. Use the canonical mapping-resolution route.',
      details: { replacement: '/api/jobs/:id/mappings/resolve' },
    },
    410,
  );
}

export const POST = withVisionUserOrIntegration(
  'sku:override',
  'POST /api/jobs/:id/resolve',
  legacyMappingResolutionDisabled,
);
