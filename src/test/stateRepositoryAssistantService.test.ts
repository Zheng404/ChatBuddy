/**
 * AssistantStateService 单元测试。
 *
 * 覆盖助手和分组的 CRUD、软删除/恢复、置顶、流式设置等逻辑。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AssistantStateService } from '../chatbuddy/stateRepositoryAssistantService';
import { DEFAULT_GROUP_ID, DELETED_GROUP_ID } from '../chatbuddy/constants';
import type { PersistedStateLite, AssistantProfile, ChatBuddySettings } from '../chatbuddy/types';

// ─── Helpers ────────────────────────────────────────────────────────

function makeAssistant(overrides: Partial<AssistantProfile> = {}): AssistantProfile {
  return {
    id: 'a1',
    name: 'Test Assistant',
    note: '',
    groupId: DEFAULT_GROUP_ID,
    systemPrompt: 'You are helpful.',
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
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides
  };
}

function makeSettings(overrides: Partial<ChatBuddySettings> = {}): ChatBuddySettings {
  return {
    providers: [],
    defaultModels: {},
    mcp: { servers: [{ id: 'mcp1', name: 'MCP1', enabled: true, transport: 'stdio' as const, command: 'cmd', args: [], cwd: '', env: [], url: '', headers: [], timeoutMs: 30000, remotePassthroughEnabled: false }], groups: [], maxToolRounds: 5 },
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

function makeState(overrides: Partial<PersistedStateLite> = {}): PersistedStateLite {
  return {
    groups: [
      { id: DEFAULT_GROUP_ID, name: 'Default', kind: 'default', createdAt: 0, updatedAt: 0 },
      { id: DELETED_GROUP_ID, name: 'Deleted', kind: 'deleted', createdAt: 0, updatedAt: 0 }
    ],
    assistants: [makeAssistant({ groupId: DEFAULT_GROUP_ID })],
    selectedAssistantId: 'a1',
    selectedSessionIdByAssistant: {},
    sessionPanelCollapsed: false,
    collapsedGroupIds: [],
    templates: [],
    settings: makeSettings(),
    ...overrides
  };
}

function createService(stateOverrides: Partial<PersistedStateLite> = {}) {
  const state = makeState(stateOverrides);
  const persistCalls: number[] = [];
  const storageCalls: string[] = [];
  const service = new AssistantStateService({
    getState: () => state,
    setState: (s) => { Object.assign(state, s); },
    storage: {
      clearSessionsForAssistant: (id: string) => { storageCalls.push(`clear:${id}`); },
      clearSessionsForAssistants: (ids: string[]) => { storageCalls.push(`clearBatch:${ids.join(',')}`); }
    } as unknown as AssistantStateService['context']['storage'],
    storageReady: () => true,
    persistLater: () => { persistCalls.push(Date.now()); },
    isWritableGroup: (groupId: string) => groupId === DEFAULT_GROUP_ID || groupId.startsWith('group_'),
    defaultAssistantSystemPrompt: 'You are helpful.',
    getSelectedAssistantId: () => state.selectedAssistantId,
    setSelectedAssistantId: (id) => { state.selectedAssistantId = id; },
    getSelectedSessionIds: () => state.selectedSessionIdByAssistant,
    setSelectedSessionIds: (ids) => { state.selectedSessionIdByAssistant = ids; }
  });
  return { service, state, persistCalls, storageCalls };
}

// ─── setSelectedAssistant ──────────────────────────────────────────

describe('setSelectedAssistant', () => {
  test('sets selected assistant and updates timestamps', () => {
    const { service, state } = createService();
    service.setSelectedAssistant('a1');
    assert.equal(state.selectedAssistantId, 'a1');
    assert.ok(state.assistants[0].lastInteractedAt > 0);
  });

  test('no-ops for unknown assistant', () => {
    const { service, state } = createService();
    service.setSelectedAssistant('nonexistent');
    assert.equal(state.selectedAssistantId, 'a1');
  });
});

// ─── createGroup ───────────────────────────────────────────────────

describe('createGroup', () => {
  test('creates a custom group', () => {
    const { service, state } = createService();
    const group = service.createGroup('My Group');
    assert.ok(group);
    assert.equal(group.name, 'My Group');
    assert.equal(group.kind, 'custom');
    assert.equal(state.groups.length, 3);
  });

  test('returns undefined for empty name', () => {
    const { service, state } = createService();
    const result = service.createGroup('');
    assert.equal(result, undefined);
    assert.equal(state.groups.length, 2);
  });

  test('returns undefined for whitespace-only name', () => {
    const { service } = createService();
    assert.equal(service.createGroup('   '), undefined);
  });
});

// ─── renameGroup ───────────────────────────────────────────────────

describe('renameGroup', () => {
  test('renames a custom group', () => {
    const { service, state } = createService({
      groups: [
        { id: DEFAULT_GROUP_ID, name: 'Default', kind: 'default', createdAt: 0, updatedAt: 0 },
        { id: DELETED_GROUP_ID, name: 'Deleted', kind: 'deleted', createdAt: 0, updatedAt: 0 },
        { id: 'g1', name: 'Old Name', kind: 'custom', createdAt: 0, updatedAt: 0 }
      ]
    });
    const result = service.renameGroup('g1', 'New Name');
    assert.equal(result, true);
    assert.equal(state.groups[2].name, 'New Name');
  });

  test('returns false for unknown group', () => {
    const { service } = createService();
    assert.equal(service.renameGroup('nonexistent', 'Name'), false);
  });

  test('returns false for deleted group', () => {
    const { service } = createService();
    assert.equal(service.renameGroup(DELETED_GROUP_ID, 'Name'), false);
  });

  test('allows renaming default group', () => {
    const { service } = createService();
    assert.equal(service.renameGroup(DEFAULT_GROUP_ID, 'Name'), true);
  });

  test('returns false for empty name', () => {
    const { service } = createService({
      groups: [
        { id: DEFAULT_GROUP_ID, name: 'Default', kind: 'default', createdAt: 0, updatedAt: 0 },
        { id: DELETED_GROUP_ID, name: 'Deleted', kind: 'deleted', createdAt: 0, updatedAt: 0 },
        { id: 'g1', name: 'Group', kind: 'custom', createdAt: 0, updatedAt: 0 }
      ]
    });
    assert.equal(service.renameGroup('g1', ''), false);
  });
});

// ─── deleteGroup ───────────────────────────────────────────────────

describe('deleteGroup', () => {
  test('deletes a custom group and migrates assistants to default', () => {
    const assistant = makeAssistant({ groupId: 'g1' });
    const { service, state } = createService({
      groups: [
        { id: DEFAULT_GROUP_ID, name: 'Default', kind: 'default', createdAt: 0, updatedAt: 0 },
        { id: DELETED_GROUP_ID, name: 'Deleted', kind: 'deleted', createdAt: 0, updatedAt: 0 },
        { id: 'g1', name: 'Group 1', kind: 'custom', createdAt: 0, updatedAt: 0 }
      ],
      assistants: [assistant]
    });
    const result = service.deleteGroup('g1');
    assert.equal(result, true);
    assert.equal(state.groups.length, 2);
    assert.equal(state.assistants[0].groupId, DEFAULT_GROUP_ID);
  });

  test('returns false for non-custom group', () => {
    const { service } = createService();
    assert.equal(service.deleteGroup(DEFAULT_GROUP_ID), false);
    assert.equal(service.deleteGroup(DELETED_GROUP_ID), false);
  });

  test('returns false for unknown group', () => {
    const { service } = createService();
    assert.equal(service.deleteGroup('nonexistent'), false);
  });
});

// ─── createAssistant ───────────────────────────────────────────────

describe('createAssistant', () => {
  test('creates assistant with defaults', () => {
    const { service, state } = createService();
    const assistant = service.createAssistant({ name: 'New Bot' });
    assert.ok(assistant);
    assert.equal(assistant.name, 'New Bot');
    assert.equal(assistant.groupId, DEFAULT_GROUP_ID);
    assert.equal(assistant.isDeleted, false);
    assert.equal(state.selectedAssistantId, assistant.id);
    assert.equal(state.assistants.length, 2);
  });

  test('uses default name when empty', () => {
    const { service } = createService();
    const assistant = service.createAssistant({ name: '' });
    assert.ok(assistant.name.length > 0);
  });

  test('assigns to default group when groupId is not writable', () => {
    const { service } = createService();
    const assistant = service.createAssistant({ name: 'Bot', groupId: 'unwritable' });
    assert.equal(assistant.groupId, DEFAULT_GROUP_ID);
  });
});

// ─── updateAssistant ───────────────────────────────────────────────

describe('updateAssistant', () => {
  test('updates name', () => {
    const { service } = createService();
    const result = service.updateAssistant('a1', { name: 'Updated' });
    assert.ok(result);
    assert.equal(result.name, 'Updated');
  });

  test('clamps temperature to valid range', () => {
    const { service, state } = createService();
    service.updateAssistant('a1', { temperature: 5 });
    assert.ok(state.assistants[0].temperature <= 2);
  });

  test('clamps topP to valid range', () => {
    const { service, state } = createService();
    service.updateAssistant('a1', { topP: -1 });
    assert.ok(state.assistants[0].topP >= 0);
  });

  test('updates streaming flag', () => {
    const { service, state } = createService();
    service.updateAssistant('a1', { streaming: false });
    assert.equal(state.assistants[0].streaming, false);
  });

  test('filters and deduplicates enabledMcpServerIds', () => {
    const { service, state } = createService();
    service.updateAssistant('a1', { enabledMcpServerIds: ['mcp1', 'mcp1', 'invalid', 'mcp1'] });
    assert.deepEqual(state.assistants[0].enabledMcpServerIds, ['mcp1']);
  });

  test('returns undefined for unknown assistant', () => {
    const { service } = createService();
    assert.equal(service.updateAssistant('nonexistent', { name: 'X' }), undefined);
  });

  test('validates avatar format', () => {
    const { service, state } = createService();
    service.updateAssistant('a1', { avatar: 'valid-avatar-123' });
    assert.equal(state.assistants[0].avatar, 'valid-avatar-123');
    service.updateAssistant('a1', { avatar: 'invalid avatar!' });
    assert.equal(state.assistants[0].avatar, undefined);
  });

  test('does not update groupId when assistant is deleted', () => {
    const { service, state } = createService({
      assistants: [makeAssistant({ isDeleted: true, groupId: DELETED_GROUP_ID })]
    });
    service.updateAssistant('a1', { groupId: DEFAULT_GROUP_ID });
    assert.equal(state.assistants[0].groupId, DELETED_GROUP_ID);
  });
});

// ─── toggleAssistantPinned ─────────────────────────────────────────

describe('toggleAssistantPinned', () => {
  test('toggles pinned state', () => {
    const { service } = createService();
    const result = service.toggleAssistantPinned('a1');
    assert.ok(result);
    assert.equal(result.pinned, true);
  });

  test('returns undefined for deleted assistant', () => {
    const { service } = createService({
      assistants: [makeAssistant({ isDeleted: true })]
    });
    assert.equal(service.toggleAssistantPinned('a1'), undefined);
  });

  test('returns undefined for unknown assistant', () => {
    const { service } = createService();
    assert.equal(service.toggleAssistantPinned('nonexistent'), undefined);
  });
});

// ─── softDeleteAssistant ───────────────────────────────────────────

describe('softDeleteAssistant', () => {
  test('moves assistant to deleted group', () => {
    const { service } = createService();
    const result = service.softDeleteAssistant('a1');
    assert.ok(result);
    assert.equal(result.isDeleted, true);
    assert.equal(result.groupId, DELETED_GROUP_ID);
    assert.equal(result.pinned, false);
    assert.ok(result.deletedAt);
    assert.equal(result.originalGroupId, DEFAULT_GROUP_ID);
  });

  test('returns undefined for already deleted assistant', () => {
    const { service } = createService({
      assistants: [makeAssistant({ isDeleted: true })]
    });
    assert.equal(service.softDeleteAssistant('a1'), undefined);
  });

  test('returns undefined for unknown assistant', () => {
    const { service } = createService();
    assert.equal(service.softDeleteAssistant('nonexistent'), undefined);
  });
});

// ─── restoreAssistant ──────────────────────────────────────────────

describe('restoreAssistant', () => {
  test('restores deleted assistant to original group', () => {
    const { service } = createService({
      assistants: [makeAssistant({ isDeleted: true, groupId: DELETED_GROUP_ID, originalGroupId: DEFAULT_GROUP_ID })]
    });
    const result = service.restoreAssistant('a1');
    assert.ok(result);
    assert.equal(result.isDeleted, false);
    assert.equal(result.groupId, DEFAULT_GROUP_ID);
    assert.equal(result.deletedAt, undefined);
    assert.equal(result.originalGroupId, undefined);
  });

  test('falls back to default group if original is not writable', () => {
    const { service } = createService({
      assistants: [makeAssistant({ isDeleted: true, groupId: DELETED_GROUP_ID, originalGroupId: 'unwritable' })]
    });
    const result = service.restoreAssistant('a1');
    assert.ok(result);
    assert.equal(result.groupId, DEFAULT_GROUP_ID);
  });

  test('returns undefined for non-deleted assistant', () => {
    const { service } = createService();
    assert.equal(service.restoreAssistant('a1'), undefined);
  });
});

// ─── hardDeleteAssistant ───────────────────────────────────────────

describe('hardDeleteAssistant', () => {
  test('removes assistant and clears sessions', async () => {
    const { service, state, storageCalls } = createService();
    const result = await service.hardDeleteAssistant('a1');
    assert.equal(result, true);
    assert.equal(state.assistants.length, 0);
    assert.ok(storageCalls.some(c => c.startsWith('clear:')));
  });

  test('returns false for unknown assistant', async () => {
    const { service } = createService();
    assert.equal(await service.hardDeleteAssistant('nonexistent'), false);
  });

  test('selects next assistant after deleting selected one', async () => {
    const { service, state } = createService({
      assistants: [makeAssistant({ id: 'a1' }), makeAssistant({ id: 'a2' })],
      selectedAssistantId: 'a1'
    });
    await service.hardDeleteAssistant('a1');
    assert.equal(state.selectedAssistantId, 'a2');
  });
});

// ─── hardDeleteDeletedAssistants ────────────────────────────────────

describe('hardDeleteDeletedAssistants', () => {
  test('removes all deleted assistants', async () => {
    const { service, state } = createService({
      assistants: [
        makeAssistant({ id: 'a1', isDeleted: true }),
        makeAssistant({ id: 'a2', isDeleted: false })
      ]
    });
    const count = await service.hardDeleteDeletedAssistants();
    assert.equal(count, 1);
    assert.equal(state.assistants.length, 1);
    assert.equal(state.assistants[0].id, 'a2');
  });

  test('returns 0 when no deleted assistants', async () => {
    const { service } = createService();
    assert.equal(await service.hardDeleteDeletedAssistants(), 0);
  });
});

// ─── setAssistantStreaming ──────────────────────────────────────────

describe('setAssistantStreaming', () => {
  test('updates streaming flag', () => {
    const { service, state } = createService();
    service.setAssistantStreaming('a1', false);
    assert.equal(state.assistants[0].streaming, false);
  });

  test('no-ops for unknown assistant', () => {
    const { service } = createService();
    service.setAssistantStreaming('nonexistent', false);
    // Should not throw
  });
});

// ─── markAssistantInteracted ────────────────────────────────────────

describe('markAssistantInteracted', () => {
  test('updates lastInteractedAt', () => {
    const { service, state, persistCalls } = createService();
    service.markAssistantInteracted('a1');
    assert.ok(state.assistants[0].lastInteractedAt > 0);
    assert.equal(persistCalls.length, 1);
  });

  test('skips persist when persist=false', () => {
    const { service, persistCalls } = createService();
    service.markAssistantInteracted('a1', false);
    assert.equal(persistCalls.length, 0);
  });

  test('no-ops for unknown assistant', () => {
    const { service, persistCalls } = createService();
    service.markAssistantInteracted('nonexistent');
    assert.equal(persistCalls.length, 0);
  });
});
