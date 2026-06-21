/**
 * providerClientRequestBuilders 单元测试。
 *
 * 覆盖 URL 规范化、Provider 类型检测、鉴权头构造等纯函数。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBaseUrl,
  normalizeBaseUrlForDetect,
  isGeminiProvider,
  isOllamaProvider,
  createHeaders
} from '../../../chatbuddy/providerClientRequestBuilders';

// ─── normalizeBaseUrl ────────────────────────────────────────────────

describe('normalizeBaseUrl', () => {
  test('removes trailing slash', () => {
    assert.equal(normalizeBaseUrl('https://api.openai.com/'), 'https://api.openai.com');
  });

  test('removes multiple trailing slashes', () => {
    assert.equal(normalizeBaseUrl('https://api.example.com///'), 'https://api.example.com');
  });

  test('keeps base URL as-is when no trailing slash', () => {
    assert.equal(normalizeBaseUrl('https://api.example.com'), 'https://api.example.com');
  });

  test('preserves path segments', () => {
    assert.equal(normalizeBaseUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1');
  });

  test('handles empty string', () => {
    assert.equal(normalizeBaseUrl(''), '');
  });
});

// ─── normalizeBaseUrlForDetect ───────────────────────────────────────

describe('normalizeBaseUrlForDetect', () => {
  test('returns empty string for undefined', () => {
    assert.equal(normalizeBaseUrlForDetect(undefined), '');
  });

  test('lowercases and trims', () => {
    assert.equal(normalizeBaseUrlForDetect('  HTTPS://API.EXAMPLE.COM  '), 'https://api.example.com');
  });
});

// ─── isGeminiProvider ────────────────────────────────────────────────

describe('isGeminiProvider', () => {
  test('detects generativelanguage.googleapis.com', () => {
    assert.equal(isGeminiProvider({ kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }), true);
  });

  test('detects kind gemini with empty base', () => {
    assert.equal(isGeminiProvider({ kind: 'gemini', baseUrl: '' }), true);
  });

  test('returns false for openai provider', () => {
    assert.equal(isGeminiProvider({ kind: 'openai', baseUrl: 'https://api.openai.com' }), false);
  });

  test('returns false for empty', () => {
    assert.equal(isGeminiProvider({ kind: 'openai', baseUrl: '' }), false);
  });
});

// ─── isOllamaProvider ────────────────────────────────────────────────

describe('isOllamaProvider', () => {
  test('detects localhost:11434', () => {
    assert.equal(isOllamaProvider({ kind: 'openai', baseUrl: 'http://localhost:11434' }), true);
  });

  test('detects 127.0.0.1:11434', () => {
    assert.equal(isOllamaProvider({ kind: 'openai', baseUrl: 'http://127.0.0.1:11434' }), true);
  });

  test('detects /api/tags path', () => {
    assert.equal(isOllamaProvider({ kind: 'openai', baseUrl: 'http://my-server/api/tags' }), true);
  });

  test('detects kind ollama with empty base', () => {
    assert.equal(isOllamaProvider({ kind: 'ollama', baseUrl: '' }), true);
  });

  test('returns false for openai provider', () => {
    assert.equal(isOllamaProvider({ kind: 'openai', baseUrl: 'https://api.openai.com' }), false);
  });

  test('returns false for generic url', () => {
    assert.equal(isOllamaProvider({ kind: 'openai', baseUrl: 'https://my-api.example.com' }), false);
  });
});

// ─── createHeaders ───────────────────────────────────────────────────

describe('createHeaders', () => {
  function buildProvider(overrides: Partial<{ kind: string; baseUrl: string; apiKey: string; apiType: string }>): {
    id: string;
    kind: 'openai' | 'gemini';
    name: string;
    apiType: 'chat_completions' | 'gemini' | 'responses';
    apiKey: string;
    baseUrl: string;
  } {
    return {
      id: 'test-provider',
      name: 'Test Provider',
      kind: (overrides.kind as 'openai' | 'gemini') ?? 'openai',
      apiType: (overrides.apiType as 'chat_completions' | 'gemini' | 'responses') ?? 'chat_completions',
      apiKey: overrides.apiKey ?? '',
      baseUrl: overrides.baseUrl ?? ''
    };
  }

  test('OpenAI 兼容 Provider 设置 Authorization Bearer', () => {
    const headers = createHeaders(buildProvider({ kind: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-test' }));
    assert.equal(headers.Authorization, 'Bearer sk-test');
    assert.equal(headers['x-goog-api-key'], undefined);
    assert.equal(headers['Content-Type'], 'application/json');
  });

  test('Gemini 原生 API 仅设置 x-goog-api-key，不发送 Authorization', () => {
    // 回归：bug 11 — Gemini 同时发送 Authorization 和 x-goog-api-key 会被部分网关拒绝
    const headers = createHeaders(buildProvider({ kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'AIza-test' }));
    assert.equal(headers['x-goog-api-key'], 'AIza-test');
    assert.equal(headers.Authorization, undefined, 'Gemini 不应同时发送 Authorization 头');
  });

  test('Gemini 兼容 OpenAI 端点（/v1beta/openai）仍走 x-goog-api-key', () => {
    const headers = createHeaders(buildProvider({ kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: 'AIza-test' }));
    assert.equal(headers['x-goog-api-key'], 'AIza-test');
    assert.equal(headers.Authorization, undefined);
  });

  test('空 apiKey 不设置任何鉴权头', () => {
    const headers = createHeaders(buildProvider({ kind: 'openai', baseUrl: 'https://api.openai.com', apiKey: '  ' }));
    assert.equal(headers.Authorization, undefined);
    assert.equal(headers['x-goog-api-key'], undefined);
  });

  test('json=false 时不设置 Content-Type', () => {
    const headers = createHeaders(buildProvider({ kind: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-test' }), false);
    assert.equal(headers['Content-Type'], undefined);
    assert.equal(headers.Authorization, 'Bearer sk-test');
  });

  test('apiKey 在构造头时被 trim', () => {
    const headers = createHeaders(buildProvider({ kind: 'openai', baseUrl: 'https://api.openai.com', apiKey: '  sk-test  ' }));
    assert.equal(headers.Authorization, 'Bearer sk-test');
  });
});
