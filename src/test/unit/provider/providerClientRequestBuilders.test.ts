/**
 * providerClientRequestBuilders 单元测试。
 *
 * 覆盖 URL 规范化、Provider 类型检测等纯函数。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBaseUrl,
  normalizeBaseUrlForDetect,
  isGeminiProvider,
  isOllamaProvider
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
