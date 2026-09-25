export const runtime = 'nodejs';

import { z } from 'zod';
import { fail, ok } from '@/lib/autobidder/api/response';
import { runChat, type ChatMessage } from '@/lib/autobidder/services/chat-service';
import { groundProjectChat } from '@/lib/autobidder/services/project-assistant-service';
import { requestPrincipal } from '@/lib/autobidder/auth/request-principal';
import { requirePermission } from '@/lib/autobidder/auth/authorization';
import { asApiServiceError } from '@/lib/autobidder/api/errors';

const chatSchema = z.object({
  history: z.array(z.object({ role: z.enum(['user', 'model']), text: z.string() })).default([]),
  message: z.string().min(1),
  model: z.string().optional(),
  mode: z.enum(['text', 'voice']).default('text'),
  jobId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  try {
    const principal = requestPrincipal(req);
    requirePermission(principal, 'project:read');
    const body = await req.json();
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
    const text = await runChat(history, parsed.data.message, parsed.data.model, parsed.data.mode);
    return ok({ text });
  } catch (error) {
    console.error('POST /api/chat failed', error);
    const typed = asApiServiceError(error);
    return fail({ code: typed.code === 'INTERNAL_ERROR' ? 'CHAT_FAILED' : typed.code, message: typed.message || 'Chat request failed.', details: typed.details }, typed.status);
  }
}
