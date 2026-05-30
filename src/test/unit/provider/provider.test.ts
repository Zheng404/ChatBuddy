import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeProvider } from '../../../chatbuddy/utils/provider';
import type { ProviderProfile } from '../../../chatbuddy/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProvider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'p1',
    kind: 'openai',
    name: 'OpenAI',
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    apiType: 'chat_completions',
    enabled: true,
    models: [
      { id: 'gpt-4', name: 'GPT-4', kind: 'chat', source: 'manual', capabilities: {} }
    ],
    ...overrides
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('normalizeProvider - preserves known kinds', () => {
  const kinds: Array<ProviderProfile['kind']> = ['openai', 'gemini', 'openrouter', 'ollama'];
  for (const kind of kinds) {
    const result = normalizeProvider(makeProvider({ kind }));
    assert.equal(result.kind, kind, `kind "${kind}" should be preserved`);
  }
});

test('normalizeProvider - unknown kind becomes "custom"', () => {
  const result = normalizeProvider(makeProvider({ kind: 'custom' }));
  assert.equal(result.kind, 'custom');
});

test('normalizeProvider - arbitrary string kind becomes "custom"', () => {
  const result = normalizeProvider(makeProvider({ kind: 'unknown-provider' as ProviderProfile['kind'] }));
  assert.equal(result.kind, 'custom');
});

test('normalizeProvider - trims id', () => {
  const result = normalizeProvider(makeProvider({ id: '  p1  ' }));
  assert.equal(result.id, 'p1');
});

test('normalizeProvider - trims name', () => {
  const result = normalizeProvider(makeProvider({ name: '  OpenAI  ' }));
  assert.equal(result.name, 'OpenAI');
});

test('normalizeProvider - trims apiKey', () => {
  const result = normalizeProvider(makeProvider({ apiKey: '  sk-test-key  ' }));
  assert.equal(result.apiKey, 'sk-test-key');
});

test('normalizeProvider - trims baseUrl', () => {
  const result = normalizeProvider(makeProvider({ baseUrl: '  https://api.openai.com/v1  ' }));
  assert.equal(result.baseUrl, 'https://api.openai.com/v1');
});

test('normalizeProvider - normalizes apiType to chat_completions (valid)', () => {
  const result = normalizeProvider(makeProvider({ apiType: 'chat_completions' }));
  assert.equal(result.apiType, 'chat_completions');
});

test('normalizeProvider - normalizes apiType to responses (valid)', () => {
  const result = normalizeProvider(makeProvider({ apiType: 'responses' }));
  assert.equal(result.apiType, 'responses');
});

test('normalizeProvider - normalizes invalid apiType to chat_completions (default)', () => {
  const result = normalizeProvider(makeProvider({ apiType: 'invalid' as ProviderProfile['apiType'] }));
  assert.equal(result.apiType, 'chat_completions');
});

test('normalizeProvider - enabled defaults to true when undefined', () => {
  const result = normalizeProvider(makeProvider({ enabled: undefined }));
  assert.equal(result.enabled, true);
});

test('normalizeProvider - preserves enabled=false', () => {
  const result = normalizeProvider(makeProvider({ enabled: false }));
  assert.equal(result.enabled, false);
});

test('normalizeProvider - preserves enabled=true', () => {
  const result = normalizeProvider(makeProvider({ enabled: true }));
  assert.equal(result.enabled, true);
});

test('normalizeProvider - preserves models array (sorted by id)', () => {
  const models = [
    { id: 'gpt-4', name: 'GPT-4', kind: 'chat' as const, source: 'manual' as const, capabilities: {} },
    { id: 'gpt-3.5', name: 'GPT-3.5', kind: 'chat' as const, source: 'fetched' as const, capabilities: {} }
  ];
  const result = normalizeProvider(makeProvider({ models }));
  assert.equal(result.models.length, 2);
  // dedupeModels sorts by id alphabetically: gpt-3.5 < gpt-4
  assert.equal(result.models[0].id, 'gpt-3.5');
  assert.equal(result.models[1].id, 'gpt-4');
});

test('normalizeProvider - deduplicates models', () => {
  const models = [
    { id: 'gpt-4', name: 'GPT-4', kind: 'chat' as const, source: 'manual' as const, capabilities: {} },
    { id: 'gpt-4', name: 'GPT-4 Duplicate', kind: 'chat' as const, source: 'fetched' as const, capabilities: {} },
    { id: 'gpt-4', name: 'GPT-4 Third', kind: 'chat' as const, source: 'manual' as const, capabilities: { vision: true } }
  ];
  const result = normalizeProvider(makeProvider({ models }));
  assert.equal(result.models.length, 1, 'duplicate model IDs should be deduplicated');
  assert.equal(result.models[0].id, 'gpt-4');
});

test('normalizeProvider - empty models defaults to empty array', () => {
  const result = normalizeProvider(makeProvider({ models: undefined }));
  assert.deepEqual(result.models, []);
});

test('normalizeProvider - string models are normalized to ProviderModelProfile (sorted by id)', () => {
  const models = ['gpt-4', 'gpt-3.5'] as unknown as ProviderProfile['models'];
  const result = normalizeProvider(makeProvider({ models }));
  assert.equal(result.models.length, 2);
  // dedupeModels sorts by id alphabetically: gpt-3.5 < gpt-4
  assert.equal(result.models[0].id, 'gpt-3.5');
  assert.equal(result.models[1].id, 'gpt-4');
});

test('normalizeProvider - preserves modelLastSyncedAt when it is a number', () => {
  const result = normalizeProvider(makeProvider({ modelLastSyncedAt: 1713984000000 }));
  assert.equal(result.modelLastSyncedAt, 1713984000000);
});

test('normalizeProvider - removes modelLastSyncedAt when not a number', () => {
  const result = normalizeProvider(makeProvider({ modelLastSyncedAt: 'invalid' as unknown as number }));
  assert.equal(result.modelLastSyncedAt, undefined);
});

test('normalizeProvider - keeps modelLastSyncedAt when undefined', () => {
  const result = normalizeProvider(makeProvider({ modelLastSyncedAt: undefined }));
  assert.equal(result.modelLastSyncedAt, undefined);
});

test('normalizeProvider - full normalization with all fields', () => {
  const result = normalizeProvider({
    id: '  custom-p  ',
    kind: 'anthropic' as ProviderProfile['kind'],
    name: '  Anthropic  ',
    apiKey: '  sk-ant-test  ',
    baseUrl: '  https://api.anthropic.com/v1  ',
    apiType: 'custom-type' as ProviderProfile['apiType'],
    enabled: false,
    models: [
      { id: 'claude-3', name: 'Claude 3', kind: 'chat', source: 'manual', capabilities: {} }
    ],
    modelLastSyncedAt: 1713984000000
  });
  assert.equal(result.id, 'custom-p');
  assert.equal(result.kind, 'custom');
  assert.equal(result.name, 'Anthropic');
  assert.equal(result.apiKey, 'sk-ant-test');
  assert.equal(result.baseUrl, 'https://api.anthropic.com/v1');
  assert.equal(result.apiType, 'chat_completions');
  assert.equal(result.enabled, false);
  assert.equal(result.models.length, 1);
  assert.equal(result.modelLastSyncedAt, 1713984000000);
});
