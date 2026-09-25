export const runtime = 'nodejs';

import { asApiServiceError } from '@/lib/autobidder/api/errors';
import { fail } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { readExportArtifact } from '@/lib/autobidder/services/export-artifact-service';
import { assertBidJobAccess } from '@/lib/autobidder/auth/resource-access';
import { getDatabase } from '@/lib/autobidder/db/database';

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(req);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    const ownership = getDatabase().prepare('SELECT bid_job_id FROM export_artifacts WHERE id=?').get(id) as { bid_job_id: string } | undefined;
    if (!ownership) return fail({ code: 'EXPORT_NOT_FOUND', message: 'Export artifact not found.' }, 404);
    assertBidJobAccess(ownership.bid_job_id, principal);
    const { artifact, bytes } = await readExportArtifact(id);
    return new Response(bytes, {
      headers: {
        'Content-Type': artifact.mimeType || 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `attachment; filename="cabinet-${artifact.bidJobId}-${artifact.id}.${artifact.format === 'review_pdf' ? 'pdf' : artifact.format}"`,
        'ETag': `"${artifact.sha256}"`,
        'Cache-Control': 'private, immutable, max-age=31536000',
      },
    });
  } catch (error) {
    const typed = asApiServiceError(error);
    return fail({ code: typed.code, message: typed.message, details: typed.details }, typed.status);
  }
}
