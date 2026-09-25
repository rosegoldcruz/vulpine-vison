import 'server-only';
import { generateChatCompletion } from '@/lib/autobidder/services/llm-service';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export async function runChat(history: ChatMessage[], message: string, model?: string, mode: 'text' | 'voice' = 'text') {
  return generateChatCompletion({
    history,
    message,
    model,
    mode,
  });
}
