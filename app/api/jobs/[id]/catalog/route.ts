export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { getCanonicalBidSnapshot } from '@/lib/autobidder/services/canonical-bid-service';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    return ok({ rows: getCanonicalBidSnapshot(id, principal).catalogSkus });
  } catch (error: any) {
    return fail({ code: error.code || 'CATALOG_READ_FAILED', message: error.message || 'Failed to read catalog.', details: error.details }, error.status || 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'pricing:change');
    await context.params;
    return fail({
      code: 'SERVER_INGESTION_ONLY',
      message: 'Authoritative catalog rows are parsed from the uploaded workbook by the server and cannot be supplied by a browser client.',
    }, 403);
  } catch (error: any) {
    return fail({ code: error.code || 'CATALOG_INGEST_FAILED', message: error.message || 'Failed to ingest catalog.', details: error.details }, error.status || 500);
  }
}
