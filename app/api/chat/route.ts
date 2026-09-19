export const runtime = 'nodejs';

import { z } from 'zod';
import { fail, ok } from '@/lib/autobidder/api/response';
import { runChat, type ChatMessage } from '@/lib/autobidder/services/chat-service';

const chatSchema = z.object({
  history: z.array(z.object({ role: z.enum(['user', 'model']), text: z.string() })).default([]),
  message: z.string().min(1),
  model: z.string().default('gemini-3.5-flash'),
});

export async function POST(req: Request) {
  try {
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

    const history = parsed.data.history as ChatMessage[];
    const text = await runChat(history, parsed.data.message, parsed.data.model);
    return ok({ text });
  } catch (error: any) {
    console.error('POST /api/chat failed', error);
    return fail({ code: 'CHAT_FAILED', message: error?.message || 'Chat request failed.', details: {} }, 500);
  }
}
