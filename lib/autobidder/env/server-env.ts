import 'server-only';
import { z } from 'zod';

const schema = z.object({
  LLM_PROVIDER: z.enum(['gemini', 'openai-compatible', 'metamuse']).default('gemini'),
  LLM_FALLBACK_PROVIDER: z.enum(['openai-compatible', 'gemini']).default('openai-compatible'),
  LLM_MODEL: z.string().min(1).default('muse-spark-1.3-contributor'),
  LLM_VOICE_MODEL: z.string().min(1).default('muse-spark-1.2-contributor'),
  OPENAI_VOICE_MODEL: z.string().min(1).default('gpt-4o-mini'),
  OPENAI_REALTIME_MODEL: z.string().min(1).default('gpt-4o-realtime-preview'),
  OPENAI_REALTIME_VOICE: z.string().min(1).default('alloy'),
  XAI_API_KEY: z.string().min(1).optional(),
  XAI_BASE_URL: z.string().url().optional(),
  XAI_VOICE_MODEL: z.string().min(1).default('grok-3-mini'),
  OLLAMA_API_KEY: z.string().min(1).optional(),
  OLLAMA_BASE_URL: z.string().url().optional(),
  LLM_MODE: z.enum(['text', 'voice']).default('text'),
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_BASE_URL: z.string().url().optional(),
  METAMUSE_API_KEY: z.string().min(1).optional(),
  METAMUSE_BASE_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  LLM_SYSTEM_PROMPT: z.string().min(1).optional(),
  LLM_SYSTEM_PROMPT_FILE: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  AUTOBIDDER_DATA_DIR: z.string().min(1),
});

export type ServerEnv = z.infer<typeof schema>;

let cache: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cache) {
    return cache;
  }
  const defaultDataDir = process.env.VERCEL ? '/tmp/autobidder' : '.data/autobidder';
  cache = schema.parse({
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_FALLBACK_PROVIDER: process.env.LLM_FALLBACK_PROVIDER,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_VOICE_MODEL: process.env.LLM_VOICE_MODEL,
    OPENAI_VOICE_MODEL: process.env.OPENAI_VOICE_MODEL,
    OPENAI_REALTIME_MODEL: process.env.OPENAI_REALTIME_MODEL,
    OPENAI_REALTIME_VOICE: process.env.OPENAI_REALTIME_VOICE,
    XAI_API_KEY: process.env.XAI_API_KEY,
    XAI_BASE_URL: process.env.XAI_BASE_URL,
    XAI_VOICE_MODEL: process.env.XAI_VOICE_MODEL,
    OLLAMA_API_KEY: process.env.OLLAMA_API_KEY,
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
    LLM_MODE: process.env.LLM_MODE,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    METAMUSE_API_KEY: process.env.METAMUSE_API_KEY,
    METAMUSE_BASE_URL: process.env.METAMUSE_BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    LLM_SYSTEM_PROMPT: process.env.LLM_SYSTEM_PROMPT,
    LLM_SYSTEM_PROMPT_FILE: process.env.LLM_SYSTEM_PROMPT_FILE,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    AUTOBIDDER_DATA_DIR: process.env.AUTOBIDDER_DATA_DIR || defaultDataDir,
  });
  return cache;
}
