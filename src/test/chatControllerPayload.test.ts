/**
 * chatControllerPayload 单元测试。
 *
 * 覆盖 payload 构建、会话状态同步、Provider 配置解析等逻辑。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  syncSessionScopedState,
  resolveEffectiveProviderConfig,
  buildChatStatePayload,
  withGenerationState
} from '../chatbuddy/chatControllerPayload';
import type {
  AssistantProfile,
  ChatBuddySettings,
  ChatStatePayload,
  PersistedStateLite,
  ProviderModelOption
} from '../chatbuddy/types';

// ─── Helpers ────────────────────────────────────────────────────────

function makeAssistant(overrides: Partial<AssistantProfile> = {}): AssistantProfile {
  return {
    id: 'a1',
    name: 'Test Assistant',
    note: '',
    groupId: 'default',
    systemPrompt: '',
    greeting: '',
    questionPrefix: '',
    modelRef: 'p1:m1',
    temperature: 0.7,
    topP: 1,
    maxTokens: 2048,
    contextCount: 10,
    presencePenalty: 0,
    frequencyPenalty: 0,
    streaming: true,
    enabledMcpServerIds: [],
    pinned: false,
    isDeleted: false,
    lastInteractedAt: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  };
}

function makeSettings(overrides: Partial<ChatBuddySettings> = {}): ChatBuddySettings {
  return {
    providers: [
      {
        id: 'p1',
        name: 'Test Provider',
        enabled: true,
        apiType: 'chat_completions' as const,
        kind: 'openai' as const,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        models: [
          { id: 'm1', name: 'Model One' },
          { id: 'm2', name: 'Model Two' }
        ]
      }
    ],
    defaultModels: {},
    mcp: { servers: [], groups: [], maxToolRounds: 5 },
    temperature: 0.7,
    topP: 1,
    maxTokens: 2048,
    presencePenalty: 0,
    frequencyPenalty: 0,
    timeoutMs: 30000,
    streamingDefault: true,
    locale: 'auto' as const,
    sendShortcut: 'enter' as const,
    chatTabMode: 'single' as const,
    localBackup: { enabled: false, directory: '', intervalHours: 24, maxCount: 10, maxAgeDays: 30 },
    ...overrides
  };
}

function makeRawState(overrides: Partial<PersistedStateLite> = {}): PersistedStateLite {
  return {
    groups: [{ id: 'default', name: 'Default', kind: 'default' as const, createdAt: 0, updatedAt: 0 }],
    assistants: [makeAssistant()],
    selectedAssistantId: 'a1',
    selectedSessionIdByAssistant: {},
    sessionPanelCollapsed: false,
    collapsedGroupIds: [],
    templates: [],
    settings: makeSettings(),
    ...overrides
  };
}

// ─── syncSessionScopedState ─────────────────────────────────────────

describe('syncSessionScopedState', () => {
  test('no-ops when assistantId is empty', () => {
    const lastSelected: Record<string, string | undefined> = {};
    const tempModels: Record<string, string> = { s1: 'p1:m2' };
    syncSessionScopedState({
      assistantId: '',
      selectedSessionId: 's1',
      lastSelectedSessionIdByAssistant: lastSelected,
      sessionTempModelRefBySession: tempModels,
      sessionTempParamsBySession: {}
    });
    assert.deepEqual(lastSelected, {});
    assert.deepEqual(tempModels, { s1: 'p1:m2' });
  });

  test('no-ops when assistantId is undefined', () => {
    const lastSelected: Record<string, string | undefined> = {};
    syncSessionScopedState({
      assistantId: undefined,
      selectedSessionId: 's1',
      lastSelectedSessionIdByAssistant: lastSelected,
      sessionTempModelRefBySession: {},
      sessionTempParamsBySession: {}
    });
    assert.deepEqual(lastSelected, {});
  });

  test('deletes temp model ref when session changes', () => {
    const lastSelected: Record<string, string | undefined> = { a1: 's1' };
    const tempModels: Record<string, string> = { s1: 'p1:m2', s2: 'p1:m3' };
    syncSessionScopedState({
      assistantId: 'a1',
      selectedSessionId: 's2',
      lastSelectedSessionIdByAssistant: lastSelected,
      sessionTempModelRefBySession: tempModels,
      sessionTempParamsBySession: {}
    });
    assert.equal(lastSelected.a1, 's2');
    assert.equal(tempModels.s1, undefined);
    assert.equal(tempModels.s2, 'p1:m3');
  });

  test('does not delete temp ref when same session re-selected', () => {
    const lastSelected: Record<string, string | undefined> = { a1: 's1' };
    const tempModels: Record<string, string> = { s1: 'p1:m2' };
    syncSessionScopedState({
      assistantId: 'a1',
      selectedSessionId: 's1',
      lastSelectedSessionIdByAssistant: lastSelected,
      sessionTempModelRefBySession: tempModels,
      sessionTempParamsBySession: {}
    });
    assert.equal(tempModels.s1, 'p1:m2');
  });

  test('updates last selected session for new assistant', () => {
    const lastSelected: Record<string, string | undefined> = {};
    syncSessionScopedState({
      assistantId: 'a2',
      selectedSessionId: 's3',
      lastSelectedSessionIdByAssistant: lastSelected,
      sessionTempModelRefBySession: {},
      sessionTempParamsBySession: {}
    });
    assert.equal(lastSelected.a2, 's3');
  });

  test('handles undefined selectedSessionId', () => {
    const lastSelected: Record<string, string | undefined> = { a1: 's1' };
    const tempModels: Record<string, string> = { s1: 'p1:m2' };
    syncSessionScopedState({
      assistantId: 'a1',
      selectedSessionId: undefined,
      lastSelectedSessionIdByAssistant: lastSelected,
      sessionTempModelRefBySession: tempModels,
      sessionTempParamsBySession: {}
    });
    assert.equal(lastSelected.a1, undefined);
    assert.equal(tempModels.s1, undefined);
  });
});

// ─── resolveEffectiveProviderConfig ──────────────────────────────────

describe('resolveEffectiveProviderConfig', () => {
  test('uses resolveProviderConfig when no temp model ref', () => {
    const settings = makeSettings();
    const assistant = makeAssistant({ modelRef: 'p1:m1' });
    const result = resolveEffectiveProviderConfig({
      settings,
      assistant,
      sessionId: 's1',
      sessionTempModelRefBySession: {},
      sessionTempParamsBySession: {}
    });
    assert.ok(result.config);
    assert.equal(result.config.providerName, 'Test Provider');
    assert.equal(result.config.modelLabel, 'm1 | Test Provider');
  });

  test('uses resolveModelBindingConfig when temp model ref exists', () => {
    const settings = makeSettings();
    const assistant = makeAssistant({ modelRef: 'p1:m1', temperature: 0.5 });
    const result = resolveEffectiveProviderConfig({
      settings,
      assistant,
      sessionId: 's1',
      sessionTempModelRefBySession: { s1: 'p1:m2' },
      sessionTempParamsBySession: {}
    });
    assert.ok(result.config);
    assert.equal(result.config.modelLabel, 'm2 | Test Provider');
  });

  test('falls back when no sessionId provided', () => {
    const settings = makeSettings();
    const assistant = makeAssistant({ modelRef: 'p1:m1' });
    const result = resolveEffectiveProviderConfig({
      settings,
      assistant,
      sessionTempModelRefBySession: { s1: 'p1:m2' },
      sessionTempParamsBySession: {}
    });
    assert.ok(result.config);
    assert.equal(result.config.modelLabel, 'm1 | Test Provider');
  });

  test('falls back when temp model ref is invalid', () => {
    const settings = makeSettings();
    const assistant = makeAssistant({ modelRef: 'p1:m1' });
    const result = resolveEffectiveProviderConfig({
      settings,
      assistant,
      sessionId: 's1',
      sessionTempModelRefBySession: { s1: 'invalid' },
      sessionTempParamsBySession: {}
    });
    assert.ok(result.config);
    assert.equal(result.config.providerName, 'Test Provider');
  });
});

// ─── buildChatStatePayload ──────────────────────────────────────────

describe('buildChatStatePayload', () => {
  const resolvedConfig = {
    config: {
      providerName: 'Test Provider',
      modelLabel: 'Model One',
      apiType: 'chat_completions' as const,
      providerKind: 'openai' as const,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      modelId: 'm1',
      temperature: 0.7,
      topP: 1,
      maxTokens: 2048,
      contextCount: 10,
      presencePenalty: 0,
      frequencyPenalty: 0,
      timeoutMs: 30000,
      customHeaders: []
    },
    meta: { providerExists: true, providerEnabled: true, modelExists: true }
  };

  type PayloadArgs = Parameters<typeof buildChatStatePayload>[0];

  function makeArgs(overrides: Partial<PayloadArgs> = {}): PayloadArgs {
    const assistant = makeAssistant();
    const base: PayloadArgs = {
      locale: 'en',
      rawState: makeRawState(),
      assistant,
      sessions: [{ id: 's1', assistantId: 'a1', title: 'Session 1', titleSource: 'default', createdAt: 0, updatedAt: 0, messageCount: 0 }],
      selectedSession: undefined,
      pendingToolContinuation: undefined,
      getModelOption: (ref) => {
        const options: Record<string, ProviderModelOption> = {
          'p1:m1': { ref: 'p1:m1', providerId: 'p1', providerName: 'Test Provider', modelId: 'm1', label: 'Model One' },
          'p1:m2': { ref: 'p1:m2', providerId: 'p1', providerName: 'Test Provider', modelId: 'm2', label: 'Model Two' }
        };
        return ref ? options[ref] : undefined;
      },
      getServerSummaries: () => [],
      resolveProviderConfigForAssistant: () => resolvedConfig as unknown as ReturnType<PayloadArgs['resolveProviderConfigForAssistant']>,
      modelOptions: [
        { ref: 'p1:m1', providerId: 'p1', providerName: 'Test Provider', modelId: 'm1', label: 'Model One' },
        { ref: 'p1:m2', providerId: 'p1', providerName: 'Test Provider', modelId: 'm2', label: 'Model Two' }
      ],
      sessionTempModelRefBySession: {},
      sessionTempParamsBySession: {},
      streamingEnabled: false,
      error: undefined
    };
    return { ...base, ...overrides };
  }

  test('builds complete payload with assistant', () => {
    const payload = buildChatStatePayload(makeArgs());
    assert.equal(payload.canChat, true);
    assert.equal(payload.providerLabel, 'Test Provider');
    assert.equal(payload.modelLabel, 'Model One');
    assert.equal(payload.isGenerating, false);
    assert.equal(payload.awaitingToolContinuation, false);
    assert.equal(payload.pendingToolCallCount, 0);
    assert.equal(payload.locale, 'en');
    assert.ok(payload.strings);
    assert.equal(payload.modelOptions.length, 2);
    assert.equal(payload.streaming, true);
  });

  test('sets canChat false and readOnlyReason when no assistant', () => {
    const payload = buildChatStatePayload(makeArgs({ assistant: undefined }));
    assert.equal(payload.canChat, false);
    assert.ok(payload.readOnlyReason);
    assert.equal(payload.providerLabel, '-');
    assert.equal(payload.modelLabel, '-');
  });

  test('sets canChat false for deleted assistant', () => {
    const deleted = makeAssistant({ isDeleted: true });
    const payload = buildChatStatePayload(makeArgs({ assistant: deleted }));
    assert.equal(payload.canChat, false);
    assert.ok(payload.readOnlyReason);
    assert.equal(payload.providerLabel, 'Test Provider');
    assert.equal(payload.modelLabel, 'Model One');
  });

  test('sets awaitingToolContinuation when pending tools present', () => {
    const payload = buildChatStatePayload(makeArgs({
      pendingToolContinuation: {
        result: {
          toolCalls: [
            { id: 'tc1', name: 'tool1', argumentsText: '{}' },
            { id: 'tc2', name: 'tool2', argumentsText: '{}' }
          ]
        }
      }
    }));
    assert.equal(payload.canChat, false);
    assert.equal(payload.awaitingToolContinuation, true);
    assert.equal(payload.pendingToolCallCount, 2);
  });

  test('sets canChat false for both deleted and pending tools', () => {
    const deleted = makeAssistant({ isDeleted: true });
    const payload = buildChatStatePayload(makeArgs({
      assistant: deleted,
      pendingToolContinuation: { result: { toolCalls: [{ id: 'tc1', name: 't', argumentsText: '{}' }] } }
    }));
    assert.equal(payload.canChat, false);
    assert.equal(payload.awaitingToolContinuation, true);
  });

  test('respects streamingEnabled when assistant has no streaming', () => {
    const noStream = makeAssistant({ streaming: false });
    const payload = buildChatStatePayload(makeArgs({ assistant: noStream, streamingEnabled: true }));
    assert.equal(payload.streaming, false);
  });

  test('uses streamingEnabled when assistant is undefined', () => {
    const payload = buildChatStatePayload(makeArgs({ assistant: undefined, streamingEnabled: true }));
    assert.equal(payload.streaming, true);
  });

  test('passes through error field', () => {
    const payload = buildChatStatePayload(makeArgs({ error: 'Something broke' }));
    assert.equal(payload.error, 'Something broke');
  });

  test('sets sessionTempModelRef for selected session', () => {
    const payload = buildChatStatePayload(makeArgs({
      selectedSession: { id: 's1', assistantId: 'a1', title: 'Session 1', titleSource: 'default', messages: [], createdAt: 0, updatedAt: 0 },
      sessionTempModelRefBySession: { s1: 'p1:m2' }
    }));
    assert.equal(payload.sessionTempModelRef, 'p1:m2');
    assert.equal(payload.selectedSessionId, 's1');
  });

  test('sets empty sessionTempModelRef when no session selected', () => {
    const payload = buildChatStatePayload(makeArgs({ selectedSession: undefined }));
    assert.equal(payload.sessionTempModelRef, '');
    assert.equal(payload.selectedSessionId, '');
  });

  test('preserves toolRoundLimit from settings', () => {
    const payload = buildChatStatePayload(makeArgs());
    assert.equal(payload.toolRoundLimit, 5);
  });

  test('includes mcpServers from callback', () => {
    const payload = buildChatStatePayload(makeArgs({
      getServerSummaries: () => [{ id: 'mcp1', name: 'MCP Server', enabled: true, transport: 'stdio' as const }]
    }));
    assert.equal(payload.mcpServers.length, 1);
    assert.equal(payload.mcpServers[0].id, 'mcp1');
  });
});

// ─── withGenerationState ────────────────────────────────────────────

describe('withGenerationState', () => {
  test('overrides isGenerating to true', () => {
    const payload = {
      groups: [],
      assistants: [],
      sessions: [],
      sessionPanelCollapsed: false,
      locale: 'en' as const,
      strings: {},
      providerLabel: '-',
      modelLabel: '-',
      modelOptions: [],
      sessionTempModelRef: '',
      sessionTempParams: {},
      sendShortcut: 'enter' as const,
      streaming: false,
      isGenerating: false,
      canChat: false,
      mcpServers: [],
      awaitingToolContinuation: false,
      pendingToolCallCount: 0,
      toolRoundLimit: 5,
      templates: []
    };
    const result = withGenerationState(payload, true);
    assert.equal(result.isGenerating, true);
    assert.equal(result.locale, 'en');
  });

  test('overrides isGenerating to false', () => {
    const payload = {
      groups: [],
      assistants: [],
      sessions: [],
      sessionPanelCollapsed: false,
      locale: 'en' as const,
      strings: {},
      providerLabel: '-',
      modelLabel: '-',
      modelOptions: [],
      sessionTempModelRef: '',
      sessionTempParams: {},
      sendShortcut: 'enter' as const,
      streaming: false,
      isGenerating: true,
      canChat: false,
      mcpServers: [],
      awaitingToolContinuation: false,
      pendingToolCallCount: 0,
      toolRoundLimit: 5,
      templates: []
    };
    const result = withGenerationState(payload, false);
    assert.equal(result.isGenerating, false);
  });

  test('preserves all other fields', () => {
    const payload: ChatStatePayload = {
      groups: [{ id: 'g1', name: 'G1', kind: 'custom', createdAt: 0, updatedAt: 0 }],
      assistants: [makeAssistant()],
      sessions: [{ id: 's1', assistantId: 'a1', title: 'S1', titleSource: 'default', createdAt: 0, updatedAt: 0, messageCount: 0 }],
      selectedAssistant: makeAssistant(),
      selectedAssistantId: 'a1',
      selectedSessionId: 's1',
      sessionPanelCollapsed: true,
      locale: 'zh-CN',
      strings: { key: 'value' },
      providerLabel: 'Provider',
      modelLabel: 'Model',
      modelOptions: [{ ref: 'p1:m1', providerId: 'p1', providerName: 'Test', modelId: 'm1', label: 'M1' }],
      sessionTempModelRef: 'p1:m2',
      sessionTempParams: {},
      sendShortcut: 'ctrlEnter' as const,
      streaming: true,
      isGenerating: false,
      canChat: true,
      mcpServers: [{ id: 'mcp1', name: 'MCP1', enabled: true, transport: 'stdio' as const }],
      awaitingToolContinuation: true,
      pendingToolCallCount: 3,
      toolRoundLimit: 10,
      readOnlyReason: 'test',
      templates: []
    };
    const result = withGenerationState(payload, true);
    assert.equal(result.isGenerating, true);
    assert.deepEqual(result.groups, payload.groups);
    assert.equal(result.providerLabel, 'Provider');
    assert.equal(result.canChat, true);
    assert.equal(result.readOnlyReason, 'test');
  });
});
