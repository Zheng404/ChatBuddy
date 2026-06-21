/**
 * providerClientModelFetchers 单元测试。
 *
 * 重点覆盖 Bug 3：Ollama 模型列表 URL 在 baseUrl 已含 /api/tags 时不应重复拼接。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchProviderModels } from '../../../chatbuddy/providerClientModelFetchers';
import type { ProviderConnectionInput } from '../../../chatbuddy/providerClientTypes';

/** 捕获 fetch 请求的 URL，返回指定的 JSON 响应。 */
function mockFetch捕获Url(jsonBody: unknown): { urls: string[]; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  (globalThis as { fetch: typeof fetch }).fetch = async (input: unknown, _init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as { url?: string })?.url ?? String(input);
    urls.push(url);
    return new Response(JSON.stringify(jsonBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  return {
    urls,
    restore: () => {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  };
}

function makeOllamaProvider(baseUrl: string): ProviderConnectionInput {
  return {
    id: 'ollama-1',
    kind: 'ollama',
    name: 'Ollama',
    apiType: 'chat_completions',
    apiKey: '',
    baseUrl
  };
}

describe('fetchProviderModels — Ollama URL construction (Bug 3)', () => {
  test('appends /api/tags to plain base URL', async () => {
    const mock = mockFetch捕获Url({ models: [{ name: 'llama3' }] });
    try {
      const models = await fetchProviderModels(makeOllamaProvider('http://localhost:11434'), 'en');
      assert.strictEqual(mock.urls.length, 1);
      assert.strictEqual(mock.urls[0], 'http://localhost:11434/api/tags');
      assert.ok(models.length >= 1);
    } finally {
      mock.restore();
    }
  });

  test('does not duplicate /api/tags when baseUrl already ends with it', async () => {
    const mock = mockFetch捕获Url({ models: [{ name: 'llama3' }] });
    try {
      const models = await fetchProviderModels(
        makeOllamaProvider('http://localhost:11434/api/tags'),
        'en'
      );
      // Bug 3 修复前会拼成 http://localhost:11434/api/tags/api/tags
      assert.strictEqual(mock.urls.length, 1);
      assert.strictEqual(mock.urls[0], 'http://localhost:11434/api/tags');
      assert.ok(models.length >= 1);
    } finally {
      mock.restore();
    }
  });

  test('strips trailing /v1 before appending /api/tags', async () => {
    const mock = mockFetch捕获Url({ models: [{ name: 'llama3' }] });
    try {
      const models = await fetchProviderModels(
        makeOllamaProvider('http://localhost:11434/v1'),
        'en'
      );
      assert.strictEqual(mock.urls.length, 1);
      assert.strictEqual(mock.urls[0], 'http://localhost:11434/api/tags');
      assert.ok(models.length >= 1);
    } finally {
      mock.restore();
    }
  });

  test('strips trailing slash before appending /api/tags', async () => {
    const mock = mockFetch捕获Url({ models: [{ name: 'llama3' }] });
    try {
      await fetchProviderModels(
        makeOllamaProvider('http://localhost:11434/'),
        'en'
      );
      assert.strictEqual(mock.urls.length, 1);
      assert.strictEqual(mock.urls[0], 'http://localhost:11434/api/tags');
    } finally {
      mock.restore();
    }
  });
});
