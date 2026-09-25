import { describe, expect, it } from 'vitest';

import {
  LEADS_HANDOFF_AUTH_HEADER,
  LEADS_HANDOFF_VERSION,
  leadsHandoffRequestV1Schema,
} from '@/lib/platform/contracts/leads-handoff-v1';

describe('Leads handoff contract v1', () => {
  it('parses minimal valid payload and applies sourceSystem default', () => {
    const parsed = leadsHandoffRequestV1Schema.parse({
      projectName: 'Atlas Residences - Bid Package',
      leadId: 'lead-123',
    });

    expect(parsed.projectName).toBe('Atlas Residences - Bid Package');
    expect(parsed.leadId).toBe('lead-123');
    expect(parsed.sourceSystem).toBe('vulpine-leads');
  });

  it('rejects malformed payloads', () => {
    const result = leadsHandoffRequestV1Schema.safeParse({
      projectName: '',
      leadId: '',
      contactEmail: 'not-an-email',
      correlationId: 'short',
    });

    expect(result.success).toBe(false);
  });

  it('exports stable integration constants', () => {
    expect(LEADS_HANDOFF_VERSION).toBe('v1');
    expect(LEADS_HANDOFF_AUTH_HEADER).toBe('x-integration-key');
  });
});
