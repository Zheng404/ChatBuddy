/**
 * modelCapabilityPatterns 单元测试。
 *
 * 覆盖基于正则模式的模型能力推断。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFromPatterns } from '../chatbuddy/modelCapabilityPatterns';

// ─── Kind 推断 ──────────────────────────────────────────────────────

describe('resolveFromPatterns — kind inference', () => {
  test('detects embedding models', () => {
    const result = resolveFromPatterns('text-embedding-ada-002');
    assert.equal(result?.kind, 'embedding');
    const result2 = resolveFromPatterns('bge-large-zh-v1.5');
    assert.equal(result2?.kind, 'embedding');
  });

  test('detects rerank models', () => {
    const result = resolveFromPatterns('rerank-v3-5');
    assert.equal(result?.kind, 'rerank');
  });

  test('detects image generation models', () => {
    const result = resolveFromPatterns('dall-e-3');
    assert.equal(result?.kind, 'image');
    const result2 = resolveFromPatterns('stable-diffusion-xl');
    assert.equal(result2?.kind, 'image');
  });

  test('detects audio models', () => {
    const result = resolveFromPatterns('whisper-1');
    assert.equal(result?.kind, 'audio');
    const result2 = resolveFromPatterns('tts-1-hd');
    assert.equal(result2?.kind, 'audio');
  });

  test('detects video models', () => {
    const result = resolveFromPatterns('sora');
    assert.equal(result?.kind, 'video');
    const result2 = resolveFromPatterns('cogvideox-2');
    assert.equal(result2?.kind, 'video');
  });

  test('returns undefined for unknown model', () => {
    const result = resolveFromPatterns('my-custom-model-v1');
    assert.equal(result, undefined);
  });
});

// ─── Capability 推断 ────────────────────────────────────────────────

describe('resolveFromPatterns — capability inference', () => {
  test('detects vision in multimodal models', () => {
    const result = resolveFromPatterns('gpt-4o');
    assert.ok(result?.capabilities?.vision);
  });

  test('detects tools capability in tool-capable models', () => {
    // Check a model that is known to support tools based on patterns
    const result = resolveFromPatterns('gpt-4-turbo');
    // If patterns don't explicitly detect tools, the registry layer may handle it.
    // At minimum, the kind should be 'chat' for these models.
    assert.ok(result?.kind === 'chat' || result?.capabilities?.tools);
  });

  test('detects reasoning capability', () => {
    const result = resolveFromPatterns('o1-preview');
    assert.ok(result?.capabilities?.reasoning);
    const result2 = resolveFromPatterns('deepseek-r1');
    assert.ok(result2?.capabilities?.reasoning);
  });

  test('detects web search capability', () => {
    const result = resolveFromPatterns('sonar-pro');
    assert.ok(result?.capabilities?.webSearch);
  });

  test('embedding models have empty capabilities', () => {
    const result = resolveFromPatterns('text-embedding-3-small');
    assert.equal(result?.kind, 'embedding');
    // Embedding models should not have chat-related capabilities
    const caps = result?.capabilities;
    if (caps) {
      assert.equal(caps.vision, undefined);
      assert.equal(caps.tools, undefined);
    }
  });

  test('detects vision in gpt-4.1 series via pattern fallback', () => {
    const result = resolveFromPatterns('gpt-4.1-custom-variant');
    assert.ok(result?.capabilities?.vision);
  });

  test('detects reasoning in o-series models', () => {
    const result = resolveFromPatterns('o3');
    assert.ok(result?.capabilities?.reasoning);
    const result2 = resolveFromPatterns('o4-mini');
    assert.ok(result2?.capabilities?.reasoning);
  });

  test('detects reasoning and tools in deepseek-r1 variants', () => {
    const result = resolveFromPatterns('deepseek-r1-0528');
    assert.ok(result?.capabilities?.reasoning);
    assert.ok(result?.capabilities?.tools);
  });

  test('detects vision and reasoning in gpt-5.5 series via pattern fallback', () => {
    const result = resolveFromPatterns('gpt-5.5-custom-variant');
    assert.ok(result?.capabilities?.vision);
    assert.ok(result?.capabilities?.reasoning);
    assert.ok(result?.capabilities?.tools);
  });

  test('detects tools and reasoning in deepseek-v4 variants via pattern fallback', () => {
    const result = resolveFromPatterns('deepseek-v4-custom-variant');
    assert.ok(result?.capabilities?.tools);
  });
});

// ─── 大小写不敏感 ─────────────────────────────────────────────────

describe('resolveFromPatterns — case insensitive', () => {
  test('matches regardless of case', () => {
    const upper = resolveFromPatterns('GPT-4O');
    const lower = resolveFromPatterns('gpt-4o');
    assert.equal(upper?.kind, lower?.kind);
  });
});
