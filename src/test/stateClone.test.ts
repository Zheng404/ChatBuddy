import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cloneProvider,
  cloneGroup,
  cloneAssistant,
  cloneMcpServer,
  cloneMcpSettings,
  cloneSession,
  cloneSessionSummary,
  cloneMcpKeyValueEntries
} from '../chatbuddy/stateClone';
import type {
  AssistantGroup,
  AssistantProfile,
  ProviderProfile,
  McpServerProfile,
  McpSettings,
  ChatSession,
  ChatSessionSummary,
  McpKeyValueEntry
} from '../chatbuddy/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAssistant(overrides: Partial<AssistantProfile> = {}): AssistantProfile {
  return {
    id: 'a1',
    name: 'Test',
    note: '',
    avatar: 'account',
    groupId: 'default',
    systemPrompt: '',
    greeting: '',
    questionPrefix: '',
    modelRef: 'p1:m1',
    temperature: 0.7,
    topP: 1,
    maxTokens: 0,
    contextCount: 16,
    presencePenalty: 0,
    frequencyPenalty: 0,
    streaming: true,
    enabledMcpServerIds: ['s1', 's2'],
    pinned: false,
    isDeleted: false,
    createdAt: 1000,
    updatedAt: 1000,
    lastInteractedAt: 1000,
    overrides: { temperature: 0.5 },
    ...overrides
  };
}

function makeProvider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'p1',
    kind: 'openai',
    name: 'Test Provider',
    apiKey: 'key-123',
    baseUrl: 'https://api.example.com',
    apiType: 'chat_completions',
    enabled: true,
    models: [{ id: 'm1', name: 'Model 1' }],
    ...overrides
  };
}

function makeMcpServer(overrides: Partial<McpServerProfile> = {}): McpServerProfile {
  return {
    id: 's1',
    name: 'Test Server',
    enabled: true,
    transport: 'stdio',
    command: 'node',
    args: ['server.js', '--verbose'],
    cwd: '/tmp',
    env: [{ key: 'API_KEY', value: 'secret' }],
    url: '',
    headers: [{ key: 'Authorization', value: 'Bearer token' }],
    timeoutMs: 60000,
    remotePassthroughEnabled: false,
    ...overrides
  };
}

// ─── cloneProvider ───────────────────────────────────────────────────────────

test('cloneProvider returns a deep copy of models array', () => {
  const original = makeProvider();
  const cloned = cloneProvider(original);

  assert.notEqual(cloned.models, original.models);
  assert.notEqual(cloned.models[0], original.models[0]);
  assert.deepEqual(cloned, original);
});

test('cloneProvider mutations do not affect original', () => {
  const original = makeProvider();
  const cloned = cloneProvider(original);

  cloned.models.push({ id: 'm2', name: 'Model 2' });
  cloned.models[0].name = 'Hacked';
  cloned.name = 'Hacked';

  assert.equal(original.models.length, 1);
  assert.equal(original.models[0].name, 'Model 1');
  assert.equal(original.name, 'Test Provider');
});

// ─── cloneGroup ──────────────────────────────────────────────────────────────

test('cloneGroup returns an equal but distinct object', () => {
  const group: AssistantGroup = {
    id: 'g1',
    name: 'My Group',
    kind: 'custom',
    createdAt: 1000,
    updatedAt: 2000
  };
  const cloned = cloneGroup(group);

  assert.deepEqual(cloned, group);
  assert.notEqual(cloned, group);

  cloned.name = 'Changed';
  assert.equal(group.name, 'My Group');
});

// ─── cloneAssistant ──────────────────────────────────────────────────────────

test('cloneAssistant deep copies enabledMcpServerIds', () => {
  const original = makeAssistant();
  const cloned = cloneAssistant(original);

  assert.notEqual(cloned.enabledMcpServerIds, original.enabledMcpServerIds);
  assert.deepEqual(cloned.enabledMcpServerIds, original.enabledMcpServerIds);
});

test('cloneAssistant deep copies overrides', () => {
  const original = makeAssistant();
  const cloned = cloneAssistant(original);

  assert.notEqual(cloned.overrides, original.overrides);
  assert.deepEqual(cloned.overrides, original.overrides);
});

test('cloneAssistant handles undefined overrides', () => {
  const original = makeAssistant({ overrides: undefined });
  const cloned = cloneAssistant(original);

  assert.equal(cloned.overrides, undefined);
});

test('cloneAssistant mutations do not affect original', () => {
  const original = makeAssistant();
  const cloned = cloneAssistant(original);

  cloned.enabledMcpServerIds.push('s3');
  cloned.name = 'Hacked';
  if (cloned.overrides) {
    cloned.overrides.temperature = 99;
  }

  assert.equal(original.enabledMcpServerIds.length, 2);
  assert.equal(original.name, 'Test');
  assert.equal(original.overrides?.temperature, 0.5);
});

// ─── cloneMcpServer ──────────────────────────────────────────────────────────

test('cloneMcpServer deep copies args, env, headers', () => {
  const original = makeMcpServer();
  const cloned = cloneMcpServer(original);

  assert.notEqual(cloned.args, original.args);
  assert.notEqual(cloned.env, original.env);
  assert.notEqual(cloned.headers, original.headers);
  assert.deepEqual(cloned, original);
});

test('cloneMcpServer mutations do not affect original', () => {
  const original = makeMcpServer();
  const cloned = cloneMcpServer(original);

  cloned.args.push('extra');
  cloned.env.push({ key: 'NEW', value: 'val' });
  cloned.env[0].value = 'hacked';

  assert.equal(original.args.length, 2);
  assert.equal(original.env.length, 1);
  assert.equal(original.env[0].value, 'secret');
});

// ─── cloneMcpSettings ────────────────────────────────────────────────────────

test('cloneMcpSettings deep copies server list', () => {
  const settings: McpSettings = {
    maxToolRounds: 8,
    servers: [makeMcpServer()]
  };
  const cloned = cloneMcpSettings(settings);

  assert.notEqual(cloned.servers, settings.servers);
  assert.notEqual(cloned.servers[0], settings.servers[0]);
  assert.deepEqual(cloned, settings);
});

// ─── cloneSession ────────────────────────────────────────────────────────────

test('cloneSession deep copies messages array', () => {
  const session: ChatSession = {
    id: 'sess1',
    assistantId: 'a1',
    title: 'Test Session',
    titleSource: 'default',
    createdAt: 1000,
    updatedAt: 2000,
    messages: [
      { id: 'm1', role: 'user', content: 'Hello', timestamp: 1000 }
    ]
  };
  const cloned = cloneSession(session);

  assert.notEqual(cloned.messages, session.messages);
  assert.deepEqual(cloned, session);
});

// ─── cloneSessionSummary ─────────────────────────────────────────────────────

test('cloneSessionSummary returns equal but distinct object', () => {
  const summary: ChatSessionSummary = {
    id: 'sess1',
    assistantId: 'a1',
    title: 'Summary',
    titleSource: 'default',
    createdAt: 1000,
    updatedAt: 2000,
    messageCount: 5,
    preview: 'Hello...'
  };
  const cloned = cloneSessionSummary(summary);

  assert.deepEqual(cloned, summary);
  assert.notEqual(cloned, summary);
});

// ─── cloneMcpKeyValueEntries ─────────────────────────────────────────────────

test('cloneMcpKeyValueEntries returns deep copy', () => {
  const entries: McpKeyValueEntry[] = [
    { key: 'K1', value: 'V1' },
    { key: 'K2', value: 'V2' }
  ];
  const cloned = cloneMcpKeyValueEntries(entries);

  assert.notEqual(cloned, entries);
  assert.notEqual(cloned[0], entries[0]);
  assert.deepEqual(cloned, entries);
});

test('cloneMcpKeyValueEntries mutations do not affect original', () => {
  const entries: McpKeyValueEntry[] = [{ key: 'K1', value: 'V1' }];
  const cloned = cloneMcpKeyValueEntries(entries);

  cloned[0].value = 'HACKED';
  assert.equal(entries[0].value, 'V1');
});
