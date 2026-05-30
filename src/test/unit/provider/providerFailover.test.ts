/**
 * Provider Failover 单元测试。
 *
 * 覆盖故障切换链解析、无效后备跳过、错误分类等逻辑。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFailoverChain, HttpError } from '../../../chatbuddy/providerClient';
import type { AssistantProfile, ChatBuddySettings, ProviderProfile } from '../../../chatbuddy/types';

// ─── Helpers ────────────────────────────────────────────────────────

function createMockSettings(providers: ProviderProfile[]): ChatBuddySettings {
  return {
    providers,
    defaultModels: {},
    mcp: { servers: [], maxToolRounds: 8, groups: [] },
    temperature: 0.7,
    topP: 1,
    maxTokens: 0,
    presencePenalty: 0,
    frequencyPenalty: 0,
    timeoutMs: 300000,
    streamingDefault: true,
    locale: 'auto',
    sendShortcut: 'enter',
    chatTabMode: 'single',
    localBackup: { enabled: false, directory: '', intervalHours: 24, maxCount: 10, maxAgeDays: 30 }
  };
}

function createMockAssistant(overrides?: Partial<AssistantProfile>): AssistantProfile {
  return {
    id: 'test-assistant',
    name: 'Test',
    note: '',
    groupId: 'default',
    systemPrompt: '',
    greeting: '',
    questionPrefix: '',
    modelRef: 'openai:gpt-4o',
    temperature: 0.7,
    topP: 1,
    maxTokens: 0,
    contextCount: 16,
    presencePenalty: 0,
    frequencyPenalty: 0,
    streaming: true,
    enabledMcpServerIds: [],
    pinned: false,
    isDeleted: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastInteractedAt: Date.now(),
    ...overrides
  };
}

function createMockProvider(id: string, enabled: boolean, models: string[]): ProviderProfile {
  return {
    id,
    kind: 'custom',
    name: id,
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com/v1',
    apiType: 'chat_completions',
    enabled,
    models: models.map((m) => ({ id: m, name: m }))
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('resolveFailoverChain', () => {
  test('returns primary config when no failoverModelRefs', () => {
    const provider = createMockProvider('openai', true, ['gpt-4o']);
    const settings = createMockSettings([provider]);
    const assistant = createMockAssistant({ modelRef: 'openai:gpt-4o' });

    const chain = resolveFailoverChain(settings, assistant);

    assert.strictEqual(chain.length, 1);
    assert.strictEqual(chain[0].config.providerId, 'openai');
    assert.strictEqual(chain[0].config.modelId, 'gpt-4o');
  });

  test('includes valid failover models in chain', () => {
    const openai = createMockProvider('openai', true, ['gpt-4o']);
    const gemini = createMockProvider('gemini', true, ['gemini-pro']);
    const settings = createMockSettings([openai, gemini]);
    const assistant = createMockAssistant({
      modelRef: 'openai:gpt-4o',
      failoverModelRefs: ['gemini:gemini-pro']
    });

    const chain = resolveFailoverChain(settings, assistant);

    assert.strictEqual(chain.length, 2);
    assert.strictEqual(chain[0].config.providerId, 'openai');
    assert.strictEqual(chain[1].config.providerId, 'gemini');
  });

  test('skips invalid failover providers silently', () => {
    const openai = createMockProvider('openai', true, ['gpt-4o']);
    const settings = createMockSettings([openai]);
    const assistant = createMockAssistant({
      modelRef: 'openai:gpt-4o',
      failoverModelRefs: ['nonexistent:model']
    });

    const chain = resolveFailoverChain(settings, assistant);

    assert.strictEqual(chain.length, 1);
    assert.strictEqual(chain[0].config.providerId, 'openai');
  });

  test('skips disabled providers', () => {
    const openai = createMockProvider('openai', true, ['gpt-4o']);
    const gemini = createMockProvider('gemini', false, ['gemini-pro']);
    const settings = createMockSettings([openai, gemini]);
    const assistant = createMockAssistant({
      modelRef: 'openai:gpt-4o',
      failoverModelRefs: ['gemini:gemini-pro']
    });

    const chain = resolveFailoverChain(settings, assistant);

    assert.strictEqual(chain.length, 1);
  });

  test('skips duplicate model refs', () => {
    const openai = createMockProvider('openai', true, ['gpt-4o']);
    const settings = createMockSettings([openai]);
    const assistant = createMockAssistant({
      modelRef: 'openai:gpt-4o',
      failoverModelRefs: ['openai:gpt-4o', 'openai:gpt-4o']
    });

    const chain = resolveFailoverChain(settings, assistant);

    assert.strictEqual(chain.length, 1);
  });

  test('skips providers without api key', () => {
    const openai = createMockProvider('openai', true, ['gpt-4o']);
    const noKeyProvider: ProviderProfile = {
      ...createMockProvider('nokey', true, ['model']),
      apiKey: ''
    };
    const settings = createMockSettings([openai, noKeyProvider]);
    const assistant = createMockAssistant({
      modelRef: 'openai:gpt-4o',
      failoverModelRefs: ['nokey:model']
    });

    const chain = resolveFailoverChain(settings, assistant);

    assert.strictEqual(chain.length, 1);
  });

  test('preserves assistant parameters in failover configs', () => {
    const openai = createMockProvider('openai', true, ['gpt-4o']);
    const gemini = createMockProvider('gemini', true, ['gemini-pro']);
    const settings = createMockSettings([openai, gemini]);
    const assistant = createMockAssistant({
      modelRef: 'openai:gpt-4o',
      failoverModelRefs: ['gemini:gemini-pro'],
      temperature: 0.5,
      topP: 0.9,
      maxTokens: 2048,
      stopSequences: ['stop'],
      seed: 42
    });

    const chain = resolveFailoverChain(settings, assistant);

    assert.strictEqual(chain.length, 2);
    for (const item of chain) {
      assert.strictEqual(item.config.temperature, 0.5);
      assert.strictEqual(item.config.topP, 0.9);
      assert.strictEqual(item.config.maxTokens, 2048);
      assert.deepStrictEqual(item.config.stopSequences, ['stop']);
      assert.strictEqual(item.config.seed, 42);
    }
  });

  test('handles empty failoverModelRefs array', () => {
    const openai = createMockProvider('openai', true, ['gpt-4o']);
    const settings = createMockSettings([openai]);
    const assistant = createMockAssistant({
      modelRef: 'openai:gpt-4o',
      failoverModelRefs: []
    });

    const chain = resolveFailoverChain(settings, assistant);

    assert.strictEqual(chain.length, 1);
  });

  test('handles multiple valid failover models', () => {
    const openai = createMockProvider('openai', true, ['gpt-4o']);
    const gemini = createMockProvider('gemini', true, ['gemini-pro']);
    const router = createMockProvider('router', true, ['claude']);
    const settings = createMockSettings([openai, gemini, router]);
    const assistant = createMockAssistant({
      modelRef: 'openai:gpt-4o',
      failoverModelRefs: ['gemini:gemini-pro', 'router:claude']
    });

    const chain = resolveFailoverChain(settings, assistant);

    assert.strictEqual(chain.length, 3);
    assert.strictEqual(chain[0].config.providerId, 'openai');
    assert.strictEqual(chain[1].config.providerId, 'gemini');
    assert.strictEqual(chain[2].config.providerId, 'router');
  });
});

describe('HttpError', () => {
  test('carries HTTP status code', () => {
    const error = new HttpError(429, 'Rate limited');
    assert.strictEqual(error.status, 429);
    assert.strictEqual(error.message, 'Rate limited');
    assert.strictEqual(error.name, 'HttpError');
  });

  test('401 is auth error', () => {
    const error = new HttpError(401, 'Unauthorized');
    assert.strictEqual(error.status, 401);
  });

  test('500 is server error', () => {
    const error = new HttpError(500, 'Server error');
    assert.strictEqual(error.status, 500);
  });
});
