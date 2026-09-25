import 'server-only';

import { z } from 'zod';

export const LEADS_HANDOFF_VERSION = 'v1' as const;
export const LEADS_HANDOFF_AUTH_HEADER = 'x-integration-key' as const;

export const leadsHandoffRequestV1Schema = z.object({
  projectName: z.string().min(1).max(120),
  sourceSystem: z.string().min(1).max(80).default('vulpine-leads'),
  leadId: z.string().min(1).max(120),
  accountName: z.string().min(1).max(160).optional(),
  contactName: z.string().min(1).max(120).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().min(3).max(50).optional(),
  opportunityName: z.string().min(1).max(180).optional(),
  notes: z.string().max(2000).optional(),
  attachmentRefs: z.array(z.string().min(1).max(300)).max(100).optional(),
  correlationId: z.string().min(8).max(120).optional(),
});

export type LeadsHandoffRequestV1 = z.infer<typeof leadsHandoffRequestV1Schema>;
