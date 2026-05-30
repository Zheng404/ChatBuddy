/**
 * assistantManagementCommands 单元测试。
 *
 * 覆盖助手管理命令的注册和命令处理器逻辑。
 */
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';

import { registerAssistantManagementCommands } from '../../../extension/assistantManagementCommands';
import type { ExtensionContext } from '../../../extension/shared';
import type { AssistantNode } from '../../../chatbuddy/assistantsView';
import type { AssistantProfile } from '../../../chatbuddy/types';

// ─── Helpers ────────────────────────────────────────────────────────

function makeAssistant(overrides: Partial<AssistantProfile> = {}): AssistantProfile {
  const now = Date.now();
  return {
    id: 'a1',
    name: 'Test Assistant',
    note: '',
    avatar: 'account',
    groupId: 'default',
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
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function makeAssistantNode(assistant: AssistantProfile): AssistantNode {
  return { kind: 'assistant', assistant };
}

type CommandHandler = (...args: unknown[]) => unknown;

function createMockContext(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    repository: {
      toggleAssistantPinned: () => undefined,
      getSelectedAssistantId: () => 'a1',
      getAssistantById: () => undefined,
      softDeleteAssistant: () => undefined,
      restoreAssistant: () => undefined,
      hardDeleteAssistant: async () => true,
      hardDeleteDeletedAssistants: async () => 0,
      getAssistants: () => []
    } as unknown as ExtensionContext['repository'],
    chatController: {
      openAssistantChat: () => undefined,
      disposePanelForAssistant: () => undefined
    } as unknown as ExtensionContext['chatController'],
    assistantEditorPanelController: {
      openAssistantEditor: () => undefined,
      openCreateAssistantEditor: () => undefined
    } as unknown as ExtensionContext['assistantEditorPanelController'],
    settingsCenterPanelController: {} as ExtensionContext['settingsCenterPanelController'],
    assistantsTreeProvider: {
      getSearchKeyword: () => '',
      setSearchKeyword: () => undefined,
      clearSearchKeyword: () => undefined,
      refresh: () => undefined
    } as unknown as ExtensionContext['assistantsTreeProvider'],
    sessionsTreeProvider: {
      getSearchKeyword: () => '',
      setSearchKeyword: () => undefined,
      clearSearchKeyword: () => undefined,
      refresh: () => undefined
    } as unknown as ExtensionContext['sessionsTreeProvider'],
    refreshAll: () => undefined,
    updateTreeMessage: () => undefined,
    getRuntimeLocale: () => 'en',
    getRuntimeStrings: () => ({
      deleteAction: 'Delete',
      hardDeleteAction: 'Delete Permanently',
      emptyRecycleBinAction: 'Empty',
      confirmDeleteAssistant: 'Delete {name}?',
      confirmHardDeleteAssistant: 'Permanently delete {name}?',
      confirmEmptyRecycleBin: 'Empty {count} items?',
      recycleBinAlreadyEmpty: 'Already empty',
      recycleBinEmptied: 'Emptied {count}',
      assistantEditDeletedBlocked: 'Cannot edit deleted assistant',
      noTemplatesAvailable: 'No templates',
      templatePickerPlaceholder: 'Pick a template',
      templateCreatedAssistant: 'Created {name}'
    }),
    ...overrides
  };
}

// ─── VS Code stub extensions ────────────────────────────────────────

const registeredCommands = new Map<string, CommandHandler>();
const originalRegisterCommand = (vscode.commands as unknown as Record<string, unknown>).registerCommand;
const originalShowWarningMessage = vscode.window.showWarningMessage;
const originalShowInformationMessage = vscode.window.showInformationMessage;

function setupVscodeStubs() {
  registeredCommands.clear();
  (vscode.commands as unknown as { registerCommand: (cmd: string, handler: CommandHandler) => { dispose: () => void } }).registerCommand = (command, handler) => {
    registeredCommands.set(command, handler);
    return { dispose: () => undefined };
  };
}

function restoreVscodeStubs() {
  (vscode.commands as unknown as { registerCommand: unknown }).registerCommand = originalRegisterCommand;
  vscode.window.showWarningMessage = originalShowWarningMessage;
  vscode.window.showInformationMessage = originalShowInformationMessage;
}

// ─── registerAssistantManagementCommands ────────────────────────────

describe('registerAssistantManagementCommands', () => {
  beforeEach(setupVscodeStubs);
  afterEach(restoreVscodeStubs);

  test('registers the correct commands', () => {
    const ctx = createMockContext();
    const disposables = registerAssistantManagementCommands(ctx);

    assert.equal(disposables.length, 7);
    assert.ok(registeredCommands.has('chatbuddy.pinAssistant'));
    assert.ok(registeredCommands.has('chatbuddy.unpinAssistant'));
    assert.ok(registeredCommands.has('chatbuddy.editAssistant'));
    assert.ok(registeredCommands.has('chatbuddy.softDeleteAssistant'));
    assert.ok(registeredCommands.has('chatbuddy.restoreAssistant'));
    assert.ok(registeredCommands.has('chatbuddy.hardDeleteAssistant'));
    assert.ok(registeredCommands.has('chatbuddy.emptyRecycleBin'));
  });
});

// ─── pinAssistant / unpinAssistant ──────────────────────────────────

describe('pinAssistant', () => {
  beforeEach(setupVscodeStubs);
  afterEach(restoreVscodeStubs);

  test('toggles pinned state and refreshes', () => {
    let toggleCalled = false;
    let refreshed = false;
    const assistant = makeAssistant();
    const ctx = createMockContext({
      repository: {
        toggleAssistantPinned: (id: string) => {
          toggleCalled = true;
          assert.equal(id, assistant.id);
        }
      } as unknown as ExtensionContext['repository'],
      refreshAll: () => { refreshed = true; }
    });

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.pinAssistant')!;
    handler(makeAssistantNode(assistant));

    assert.equal(toggleCalled, true);
    assert.equal(refreshed, true);
  });

  test('no-ops when node is missing', () => {
    let toggleCalled = false;
    const ctx = createMockContext({
      repository: {
        toggleAssistantPinned: () => { toggleCalled = true; }
      } as unknown as ExtensionContext['repository']
    });

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.pinAssistant')!;
    handler(undefined);

    assert.equal(toggleCalled, false);
  });
});

describe('unpinAssistant', () => {
  beforeEach(setupVscodeStubs);
  afterEach(restoreVscodeStubs);

  test('toggles pinned state and refreshes', () => {
    let toggleCalled = false;
    let refreshed = false;
    const assistant = makeAssistant();
    const ctx = createMockContext({
      repository: {
        toggleAssistantPinned: (id: string) => {
          toggleCalled = true;
          assert.equal(id, assistant.id);
        }
      } as unknown as ExtensionContext['repository'],
      refreshAll: () => { refreshed = true; }
    });

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.unpinAssistant')!;
    handler(makeAssistantNode(assistant));

    assert.equal(toggleCalled, true);
    assert.equal(refreshed, true);
  });
});

// ─── editAssistant ──────────────────────────────────────────────────

describe('editAssistant', () => {
  beforeEach(setupVscodeStubs);
  afterEach(restoreVscodeStubs);

  test('opens assistant editor for valid assistant', () => {
    let openedId: string | undefined;
    const assistant = makeAssistant();
    const ctx = createMockContext({
      repository: {
        getAssistantById: () => assistant,
        getSelectedAssistantId: () => assistant.id
      } as unknown as ExtensionContext['repository'],
      assistantEditorPanelController: {
        openAssistantEditor: (id: string) => { openedId = id; }
      } as unknown as ExtensionContext['assistantEditorPanelController']
    });

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.editAssistant')!;
    handler(makeAssistantNode(assistant));

    assert.equal(openedId, assistant.id);
  });

  test('shows warning for deleted assistant', async () => {
    let shownMessage: string | undefined;
    const assistant = makeAssistant({ isDeleted: true });
    const ctx = createMockContext({
      repository: {
        getAssistantById: () => assistant,
        getSelectedAssistantId: () => assistant.id
      } as unknown as ExtensionContext['repository'],
      getRuntimeStrings: () => ({
        assistantEditDeletedBlocked: 'Cannot edit deleted assistant'
      })
    });

    vscode.window.showWarningMessage = async (message: string) => {
      shownMessage = message;
      return undefined;
    };

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.editAssistant')!;
    handler(makeAssistantNode(assistant));

    // showWarningMessage is fire-and-forget with void, so we check the mock directly
    assert.equal(shownMessage, 'Cannot edit deleted assistant');
  });

  test('falls back to selected assistant when no node provided', () => {
    let openedId: string | undefined;
    const assistant = makeAssistant();
    const ctx = createMockContext({
      repository: {
        getAssistantById: () => assistant,
        getSelectedAssistantId: () => assistant.id
      } as unknown as ExtensionContext['repository'],
      assistantEditorPanelController: {
        openAssistantEditor: (id: string) => { openedId = id; }
      } as unknown as ExtensionContext['assistantEditorPanelController']
    });

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.editAssistant')!;
    handler(undefined);

    assert.equal(openedId, assistant.id);
  });
});

// ─── softDeleteAssistant ────────────────────────────────────────────

describe('softDeleteAssistant', () => {
  beforeEach(setupVscodeStubs);
  afterEach(restoreVscodeStubs);

  test('confirms and soft deletes assistant', async () => {
    let softDeleteCalled = false;
    let openChatCalled = false;
    let refreshed = false;
    const assistant = makeAssistant();
    const ctx = createMockContext({
      repository: {
        softDeleteAssistant: (id: string) => {
          softDeleteCalled = true;
          assert.equal(id, assistant.id);
          return { ...assistant, isDeleted: true };
        }
      } as unknown as ExtensionContext['repository'],
      chatController: {
        openAssistantChat: (id?: string) => {
          openChatCalled = true;
          assert.equal(id, assistant.id);
        }
      } as unknown as ExtensionContext['chatController'],
      refreshAll: () => { refreshed = true; }
    });

    vscode.window.showWarningMessage = async () => 'Delete';

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.softDeleteAssistant')!;
    await handler(makeAssistantNode(assistant));

    assert.equal(softDeleteCalled, true);
    assert.equal(openChatCalled, true);
    assert.equal(refreshed, true);
  });

  test('aborts when user cancels', async () => {
    let softDeleteCalled = false;
    const assistant = makeAssistant();
    const ctx = createMockContext({
      repository: {
        softDeleteAssistant: () => { softDeleteCalled = true; }
      } as unknown as ExtensionContext['repository']
    });

    vscode.window.showWarningMessage = async () => undefined;

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.softDeleteAssistant')!;
    await handler(makeAssistantNode(assistant));

    assert.equal(softDeleteCalled, false);
  });

  test('no-ops when node is missing', async () => {
    let softDeleteCalled = false;
    const ctx = createMockContext({
      repository: {
        softDeleteAssistant: () => { softDeleteCalled = true; }
      } as unknown as ExtensionContext['repository']
    });

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.softDeleteAssistant')!;
    await handler(undefined);

    assert.equal(softDeleteCalled, false);
  });
});

// ─── restoreAssistant ───────────────────────────────────────────────

describe('restoreAssistant', () => {
  beforeEach(setupVscodeStubs);
  afterEach(restoreVscodeStubs);

  test('restores deleted assistant and opens chat', () => {
    let restoreCalled = false;
    let openChatCalled = false;
    let refreshed = false;
    const assistant = makeAssistant({ isDeleted: true });
    const ctx = createMockContext({
      repository: {
        restoreAssistant: (id: string) => {
          restoreCalled = true;
          assert.equal(id, assistant.id);
          return { ...assistant, isDeleted: false };
        }
      } as unknown as ExtensionContext['repository'],
      chatController: {
        openAssistantChat: (id?: string) => {
          openChatCalled = true;
          assert.equal(id, assistant.id);
        }
      } as unknown as ExtensionContext['chatController'],
      refreshAll: () => { refreshed = true; }
    });

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.restoreAssistant')!;
    handler(makeAssistantNode(assistant));

    assert.equal(restoreCalled, true);
    assert.equal(openChatCalled, true);
    assert.equal(refreshed, true);
  });

  test('no-ops when restore returns undefined', () => {
    let openChatCalled = false;
    const assistant = makeAssistant({ isDeleted: true });
    const ctx = createMockContext({
      repository: {
        restoreAssistant: () => undefined
      } as unknown as ExtensionContext['repository'],
      chatController: {
        openAssistantChat: () => { openChatCalled = true; }
      } as unknown as ExtensionContext['chatController']
    });

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.restoreAssistant')!;
    handler(makeAssistantNode(assistant));

    assert.equal(openChatCalled, false);
  });
});

// ─── hardDeleteAssistant ────────────────────────────────────────────

describe('hardDeleteAssistant', () => {
  beforeEach(setupVscodeStubs);
  afterEach(restoreVscodeStubs);

  test('confirms and permanently deletes assistant', async () => {
    let hardDeleteCalled = false;
    let disposeCalled = false;
    let openChatCalled = false;
    let refreshed = false;
    const assistant = makeAssistant();
    const ctx = createMockContext({
      repository: {
        hardDeleteAssistant: async (id: string) => {
          hardDeleteCalled = true;
          assert.equal(id, assistant.id);
          return true;
        }
      } as unknown as ExtensionContext['repository'],
      chatController: {
        disposePanelForAssistant: (id: string) => {
          disposeCalled = true;
          assert.equal(id, assistant.id);
        },
        openAssistantChat: () => { openChatCalled = true; }
      } as unknown as ExtensionContext['chatController'],
      refreshAll: () => { refreshed = true; }
    });

    vscode.window.showWarningMessage = async () => 'Delete Permanently';

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.hardDeleteAssistant')!;
    await handler(makeAssistantNode(assistant));

    assert.equal(disposeCalled, true);
    assert.equal(hardDeleteCalled, true);
    assert.equal(openChatCalled, true);
    assert.equal(refreshed, true);
  });

  test('aborts when user cancels', async () => {
    let hardDeleteCalled = false;
    const assistant = makeAssistant();
    const ctx = createMockContext({
      repository: {
        hardDeleteAssistant: async () => { hardDeleteCalled = true; }
      } as unknown as ExtensionContext['repository']
    });

    vscode.window.showWarningMessage = async () => undefined;

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.hardDeleteAssistant')!;
    await handler(makeAssistantNode(assistant));

    assert.equal(hardDeleteCalled, false);
  });
});

// ─── emptyRecycleBin ────────────────────────────────────────────────

describe('emptyRecycleBin', () => {
  beforeEach(setupVscodeStubs);
  afterEach(restoreVscodeStubs);

  test('shows info when recycle bin is already empty', async () => {
    let shownMessage: string | undefined;
    const ctx = createMockContext({
      repository: {
        getAssistants: () => []
      } as unknown as ExtensionContext['repository'],
      getRuntimeStrings: () => ({
        recycleBinAlreadyEmpty: 'Already empty'
      })
    });

    vscode.window.showInformationMessage = async (message: string) => {
      shownMessage = message;
      return undefined;
    };

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.emptyRecycleBin')!;
    await handler();

    assert.equal(shownMessage, 'Already empty');
  });

  test('confirms and empties recycle bin', async () => {
    let hardDeleteCalled = false;
    let disposeCalled = false;
    let refreshed = false;
    const deletedAssistants = [makeAssistant({ id: 'a1', isDeleted: true }), makeAssistant({ id: 'a2', isDeleted: true })];
    const ctx = createMockContext({
      repository: {
        getAssistants: () => deletedAssistants,
        hardDeleteDeletedAssistants: async () => {
          hardDeleteCalled = true;
          return 2;
        }
      } as unknown as ExtensionContext['repository'],
      chatController: {
        disposePanelForAssistant: () => { disposeCalled = true; },
        openAssistantChat: () => undefined
      } as unknown as ExtensionContext['chatController'],
      refreshAll: () => { refreshed = true; }
    });

    vscode.window.showWarningMessage = async () => 'Empty';
    vscode.window.showInformationMessage = async () => undefined;

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.emptyRecycleBin')!;
    await handler();

    assert.equal(disposeCalled, true);
    assert.equal(hardDeleteCalled, true);
    assert.equal(refreshed, true);
  });

  test('aborts when user cancels', async () => {
    let hardDeleteCalled = false;
    const deletedAssistants = [makeAssistant({ id: 'a1', isDeleted: true })];
    const ctx = createMockContext({
      repository: {
        getAssistants: () => deletedAssistants,
        hardDeleteDeletedAssistants: async () => { hardDeleteCalled = true; }
      } as unknown as ExtensionContext['repository']
    });

    vscode.window.showWarningMessage = async () => undefined;

    registerAssistantManagementCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.emptyRecycleBin')!;
    await handler();

    assert.equal(hardDeleteCalled, false);
  });
});
