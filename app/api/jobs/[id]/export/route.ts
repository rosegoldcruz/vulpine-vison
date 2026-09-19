export const runtime = 'nodejs';

import { BidJobRepository } from '@/lib/autobidder/repositories/bid-job-repository';
import { fail } from '@/lib/autobidder/api/response';
import { exportSchema } from '@/lib/autobidder/validation/schemas';

function toCsv(job: any) {
  const header = 'line_key,description,quantity,unit_cost_cents,total_cost_cents\n';
  const lines = (job.pricingLines || [])
    .map((line: any) => `${line.key},"${line.description}",${line.quantity},${line.unitCostCents},${line.totalCostCents}`)
    .join('\n');
  return `${header}${lines}\n`;
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));
    const parsed = exportSchema.safeParse(body);
    if (!parsed.success) {
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid export payload.', details: { issues: parsed.error.issues } }, 400);
    }

    const repo = new BidJobRepository();
    const job = await repo.get(id);
    if (!job) {
      return fail({ code: 'NOT_FOUND', message: 'Job not found.', details: {} }, 404);
    }
    if (!job.qaResult.safeToSend) {
      return fail(
        {
          code: 'QA_BLOCK',
          message: 'Bid export is blocked until safe_to_send is true.',
          details: { criticalIssues: job.qaResult.criticalIssues },
        },
        409,
      );
    }

    if (parsed.data.format === 'csv') {
      const csv = toCsv(job);
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="job_${job.id}.csv"`,
        },
      });
    }

    return new Response(JSON.stringify(job, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="job_${job.id}.json"`,
      },
    });
  } catch (error: any) {
    console.error('POST /api/jobs/[id]/export failed', error);
    return fail({ code: 'EXPORT_FAILED', message: error?.message || 'Failed to export job.', details: {} }, 400);
  }
}
