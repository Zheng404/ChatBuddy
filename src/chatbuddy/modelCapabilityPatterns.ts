/**
 * 模型能力正则模式匹配模块。
 *
 * 通过模型 ID 的命名模式推断模型类型和功能能力，
 * 作为能力推断的最后一层回退（API > 注册表 > 模式）。
 */
import { ModelCapabilities, ModelKind } from './types';

type PatternResult = {
  kind?: ModelKind;
  capabilities?: ModelCapabilities;
};

// ── Kind patterns (output type) ──────────────────────────────

const EMBEDDING_PATTERN = /(?:^text-|embed|bge-|e5-|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i;
const RERANK_PATTERN = /(?:^rerank|re-rank|re-ranker|re-ranking)/i;
const IMAGE_GEN_PATTERN = /(?:dall-e|stable-diffusion|midjourney|flux|cogview|imagen|sd3|sdxl|playground|ideogram|image-generation|gpt-image|grok-imagine-image|nova-canvas)/i;
const AUDIO_PATTERN = /(?:whisper|tts[-_]?1|speech|bark|elevenlabs|gpt-realtime|gpt-audio|gpt-4o-transcribe|gpt-4o-mini-tts|voxtral)/i;
const VIDEO_PATTERN = /(?:runway|kling|pika|sora|cogvideo|stable-video|animate|video-generation|grok-imagine-video|nova-reel|veo)/i;

// ── Ability patterns (functional capabilities) ──────────────

const VISION_PATTERN = /\b(vision|vl[-_]?|4o(?!-mini-tts|-transcribe)|gpt-4\.1|gpt-5\.5|claude-3|claude-4|claude-opus|claude-sonnet|claude-haiku|gemini-1\.5|gemini-2|gemini-3|glm-4v|glm-5v|llava|minicpm|pixtral|qwq-vl|kimi-k2\.5|nova-premier|nova-pro|nova-lite|llama-4|grok-4|step-r1-v)\b/i;
const REASONING_PATTERN = /^(?!.*(?:-non-reasoning|mini-tts|transcribe)\b)(?:.*\b(?:o1|o3|o4|r1|reasoning|reasoner|think(?!ing-turbo)|qwq|zero-preview|deepthink|hunyuan-t1|z1|magistral|spark-x2|glm-5|gpt-5\.[45]|step-3)\b.*)$/i;
const TOOLS_PATTERN = /\b(gpt-4|gpt-5|claude|gemini|qwen|doubao|grok[-_]?[34]|llama-[34]|mixtral|mistral|command-[-ra]|kimi[-_]k|minimax|deepseek|hunyuan|step-|spark-|nova-premier|nova-pro|nova-lite|nova-micro|devstral|codestral)\b/i;
const WEBSEARCH_PATTERN = /\b(sonar|perplexity|web[-_]?search)\b/i;

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
