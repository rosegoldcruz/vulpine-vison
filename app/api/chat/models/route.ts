export const runtime = 'nodejs';

import { ok } from '@/lib/autobidder/api/response';
import { buildProviderCatalog, type ModelCapability, type ProviderCatalog } from '@/lib/autobidder/llm/model-catalog';

type ProviderWithStatus = ProviderCatalog & {
  keyConfigured: boolean;
  source: 'static' | 'live';
  error?: string;
};

function withTimeoutSignal(timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function mergeCapabilities(staticModels: ModelCapability[], liveIds: string[], endpointUrl: string): ModelCapability[] {
  const byId = new Map(staticModels.map((m) => [m.id, m]));
  return liveIds.map((id) => {
    const known = byId.get(id);
    if (known) return known;
    return {
      id,
      name: id,
      url: endpointUrl,
      toolCalling: true,
      vision: false,
      thinking: true,
      streaming: true,
      maxInputTokens: 0,
      maxOutputTokens: 0,
    };
  });
}

async function fetchOpenAiCompatModelIds(baseUrl: string, apiKey: string, extraHeaders?: Record<string, string>): Promise<string[]> {
  const endpoint = `${normalizeUrl(baseUrl)}/models`;
  const { signal, clear } = withTimeoutSignal();
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        ...(extraHeaders || {}),
      },
      signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const json: any = await response.json();
    const ids = Array.isArray(json?.data)
      ? json.data.map((item: any) => item?.id).filter((id: unknown) => typeof id === 'string')
      : [];
    return ids;
  } finally {
    clear();
  }
}

async function fetchAnthropicModelIds(apiKey: string): Promise<string[]> {
  const endpoint = 'https://api.anthropic.com/v1/models';
  const { signal, clear } = withTimeoutSignal();
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const json: any = await response.json();
    const ids = Array.isArray(json?.data)
      ? json.data.map((item: any) => item?.id).filter((id: unknown) => typeof id === 'string')
      : [];
    return ids;
  } finally {
    clear();
  }
}

async function fetchOllamaCloudModelIds(apiKey: string): Promise<string[]> {
  const endpoint = 'https://ollama.com/api/tags';
  const { signal, clear } = withTimeoutSignal();
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
      signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const json: any = await response.json();
    const ids = Array.isArray(json?.models)
      ? json.models.map((item: any) => item?.name).filter((id: unknown) => typeof id === 'string')
      : [];
    return ids;
  } finally {
    clear();
  }
}

async function hydrateProvider(provider: ReturnType<typeof buildProviderCatalog>[number]): Promise<ProviderWithStatus> {
  if (!provider.keyConfigured) {
    return { ...provider, source: 'static' };
  }

  try {
    if (provider.id === 'anthropic') {
      const apiKey = process.env[provider.apiKeyEnvVar] || '';
      const ids = await fetchAnthropicModelIds(apiKey);
      if (ids.length) {
        return {
          ...provider,
          models: mergeCapabilities(provider.models, ids, 'https://api.anthropic.com/v1/messages'),
          source: 'live',
        };
      }
      return { ...provider, source: 'static' };
    }

    if (provider.id === 'ollama-cloud') {
      const apiKey = process.env[provider.apiKeyEnvVar] || '';
      const ids = await fetchOllamaCloudModelIds(apiKey);
      if (ids.length) {
        return {
          ...provider,
          models: mergeCapabilities(provider.models, ids, 'https://ollama.com/api/chat'),
          source: 'live',
        };
      }
      return { ...provider, source: 'static' };
    }

    const apiKey = process.env[provider.apiKeyEnvVar] || '';
    const baseUrl =
      (provider.id === 'openai' && (process.env.OPENAI_BASE_URL || provider.baseUrlDefault)) ||
      (provider.id === 'xai' && (process.env.XAI_BASE_URL || provider.baseUrlDefault)) ||
      (provider.id === 'deepseek' && (process.env.DEEPSEEK_BASE_URL || provider.baseUrlDefault)) ||
      (provider.id === 'mistral' && (process.env.MISTRAL_BASE_URL || provider.baseUrlDefault)) ||
      (provider.id === 'metamuse' && (process.env.METAMUSE_BASE_URL || provider.baseUrlDefault)) ||
      (provider.id === 'ollama-cloud' && (process.env.OLLAMA_BASE_URL || provider.baseUrlDefault)) ||
      provider.baseUrlDefault;

    const ids = await fetchOpenAiCompatModelIds(baseUrl, apiKey);
    if (!ids.length) {
      return { ...provider, source: 'static' };
    }

    return {
      ...provider,
      models: mergeCapabilities(provider.models, ids, `${normalizeUrl(baseUrl)}/chat/completions`),
      source: 'live',
    };
  } catch (error: any) {
    return {
      ...provider,
      source: 'static',
      error: error?.message || 'Live model discovery failed.',
    };
  }
}

export async function GET() {
  const staticCatalog = buildProviderCatalog(process.env);
  const providers = await Promise.all(staticCatalog.map(hydrateProvider));

  return ok({
    providers,
  });
}
