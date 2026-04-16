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
  'gpt-4o': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gpt-4o-mini': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gpt-4-turbo': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gpt-4': { kind: 'chat', capabilities: { tools: true } },
  'gpt-4.5': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'gpt-4.5-mini': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'o1': { kind: 'chat', capabilities: { reasoning: true, tools: true, vision: true } },
  'o1-pro': { kind: 'chat', capabilities: { reasoning: true, tools: true, vision: true } },
  'o1-mini': { kind: 'chat', capabilities: { reasoning: true } },
  'o3': { kind: 'chat', capabilities: { reasoning: true, tools: true, vision: true } },
  'o3-mini': { kind: 'chat', capabilities: { reasoning: true, tools: true } },
  'o4-mini': { kind: 'chat', capabilities: { reasoning: true, tools: true, vision: true } },
  'gpt-5': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'gpt-5-mini': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'chatgpt-4o-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'dall-e-2': { kind: 'image' },
  'dall-e-3': { kind: 'image' },
  'gpt-image-1': { kind: 'image' },
  'tts-1': { kind: 'audio' },
  'tts-1-hd': { kind: 'audio' },
  'whisper-1': { kind: 'audio' },
  'text-embedding-3-small': { kind: 'embedding' },
  'text-embedding-3-large': { kind: 'embedding' },
  'text-embedding-ada-002': { kind: 'embedding' },

  // ── Anthropic ───────────────────────────────────────
  'claude-3-opus-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'claude-3-sonnet-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'claude-3-haiku-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'claude-3.5-sonnet-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'claude-3.5-haiku-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'claude-sonnet-4-20250514': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'claude-opus-4-20250115': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'claude-haiku-4-20250124': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'claude-sonnet-4': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'claude-opus-4': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'claude-haiku-4': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'claude-4.5-sonnet': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },

  // ── Google Gemini ───────────────────────────────────
  'gemini-1.5-pro': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gemini-1.5-flash': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gemini-2.0-flash': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gemini-2.0-flash-lite': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'gemini-2.5-flash': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'gemini-2.5-pro': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'gemini-2.5-flash-preview-image-generation': { kind: 'image' },
  'text-embedding-004': { kind: 'embedding' },

  // ── DeepSeek ────────────────────────────────────────
  'deepseek-chat': { kind: 'chat', capabilities: { tools: true } },
  'deepseek-reasoner': { kind: 'chat', capabilities: { reasoning: true } },
  'deepseek-r1': { kind: 'chat', capabilities: { reasoning: true } },
  'deepseek-v3': { kind: 'chat', capabilities: { tools: true } },
  'deepseek-v3-0324': { kind: 'chat', capabilities: { tools: true } },
  'deepseek-r1-0528': { kind: 'chat', capabilities: { reasoning: true } },

  // ── Qwen ────────────────────────────────────────────
  'qwen-max': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'qwen-plus': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'qwen-turbo': { kind: 'chat', capabilities: { tools: true } },
  'qwen-long': { kind: 'chat', capabilities: { tools: true } },
  'qwen-vl-max': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'qwen-vl-plus': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'qwq-32b': { kind: 'chat', capabilities: { reasoning: true, tools: true } },
  'qwq-plus': { kind: 'chat', capabilities: { reasoning: true, tools: true } },
  'qwen3-235b-a22b': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'qwen3-32b': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'text-embedding-v3': { kind: 'embedding' },

  // ── GLM / 智谱 ──────────────────────────────────────
  'glm-4': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'glm-4-plus': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'glm-4v': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'glm-4v-plus': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'glm-zero-preview': { kind: 'chat', capabilities: { reasoning: true } },
  'glm-z1-air': { kind: 'chat', capabilities: { reasoning: true } },
  'glm-z1-airx': { kind: 'chat', capabilities: { reasoning: true } },
  'glm-z1-flash': { kind: 'chat', capabilities: { reasoning: true } },
  'glm-4-long': { kind: 'chat', capabilities: { tools: true } },
  'cogview-4': { kind: 'image' },
  'cogview-4x': { kind: 'image' },
  'cogvideox': { kind: 'video' },
  'embedding-3': { kind: 'embedding' },

  // ── Grok ────────────────────────────────────────────
  'grok-3': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },
  'grok-3-mini': { kind: 'chat', capabilities: { tools: true, reasoning: true } },
  'grok-4': { kind: 'chat', capabilities: { vision: true, tools: true, reasoning: true } },

  // ── Doubao / 豆包 ──────────────────────────────────
  'doubao-seed-1.6': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'doubao-seed-1.5': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'doubao-1.5-pro': { kind: 'chat', capabilities: { tools: true } },

  // ── MiniMax ─────────────────────────────────────────
  'minimax-m1': { kind: 'chat', capabilities: { tools: true } },
  'mini-max-text-01': { kind: 'chat', capabilities: { tools: true } },

  // ── Meta Llama ─────────────────────────────────────
  'llama-3.2-11b-vision-instruct': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'llama-3.2-90b-vision-instruct': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'llama-3.3-70b-instruct': { kind: 'chat', capabilities: { tools: true } },
  'llama-4-maverick': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'llama-4-scout': { kind: 'chat', capabilities: { vision: true, tools: true } },

  // ── Mistral / Mixtral ──────────────────────────────
  'mixtral-8x7b-instruct': { kind: 'chat', capabilities: { tools: true } },
  'mixtral-8x22b-instruct': { kind: 'chat', capabilities: { tools: true } },
  'mistral-large-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },
  'mistral-small-latest': { kind: 'chat', capabilities: { tools: true } },
  'codestral-latest': { kind: 'chat', capabilities: { tools: true } },
  'pixtral-large-latest': { kind: 'chat', capabilities: { vision: true, tools: true } },

  // ── Yi / 零一万物 ──────────────────────────────────
  'yi-lightning': { kind: 'chat', capabilities: { tools: true } },
  'yi-vision-v2': { kind: 'chat', capabilities: { vision: true } },

  // ── Moonshot / Kimi ────────────────────────────────
  'moonshot-v1-8k': { kind: 'chat' },
  'moonshot-v1-32k': { kind: 'chat' },
  'moonshot-v1-128k': { kind: 'chat' },
  'kimi-latest': { kind: 'chat', capabilities: { tools: true } },
  'kimi-k2': { kind: 'chat', capabilities: { tools: true } },

  // ── Cohere ─────────────────────────────────────────
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
