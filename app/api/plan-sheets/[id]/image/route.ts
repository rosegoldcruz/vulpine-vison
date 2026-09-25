export const runtime = 'nodejs';

import { fail } from '@/lib/autobidder/api/response';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { readPlanSheetImage } from '@/lib/autobidder/services/viewer-evidence-service';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const { id } = await context.params;
    const image = await readPlanSheetImage(principal, id);
    return new Response(new Uint8Array(image.bytes), {
      status: 200,
      headers: {
        'Content-Type': image.mimeType,
        'Content-Length': String(image.bytes.byteLength),
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    return fail(
      { code: error.code || 'PLAN_IMAGE_READ_FAILED', message: error.message || 'Failed to load plan image.', details: error.details },
      error.status || 500,
    );
  }
}
