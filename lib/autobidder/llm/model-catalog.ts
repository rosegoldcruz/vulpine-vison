import 'server-only';

export interface ModelCapability {
  id: string;
  name: string;
  url: string;
  toolCalling: boolean;
  vision: boolean;
  thinking: boolean;
  streaming: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface ProviderCatalog {
  id: string;
  name: string;
  apiKeyEnvVar: string;
  baseUrlDefault: string;
  models: ModelCapability[];
}

export const OLLAMA_CLOUD_MODELS: ModelCapability[] = [
  { id: 'glm-5.3', name: 'GLM 5.3', url: 'https://ollama.com/v1/responses', toolCalling: true, vision: false, thinking: true, streaming: true, maxInputTokens: 984000, maxOutputTokens: 16000 },
  { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash', url: 'https://ollama.com/v1/responses', toolCalling: true, vision: true, thinking: true, streaming: true, maxInputTokens: 984000, maxOutputTokens: 16000 },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', url: 'https://ollama.com/v1/responses', toolCalling: true, vision: true, thinking: true, streaming: true, maxInputTokens: 984000, maxOutputTokens: 16000 },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', url: 'https://ollama.com/v1/responses', toolCalling: true, vision: false, thinking: true, streaming: true, maxInputTokens: 984000, maxOutputTokens: 16000 },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', url: 'https://ollama.com/v1/responses', toolCalling: true, vision: false, thinking: true, streaming: true, maxInputTokens: 984000, maxOutputTokens: 16000 },
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', url: 'https://ollama.com/v1/responses', toolCalling: true, vision: true, thinking: true, streaming: true, maxInputTokens: 984000, maxOutputTokens: 16000 },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', url: 'https://ollama.com/v1/responses', toolCalling: true, vision: true, thinking: true, streaming: true, maxInputTokens: 984000, maxOutputTokens: 16000 },
  { id: 'qwen3.5', name: 'Qwen 3.5', url: 'https://ollama.com/v1/responses', toolCalling: true, vision: true, thinking: true, streaming: true, maxInputTokens: 984000, maxOutputTokens: 16000 },
  { id: 'mistral-large-3', name: 'Mistral Large 3', url: 'https://ollama.com/v1/responses', toolCalling: true, vision: true, thinking: true, streaming: true, maxInputTokens: 984000, maxOutputTokens: 16000 },
  { id: 'minimax-m3', name: 'MiniMax M3', url: 'https://ollama.com/v1/responses', toolCalling: true, vision: true, thinking: true, streaming: true, maxInputTokens: 496000, maxOutputTokens: 16000 },
  { id: 'nemotron-3-ultra', name: 'Nemotron 3 Ultra', url: 'https://ollama.com/v1/responses', toolCalling: true, vision: false, thinking: true, streaming: true, maxInputTokens: 984000, maxOutputTokens: 16000 },
  { id: 'nemotron-3-super', name: 'Nemotron 3 Super', url: 'https://ollama.com/v1/responses', toolCalling: true, vision: false, thinking: true, streaming: true, maxInputTokens: 984000, maxOutputTokens: 16000 },
  { id: 'nemotron-3-nano', name: 'Nemotron 3 Nano', url: 'https://ollama.com/v1/responses', toolCalling: true, vision: false, thinking: true, streaming: true, maxInputTokens: 984000, maxOutputTokens: 16000 },
  { id: 'gpt-oss:120b-cloud', name: 'GPT-OSS 120B Cloud', url: 'https://ollama.com/v1/responses', toolCalling: true, vision: false, thinking: true, streaming: true, maxInputTokens: 112000, maxOutputTokens: 16000 },
];

export const PROVIDER_CATALOG: ProviderCatalog[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    baseUrlDefault: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5', name: 'GPT-5', url: 'https://api.openai.com/v1/chat/completions', toolCalling: true, vision: true, thinking: true, streaming: true, maxInputTokens: 272000, maxOutputTokens: 16000 },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini', url: 'https://api.openai.com/v1/chat/completions', toolCalling: true, vision: true, thinking: true, streaming: true, maxInputTokens: 272000, maxOutputTokens: 16000 },
      { id: 'gpt-4o', name: 'GPT-4o', url: 'https://api.openai.com/v1/chat/completions', toolCalling: true, vision: true, thinking: false, streaming: true, maxInputTokens: 128000, maxOutputTokens: 16000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', url: 'https://api.openai.com/v1/chat/completions', toolCalling: true, vision: true, thinking: false, streaming: true, maxInputTokens: 128000, maxOutputTokens: 16000 },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    baseUrlDefault: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', url: 'https://api.anthropic.com/v1/messages', toolCalling: true, vision: true, thinking: true, streaming: true, maxInputTokens: 200000, maxOutputTokens: 16000 },
      { id: 'claude-haiku-3-5', name: 'Claude Haiku 3.5', url: 'https://api.anthropic.com/v1/messages', toolCalling: true, vision: true, thinking: false, streaming: true, maxInputTokens: 200000, maxOutputTokens: 8000 },
    ],
  },
  {
    id: 'xai',
    name: 'xAI',
    apiKeyEnvVar: 'XAI_API_KEY',
    baseUrlDefault: 'https://api.x.ai/v1',
    models: [
      { id: 'grok-4', name: 'Grok 4', url: 'https://api.x.ai/v1/chat/completions', toolCalling: true, vision: true, thinking: true, streaming: true, maxInputTokens: 256000, maxOutputTokens: 16000 },
      { id: 'grok-3-mini', name: 'Grok 3 Mini', url: 'https://api.x.ai/v1/chat/completions', toolCalling: true, vision: false, thinking: true, streaming: true, maxInputTokens: 128000, maxOutputTokens: 16000 },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    baseUrlDefault: 'https://api.deepseek.com',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', url: 'https://api.deepseek.com/chat/completions', toolCalling: true, vision: false, thinking: true, streaming: true, maxInputTokens: 128000, maxOutputTokens: 16000 },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', url: 'https://api.deepseek.com/chat/completions', toolCalling: true, vision: false, thinking: true, streaming: true, maxInputTokens: 128000, maxOutputTokens: 16000 },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    apiKeyEnvVar: 'MISTRAL_API_KEY',
    baseUrlDefault: 'https://api.mistral.ai/v1',
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large Latest', url: 'https://api.mistral.ai/v1/chat/completions', toolCalling: true, vision: true, thinking: true, streaming: true, maxInputTokens: 128000, maxOutputTokens: 16000 },
      { id: 'mistral-small-latest', name: 'Mistral Small Latest', url: 'https://api.mistral.ai/v1/chat/completions', toolCalling: true, vision: true, thinking: false, streaming: true, maxInputTokens: 128000, maxOutputTokens: 16000 },
    ],
  },
  {
    id: 'metamuse',
    name: 'MetaMuse',
    apiKeyEnvVar: 'METAMUSE_API_KEY',
    baseUrlDefault: 'https://api.meta.ai/v1',
    models: [
      { id: 'muse-spark-1.3-contributor', name: 'Muse Spark 1.3 Contributor', url: 'https://api.meta.ai/v1/chat/completions', toolCalling: true, vision: false, thinking: true, streaming: true, maxInputTokens: 128000, maxOutputTokens: 16000 },
      { id: 'muse-spark-1.2-contributor', name: 'Muse Spark 1.2 Contributor', url: 'https://api.meta.ai/v1/chat/completions', toolCalling: true, vision: false, thinking: true, streaming: true, maxInputTokens: 128000, maxOutputTokens: 16000 },
    ],
  },
  {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    apiKeyEnvVar: 'OLLAMA_API_KEY',
    baseUrlDefault: 'https://ollama.com/v1',
    models: OLLAMA_CLOUD_MODELS,
  },
];

export function findOllamaCloudModel(modelId: string): ModelCapability | undefined {
  return OLLAMA_CLOUD_MODELS.find((m) => m.id === modelId);
}

export function buildProviderCatalog(env: NodeJS.ProcessEnv) {
  return PROVIDER_CATALOG.map((provider) => ({
    ...provider,
    keyConfigured: !!env[provider.apiKeyEnvVar],
  }));
}
