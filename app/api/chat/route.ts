export const runtime = 'nodejs';

import { z } from 'zod';
import { fail, ok } from '@/lib/autobidder/api/response';
import { runChat, type ChatMessage } from '@/lib/autobidder/services/chat-service';
import { groundProjectChat } from '@/lib/autobidder/services/project-assistant-service';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { asApiServiceError } from '@/lib/autobidder/api/errors';
import { readLimitedJson } from '@/lib/autobidder/api/limited-json';
import { acquireAiRequest } from '@/lib/autobidder/services/ai-request-limit';

const chatSchema = z.object({
  history: z.array(z.object({ role: z.enum(['user', 'model']), text: z.string().max(20000) })).max(40).default([]),
  message: z.string().min(1).max(20000),
  model: z.string().max(120).optional(),
  mode: z.enum(['text', 'voice']).default('text'),
  jobId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  try {
    const principal = requestPrincipal(req);
    requirePermission(principal, 'project:read');
    const body = await readLimitedJson(req);
    const parsed = chatSchema.safeParse(body);
    if (!parsed.success) {
      return fail(
        {
          code: 'VALIDATION_ERROR',
          message: 'Invalid chat payload.',
          details: { issues: parsed.error.issues },
        },
        400,
      );
    }

    if (parsed.data.jobId) {
      return ok(await groundProjectChat(parsed.data.jobId, parsed.data.message, principal));
    }
    const history = parsed.data.history as ChatMessage[];
    const release = acquireAiRequest(principal);
    try {
      const text = await runChat(history, parsed.data.message, parsed.data.model, parsed.data.mode);
      return ok({ text });
    } finally {
      release();
    }
  } catch (error) {
    const typed = asApiServiceError(error);
    console.error('POST /api/chat failed', { code: typed.code, status: typed.status });
    return fail({ code: typed.code === 'INTERNAL_ERROR' ? 'CHAT_FAILED' : typed.code, message: typed.message || 'Chat request failed.', details: typed.details }, typed.status);
  }
}
