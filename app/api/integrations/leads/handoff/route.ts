export const runtime = 'nodejs';

import { fail } from '@/lib/autobidder/api/response';

export async function POST(_request: Request) {
  // The legacy shared-key contract has no verified organization principal.
  // Keep project creation unavailable until its caller contract is provisioned.
  return fail({
    code: 'HANDOFF_AUTH_NOT_CONFIGURED',
    message: 'Organization-bound lead handoff authentication is not configured.',
  }, 503);
}
