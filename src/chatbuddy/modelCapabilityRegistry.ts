import { ModelCapabilities, ModelKind } from './types';

type RegistryEntry = {
  kind?: ModelKind;
  capabilities?: ModelCapabilities;
};

/**
 * Hardcoded model capability registry.
 * Covers well-known models from major providers.
 * Key: lowercase model ID (exact match or with suffix stripping).
 */
const REGISTRY: Record<string, RegistryEntry> = {
  // ── OpenAI ──────────────────────────────────────────
  'gpt-5.4': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'gpt-5.4-pro': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'gpt-5.4-mini': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'gpt-5.4-nano': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'gpt-5': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'gpt-5-mini': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gpt-5-nano': { kind: 'chat' },
  'gpt-4.1': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gpt-4.1-mini': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gpt-4.1-nano': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gpt-4o': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gpt-4o-mini': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gpt-4-turbo': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gpt-4': { kind: 'chat', capabilities: { tools: true } },
  'gpt-4.5': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'gpt-4.5-mini': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'chatgpt-4o-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'o1': { kind: 'chat', capabilities: { reasoning: true } },
  'o1-pro': { kind: 'chat', capabilities: { reasoning: true } },
  'o1-mini': { kind: 'chat', capabilities: { reasoning: true } },
  'o3': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'o3-pro': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'o3-mini': { kind: 'chat', capabilities: { reasoning: true, tools: true } },
  'o4-mini': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'gpt-image-1.5': { kind: 'image' },
  'gpt-image-1': { kind: 'image' },
  'gpt-image-1-mini': { kind: 'image' },
  'dall-e-3': { kind: 'image' },
  'dall-e-2': { kind: 'image' },
  'gpt-realtime-1.5': { kind: 'audio' },
  'gpt-realtime': { kind: 'audio' },
  'gpt-realtime-mini': { kind: 'audio' },
  'gpt-audio-1.5': { kind: 'audio' },
  'gpt-audio': { kind: 'audio' },
  'gpt-audio-mini': { kind: 'audio' },
  'gpt-4o-transcribe': { kind: 'audio' },
  'gpt-4o-mini-transcribe': { kind: 'audio' },
  'gpt-4o-mini-tts': { kind: 'audio' },
  'tts-1': { kind: 'audio' },
  'tts-1-hd': { kind: 'audio' },
  'whisper-1': { kind: 'audio' },
  'text-embedding-3-large': { kind: 'embedding' },
  'text-embedding-3-small': { kind: 'embedding' },
  'text-embedding-ada-002': { kind: 'embedding' },

  // ── Anthropic ───────────────────────────────────────
  'claude-opus-4-6': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'claude-sonnet-4-6': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'claude-haiku-4-5': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'claude-sonnet-4-5': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'claude-opus-4-5': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'claude-opus-4-1': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'claude-sonnet-4': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'claude-opus-4': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'claude-haiku-4': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'claude-3-opus-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'claude-3-sonnet-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'claude-3-haiku-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'claude-3.5-sonnet-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'claude-3.5-haiku-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },

  // ── Google Gemini ───────────────────────────────────
  'gemini-3.1-pro-preview': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'gemini-3-flash-preview': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'gemini-3-pro-preview': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'gemini-2.5-pro': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'gemini-2.5-flash': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'gemini-2.5-flash-lite': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'gemini-2.0-flash': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gemini-2.0-flash-lite': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gemini-1.5-pro': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gemini-1.5-flash': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gemini-3.1-flash-image-preview': { kind: 'image', capabilities: { vision: true } },
  'gemini-3-pro-image': { kind: 'image', capabilities: { vision: true } },
  'gemini-2.5-flash-image': { kind: 'image', capabilities: { vision: true } },
  'imagen-4.0-generate': { kind: 'image' },
  'imagen-4.0-generate-fast': { kind: 'image' },
  'imagen-4.0-generate-ultra-fast': { kind: 'image' },
  'imagen-3.0-generate-002': { kind: 'image' },
  'veo-3.1': { kind: 'video' },
  'veo-3.1-fast': { kind: 'video' },
  'veo-3.1-lite': { kind: 'video' },
  'veo-3': { kind: 'video' },
  'gemini-embedding-001': { kind: 'embedding' },
  'gemini-embedding-2': { kind: 'embedding' },
  'text-embedding-005': { kind: 'embedding' },
  'text-embedding-004': { kind: 'embedding' },

  // ── DeepSeek ────────────────────────────────────────
  'deepseek-chat': { kind: 'chat', capabilities: { tools: true } },
  'deepseek-reasoner': { kind: 'chat', capabilities: { reasoning: true } },
  'deepseek-r1': { kind: 'chat', capabilities: { reasoning: true } },
  'deepseek-v4': { kind: 'chat', capabilities: { tools: true } },
  'deepseek-v3': { kind: 'chat', capabilities: { tools: true } },

  // ── Qwen ────────────────────────────────────────────
  'qwen3-max': { kind: 'chat', capabilities: { tools: true, reasoning: true, webSearch: true } },
  'qwen3.6-plus': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'qwen3.5-plus': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'qwen-plus': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'qwen-turbo': { kind: 'chat', capabilities: { tools: true } },
  'qwen-long': { kind: 'chat', capabilities: { tools: true } },
  'qwen-max': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'qwen-vl-max': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'qwen-vl-plus': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'qwen3-vl-max': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'qwq-plus': { kind: 'chat', capabilities: { reasoning: true, tools: true } },
  'qwq-32b': { kind: 'chat', capabilities: { reasoning: true, tools: true } },
  'qwen3-235b-a22b': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'qwen3-32b': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'text-embedding-v3': { kind: 'embedding' },

  // ── GLM / 智谱 ──────────────────────────────────────
  'glm-5.1': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'glm-5': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'glm-5-turbo': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'glm-5v-turbo': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'glm-4.7': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'glm-4.6': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'glm-4.6v': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'glm-4.5': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'glm-4.5v': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'glm-4-plus': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'glm-4': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'glm-4v': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'glm-4v-plus': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'glm-4-long': { kind: 'chat', capabilities: { tools: true } },
  'glm-zero-preview': { kind: 'chat', capabilities: { reasoning: true } },
  'glm-z1-air': { kind: 'chat', capabilities: { reasoning: true } },
  'glm-z1-airx': { kind: 'chat', capabilities: { reasoning: true } },
  'glm-z1-flash': { kind: 'chat', capabilities: { reasoning: true } },
  'cogview-4': { kind: 'image' },
  'cogview-4x': { kind: 'image' },
  'cogvideox': { kind: 'video' },
  'embedding-3': { kind: 'embedding' },

  // ── Grok / xAI ──────────────────────────────────────
  'grok-4.20-0309-reasoning': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'grok-4.20-0309-non-reasoning': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'grok-4.20-multi-agent-0309': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'grok-4-1-fast-reasoning': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'grok-4-1-fast-non-reasoning': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'grok-3': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'grok-3-mini': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'grok-4': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'grok-imagine-image-pro': { kind: 'image' },
  'grok-imagine-image': { kind: 'image' },
  'grok-imagine-video': { kind: 'video' },

  // ── Doubao / 豆包 ──────────────────────────────────
  'doubao-seed-2.0-pro': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'doubao-seed-2.0-lite': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true, webSearch: true } },
  'doubao-seed-2.0-mini': { kind: 'chat', capabilities: { tools: true } },
  'doubao-seed-2.0-code': { kind: 'chat', capabilities: { tools: true } },
  'doubao-seed-1.8': { kind: 'chat', capabilities: { tools: true } },
  'doubao-seed-1.6': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'doubao-seed-1.5': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'doubao-1.5-pro': { kind: 'chat', capabilities: { tools: true } },

  // ── MiniMax ─────────────────────────────────────────
  'minimax-m2.7': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'minimax-m2.7-highspeed': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'minimax-m2.5': { kind: 'chat', capabilities: { tools: true } },
  'minimax-m2.5-highspeed': { kind: 'chat', capabilities: { tools: true } },
  'minimax-m2.1': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'minimax-m2.1-highspeed': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'minimax-m2': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'm2-her': { kind: 'chat', capabilities: { tools: true } },
  'minimax-m1': { kind: 'chat', capabilities: { tools: true } },
  'mini-max-text-01': { kind: 'chat', capabilities: { tools: true } },

  // ── Meta Llama ─────────────────────────────────────
  'llama-4-scout-17b-16e': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'llama-4-maverick-17b-128e': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'llama-3.3-70b-instruct': { kind: 'chat', capabilities: { tools: true } },
  'llama-3.2-11b-vision-instruct': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'llama-3.2-90b-vision-instruct': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'llama-4-maverick': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'llama-4-scout': { kind: 'chat', capabilities: { vision: true, tools: true } },

  // ── Mistral / Mixtral ──────────────────────────────
  'mistral-large-3': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'mistral-medium-3.1': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'mistral-small-4': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'mistral-small-3.2': { kind: 'chat', capabilities: { tools: true } },
  'mistral-large-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'mistral-small-latest': { kind: 'chat', capabilities: { tools: true } },
  'magistral-medium-1.2': { kind: 'chat', capabilities: { vision: true, reasoning: true } },
  'magistral-small-1.2': { kind: 'chat', capabilities: { reasoning: true } },
  'devstral-2': { kind: 'chat', capabilities: { tools: true } },
  'codestral-latest': { kind: 'chat', capabilities: { tools: true } },
  'pixtral-large-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'mixtral-8x7b-instruct': { kind: 'chat', capabilities: { tools: true } },
  'mixtral-8x22b-instruct': { kind: 'chat', capabilities: { tools: true } },

  // ── Moonshot / Kimi ────────────────────────────────
  'kimi-k2.5': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'kimi-k2-thinking': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'kimi-k2-thinking-turbo': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'kimi-k2-turbo-preview': { kind: 'chat', capabilities: { tools: true } },
  'kimi-latest': { kind: 'chat', capabilities: { tools: true } },
  'kimi-k2': { kind: 'chat', capabilities: { tools: true } },
  'moonshot-v1-8k': { kind: 'chat' },
  'moonshot-v1-32k': { kind: 'chat' },
  'moonshot-v1-128k': { kind: 'chat' },
  'moonshot-v1-8k-vision-preview': { kind: 'chat', capabilities: { vision: true } },
  'moonshot-v1-32k-vision-preview': { kind: 'chat', capabilities: { vision: true } },
  'moonshot-v1-128k-vision-preview': { kind: 'chat', capabilities: { vision: true } },

  // ── Cohere ─────────────────────────────────────────
  'command-a-03-2025': { kind: 'chat', capabilities: { tools: true } },
  'command-a-vision-07-2025': { kind: 'chat', capabilities: { vision: true } },
  'command-a-reasoning-08-2025': { kind: 'chat', capabilities: { reasoning: true } },
  'command-r7b-12-2024': { kind: 'chat', capabilities: { tools: true } },
  'command-r-plus-08-2024': { kind: 'chat', capabilities: { tools: true } },
  'command-r-08-2024': { kind: 'chat', capabilities: { tools: true } },
  'command-r-plus': { kind: 'chat', capabilities: { tools: true } },
  'command-r': { kind: 'chat', capabilities: { tools: true } },
  'rerank-v3': { kind: 'rerank' },
  'rerank-english-v3': { kind: 'rerank' },
  'embed-v4': { kind: 'embedding' },

  // ── Perplexity ─────────────────────────────────────
  'sonar': { kind: 'chat', capabilities: { webSearch: true } },
  'sonar-pro': { kind: 'chat', capabilities: { webSearch: true } },
  'sonar-reasoning': { kind: 'chat', capabilities: { reasoning: true, webSearch: true } },
  'sonar-reasoning-pro': { kind: 'chat', capabilities: { reasoning: true, webSearch: true } },

  // ── Hunyuan / 腾讯 ─────────────────────────────────
  'tencent-hy-2.0-think': { kind: 'chat', capabilities: { tools: true, reasoning: true, webSearch: true } },
  'tencent-hy-2.0-instruct': { kind: 'chat', capabilities: { tools: true, webSearch: true } },
  'hunyuan-t1': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'hunyuan-turbos': { kind: 'chat', capabilities: { tools: true } },
  'hunyuan-a13b': { kind: 'chat', capabilities: { tools: true } },
  'tencent-hy-vision-1.5-instruct': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'hunyuan-turbos-vision': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'hunyuan-t1-vision': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'hunyuan-lite': { kind: 'chat', capabilities: { tools: true } },

  // ── Step / 阶跃星辰 ────────────────────────────────
  'step-3.5-flash': { kind: 'chat', capabilities: { tools: true, reasoning: true, webSearch: true } },
  'step-3': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'step-2-16k': { kind: 'chat', capabilities: { tools: true, webSearch: true } },
  'step-2-mini': { kind: 'chat', capabilities: { tools: true, webSearch: true } },
  'step-r1-v-mini': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'step-1o-turbo-vision': { kind: 'chat', capabilities: { vision: true, tools: true } },

  // ── Spark / 星火 ───────────────────────────────────
  'spark-x2': { kind: 'chat', capabilities: { tools: true, reasoning: true, webSearch: true } },
  'spark-ultra': { kind: 'chat', capabilities: { tools: true, webSearch: true } },
  'spark-max': { kind: 'chat', capabilities: { tools: true, webSearch: true } },
  'spark-pro': { kind: 'chat', capabilities: { tools: true, webSearch: true } },
  'spark-lite': { kind: 'chat' },
  'spark-4.0-ultra': { kind: 'chat', capabilities: { vision: true, tools: true, webSearch: true } },

  // ── Amazon Nova ────────────────────────────────────
  'amazon-nova-premier-v1:0': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'amazon-nova-pro-v1:0': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'amazon-nova-lite-v1:0': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'amazon-nova-micro-v1:0': { kind: 'chat', capabilities: { tools: true } },
  'amazon-nova-canvas-v1:0': { kind: 'image' },
  'amazon-nova-reel-v1:0': { kind: 'video' },

  // ── Yi / 零一万物 ──────────────────────────────────
  'yi-lightning': { kind: 'chat' },
  'yi-large': { kind: 'chat' },
  'yi-large-turbo': { kind: 'chat' },
  'yi-medium': { kind: 'chat' },
  'yi-medium-200k': { kind: 'chat' },
  'yi-vision': { kind: 'chat', capabilities: { vision: true } },
  'yi-vision-v2': { kind: 'chat', capabilities: { vision: true } },
};

/** Suffixes to strip for fuzzy matching */
const STRIP_SUFFIXES = [
  /-latest$/, /:free$/, /-preview$/, /-chat$/, /-instruct$/,
  /-202\d-\d{2}-\d{2}$/, /-\d{8}$/, /-v\d+(\.\d+)*$/,
];

/**
 * Look up model kind and capabilities from the hardcoded registry.
 * Tries exact match first, then strips common suffixes.
 */
export function resolveFromRegistry(modelId: string): RegistryEntry | undefined {
  const lower = modelId.toLowerCase();

  // Exact match
  if (REGISTRY[lower]) {
    return REGISTRY[lower];
  }

  // Strip suffixes and retry
  let candidate = lower;
  for (const suffix of STRIP_SUFFIXES) {
    const stripped = candidate.replace(suffix, '');
    if (stripped !== candidate) {
      if (REGISTRY[stripped]) {
        return REGISTRY[stripped];
      }
      candidate = stripped;
      break;
    }
  }

  return undefined;
}
