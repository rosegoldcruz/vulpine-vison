import 'server-only';

import { z } from 'zod';

export const createProjectSchema = z.object({
  projectName: z.string().min(1).max(120),
});

export const processJobSchema = z.object({
  jobId: z.string().min(1),
});

export const approveUnitMixSchema = z.object({
  approvedBy: z.string().min(1).default('operator'),
});

export const resolveMappingSchema = z.object({
  cabinetFamily: z.string().min(1),
  mappedSku: z.string().min(1),
  unitCostCents: z.number().int().nonnegative(),
  overrideReason: z.string().min(1),
  overrideUser: z.string().min(1),
});

export const exportSchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
});
