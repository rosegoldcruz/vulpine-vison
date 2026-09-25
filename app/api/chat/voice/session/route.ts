export const runtime = 'nodejs';

import { fail, ok } from '@/lib/autobidder/api/response';
import { initVoiceRealtimeSession } from '@/lib/autobidder/services/llm-service';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { assertBidJobAccess } from '@/lib/autobidder/auth/resource-access';

export async function POST(request: Request) {
  try {
    const principal = requestPrincipal(request);
    requirePermission(principal, 'project:read');
    const body = await request.json().catch(() => ({}));
    if (!body.jobId || typeof body.jobId !== 'string') return fail({ code: 'VALIDATION_ERROR', message: 'An active jobId is required for grounded voice.' }, 400);
    assertBidJobAccess(body.jobId, principal);
    const result = await initVoiceRealtimeSession();
    return ok({ voiceSession: result });
  } catch (error: any) {
    console.error('POST /api/chat/voice/session failed', error);
    return fail({ code: error.code || 'VOICE_SESSION_FAILED', message: error?.message || 'Voice session init failed.', details: {} }, error.status || 500);
  }
}
