import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { getServerEnv } from '@/lib/autobidder/env/server-env';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export async function runChat(history: ChatMessage[], message: string, model: string) {
  const env = getServerEnv();
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const contents = history.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.text }],
  }));
  contents.push({ role: 'user', parts: [{ text: message }] });

  const response = await ai.models.generateContent({
    model: model || 'gemini-3.5-flash',
    contents,
    config: {
      systemInstruction:
        'You are a helpful AutoBidder assistant. Provide concise answers grounded in uploaded project workflow context when available.',
    },
  });

  return response.text;
}
