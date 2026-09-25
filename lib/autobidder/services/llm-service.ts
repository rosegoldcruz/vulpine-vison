import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { readFile } from 'node:fs/promises';
import { getServerEnv } from '@/lib/autobidder/env/server-env';
import { findOllamaCloudModel } from '@/lib/autobidder/llm/model-catalog';

export interface LlmMessage {
  role: 'user' | 'model';
  text: string;
}

type ChatMode = 'text' | 'voice';

let promptFileCache: { path: string; content: string } | null = null;

export type VoiceSessionInitResult =
  | {
      provider: 'openai-realtime';
      session: any;
      realtimeApiBase: string;
    }
  | {
      provider: 'xai-fallback';
      reason: string;
      model: string;
    };

function normalizeModelName(input: string): string {
  const key = input.trim().toLowerCase();
  const aliases: Record<string, string> = {
    '1.3contributor': 'muse-spark-1.3-contributor',
    'muse-1.3-contributor': 'muse-spark-1.3-contributor',
    'muse-spark-1.3': 'muse-spark-1.3',
    'muse-spark-1.2-contributor': 'muse-spark-1.2-contributor',
    'muse-spark-1.2': 'muse-spark-1.2',
    'muse-spark-1.1': 'muse-spark-1.1',
  };
  return aliases[key] || input;
}

function normalizeOpenAiText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

function normalizeResponsesText(output: any): string {
  if (typeof output?.output_text === 'string' && output.output_text.trim()) {
    return output.output_text.trim();
  }

  const chunks: string[] = [];
  const items = Array.isArray(output?.output) ? output.output : [];
  for (const item of items) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const text = part?.text;
      if (typeof text === 'string' && text.trim()) {
        chunks.push(text.trim());
      }
    }
  }
  return chunks.join('\n').trim();
}

async function resolveRuntimeSystemPrompt(env: ReturnType<typeof getServerEnv>): Promise<string> {
  if (env.LLM_SYSTEM_PROMPT_FILE) {
    if (promptFileCache && promptFileCache.path === env.LLM_SYSTEM_PROMPT_FILE) {
      return promptFileCache.content;
    }

    const content = (await readFile(env.LLM_SYSTEM_PROMPT_FILE, 'utf8')).trim();
    if (content) {
      promptFileCache = { path: env.LLM_SYSTEM_PROMPT_FILE, content };
      return content;
    }
  }

  if (env.LLM_SYSTEM_PROMPT) {
    return env.LLM_SYSTEM_PROMPT;
  }

  return 'You are a helpful AutoBidder assistant. Provide concise answers grounded in uploaded project workflow context when available.';
}

export async function generateChatCompletion(args: {
  history: LlmMessage[];
  message: string;
  model?: string;
  systemPrompt?: string;
  mode?: ChatMode;
}): Promise<string> {
  const env = getServerEnv();
  const mode = args.mode || env.LLM_MODE;
  const textModel = normalizeModelName(args.model || env.LLM_MODEL);
  const voiceModel = normalizeModelName(args.model || env.OPENAI_VOICE_MODEL);
  const runtimeSystemPrompt = await resolveRuntimeSystemPrompt(env);
  const baseSystemPrompt =
    args.systemPrompt ||
    runtimeSystemPrompt;
  const voiceStylePrompt =
    mode === 'voice'
      ? 'Voice mode is enabled. Respond with short spoken sentences, natural pacing, and no markdown or bullet lists.'
      : '';
  const systemPrompt = voiceStylePrompt ? `${baseSystemPrompt}\n\n${voiceStylePrompt}` : baseSystemPrompt;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...args.history.map((msg) => ({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.text,
    })),
    { role: 'user', content: args.message },
  ];

  async function runGemini(): Promise<string> {
    const apiKey = env.LLM_API_KEY || env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing LLM_API_KEY (or GEMINI_API_KEY) for gemini provider.');
    }

    const ai = new GoogleGenAI({ apiKey });
    const contents = args.history.map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.text }],
    }));
    contents.push({ role: 'user', parts: [{ text: args.message }] });

    const response = await ai.models.generateContent({
      model: textModel,
      contents,
      config: {
        systemInstruction: systemPrompt,
      },
    });

    return response.text || '';
  }

  async function runOpenAiCompatible(config: {
    apiKey?: string;
    baseUrl?: string;
    providerName: string;
    model: string;
  }): Promise<string> {
    if (!config.apiKey || !config.baseUrl) {
      throw new Error(`Missing API key or base URL for ${config.providerName}.`);
    }

    const endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, messages }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const raw = await res.text();
      throw new Error(`${config.providerName} request failed (${res.status}): ${raw.slice(0, 400)}`);
    }

    const json: any = await res.json();
    const text = normalizeOpenAiText(json?.choices?.[0]?.message?.content);
    if (!text) {
      throw new Error(`${config.providerName} returned empty content.`);
    }

    return text;
  }

  async function runResponsesApiModel(modelId: string): Promise<string> {
    const metadata = findOllamaCloudModel(modelId);
    if (!metadata) {
      throw new Error(`Unknown responses-model metadata for ${modelId}`);
    }

    const apiKey = env.OLLAMA_API_KEY || env.LLM_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OLLAMA_API_KEY (or LLM_API_KEY) for Ollama Cloud model calls.');
    }

    const endpoint = metadata.url;
    const responseInput = [
      {
        role: 'system',
        content: [{ type: 'input_text', text: systemPrompt }],
      },
      ...args.history.map((msg) => ({
        role: msg.role === 'model' ? 'assistant' : 'user',
        content: [{ type: 'input_text', text: msg.text }],
      })),
      {
        role: 'user',
        content: [{ type: 'input_text', text: args.message }],
      },
    ];

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        input: responseInput,
        stream: false,
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const raw = await res.text();
      throw new Error(`Ollama responses request failed (${res.status}): ${raw.slice(0, 400)}`);
    }

    const payload = await res.json();
    const text = normalizeResponsesText(payload);
    if (!text) {
      throw new Error('Ollama responses returned empty content.');
    }
    return text;
  }

  async function runMuseTextPath(): Promise<string> {
    try {
      return await runOpenAiCompatible({
        apiKey: env.METAMUSE_API_KEY || env.LLM_API_KEY,
        baseUrl: env.METAMUSE_BASE_URL || env.LLM_BASE_URL,
        providerName: 'metamuse',
        model: textModel,
      });
    } catch (primaryError: any) {
      if (env.LLM_FALLBACK_PROVIDER === 'gemini') {
        return runGemini();
      }

      return runOpenAiCompatible({
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        providerName: `openai fallback after metamuse failure (${primaryError?.message || 'unknown error'})`,
        model: textModel,
      });
    }
  }

  async function runVoicePath(): Promise<string> {
    try {
      return await runOpenAiCompatible({
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        providerName: 'openai-voice',
        model: voiceModel,
      });
    } catch (openAiVoiceError: any) {
      return runOpenAiCompatible({
        apiKey: env.XAI_API_KEY,
        baseUrl: env.XAI_BASE_URL || 'https://api.x.ai/v1',
        providerName: `xai fallback after openai voice failure (${openAiVoiceError?.message || 'unknown error'})`,
        model: normalizeModelName(env.XAI_VOICE_MODEL),
      });
    }
  }

  // Policy lock: non-voice chat stays on Muse contributor chain.
  if (findOllamaCloudModel(args.model || '')) {
    return runResponsesApiModel(args.model as string);
  }

  // Policy lock: non-voice chat stays on Muse contributor chain.
  if (mode !== 'voice') {
    return runMuseTextPath();
  }

  // Voice path: OpenAI first, xAI fallback.
  return runVoicePath();
}

export async function initVoiceRealtimeSession(): Promise<VoiceSessionInitResult> {
  const env = getServerEnv();
  const realtimeApiBase = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const endpoint = `${realtimeApiBase}/realtime/sessions`;
  const runtimeSystemPrompt = await resolveRuntimeSystemPrompt(env);

  if (!env.OPENAI_API_KEY) {
    return {
      provider: 'xai-fallback',
      reason: 'OPENAI_API_KEY is not configured. Falling back to xAI for voice chat responses.',
      model: normalizeModelName(env.XAI_VOICE_MODEL),
    };
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_REALTIME_MODEL,
        voice: env.OPENAI_REALTIME_VOICE,
        modalities: ['audio', 'text'],
        instructions: runtimeSystemPrompt,
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const raw = await res.text();
      return {
        provider: 'xai-fallback',
        reason: `OpenAI realtime session request failed (${res.status}): ${raw.slice(0, 300)}`,
        model: normalizeModelName(env.XAI_VOICE_MODEL),
      };
    }

    const session = await res.json();
    return { provider: 'openai-realtime', session, realtimeApiBase };
  } catch (error: any) {
    return {
      provider: 'xai-fallback',
      reason: error?.message || 'Unknown OpenAI realtime session error.',
      model: normalizeModelName(env.XAI_VOICE_MODEL),
    };
  }
}
