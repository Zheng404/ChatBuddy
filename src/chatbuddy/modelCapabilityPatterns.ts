import { ModelCapabilities, ModelKind } from './types';

type PatternResult = {
  kind?: ModelKind;
  capabilities?: ModelCapabilities;
};

// ── Kind patterns (output type) ──────────────────────────────

const EMBEDDING_PATTERN = /(?:^text-|embed|bge-|e5-|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i;
const RERANK_PATTERN = /(?:rerank|re-rank|re-ranker|re-ranking)/i;
const IMAGE_GEN_PATTERN = /(?:dall-e|stable-diffusion|midjourney|flux|cogview|imagen|sd3|sdxl|playground|ideogram|image-generation)/i;
const AUDIO_PATTERN = /(?:whisper|tts[-_]?1|speech|bark|elevenlabs)/i;
const VIDEO_PATTERN = /(?:runway|kling|pika|sora|cogvideo|stable-video|animate|video-generation)/i;

// ── Ability patterns (functional capabilities) ──────────────

const VISION_PATTERN = /\b(vision|vl|4o|4-turbo|claude-3|claude-4|gemini-1\.5|gemini-2|gemini-3|glm-4v|llava|minicpm|pixtral|qwq-vl)\b/i;
const REASONING_PATTERN = /^(?!.*-non-reasoning\b)(?:.*\b(?:o1|o3|o4|r1|reasoning|reasoner|think|qwq|zero-preview|deepthink|hunyuan-t1|z1)\b.*)$/i;
const TOOLS_PATTERN = /\b(gpt-4|claude|gemini-1\.5|gemini-2|gemini-3|qwen|doubao|grok|llama-3|llama-4|mixtral|mistral|command-r|kimi)\b/i;
const WEBSEARCH_PATTERN = /\b(sonar|perplexity)\b/i;

/**
 * Infer model kind and capabilities from model ID via regex patterns.
 * Used as fallback when API and registry don't provide capabilities.
 */
export function resolveFromPatterns(modelId: string): PatternResult | undefined {
  const lower = modelId.toLowerCase();

  // Determine kind first
  let kind: ModelKind | undefined;
  if (EMBEDDING_PATTERN.test(lower)) {
    kind = 'embedding';
  } else if (RERANK_PATTERN.test(lower)) {
    kind = 'rerank';
  } else if (IMAGE_GEN_PATTERN.test(lower)) {
    kind = 'image';
  } else if (AUDIO_PATTERN.test(lower)) {
    kind = 'audio';
  } else if (VIDEO_PATTERN.test(lower)) {
    kind = 'video';
  }

  // Embedding and rerank models don't have chat abilities
  if (kind === 'embedding' || kind === 'rerank') {
    return { kind };
  }

  // Determine capabilities
  const caps: ModelCapabilities = {};
  if (VISION_PATTERN.test(lower)) {
    caps.vision = true;
  }
  if (REASONING_PATTERN.test(lower)) {
    caps.reasoning = true;
  }
  if (TOOLS_PATTERN.test(lower)) {
    caps.tools = true;
  }
  if (WEBSEARCH_PATTERN.test(lower)) {
    caps.webSearch = true;
  }

  const hasCaps = caps.vision || caps.reasoning || caps.tools || caps.webSearch;

  if (kind || hasCaps) {
    return {
      kind: kind || 'chat',
      capabilities: hasCaps ? caps : undefined,
    };
  }

  return undefined;
}
