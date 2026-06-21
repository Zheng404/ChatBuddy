/**
 * sessionCommands 单元测试。
 *
 * 覆盖会话管理命令的注册和命令处理器逻辑。
 *
 * 阶段 2.3：renameSession / deleteSession / exportSession 的参数从 SessionNode
 *          改为 (assistantId, sessionId)，适配 Webview View 调用。
 */
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';

import { registerSessionCommands } from '../../../extension/sessionCommands';
import type { ExtensionContext } from '../../../extension/shared';
import type { AssistantProfile, ChatSessionDetail } from '../../../chatbuddy/types';

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

function makeSession(overrides: Partial<ChatSessionDetail> = {}): ChatSessionDetail {
  const now = Date.now();
  return {
    id: 's1',
    assistantId: 'a1',
    title: 'Test Session',
    titleSource: 'custom',
    createdAt: now,
    updatedAt: now,
    messages: [],
    ...overrides
  };
}

type CommandHandler = (...args: unknown[]) => unknown;

function createMockContext(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    repository: {
      getAssistantById: () => undefined,
      getSelectedAssistant: () => undefined,
      setSelectedAssistant: () => undefined,
      getSelectedSession: () => undefined,
      getSessionById: () => undefined,
      getSessionsForAssistant: () => [],
      clearSessionsForAssistant: async () => 0,
      renameSession: () => undefined,
      deleteSession: async () => undefined
    } as unknown as ExtensionContext['repository'],
    chatController: {
      createSessionForSelectedAssistant: () => undefined,
      openAssistantChat: () => undefined,
      renameSessionForSelectedAssistant: () => undefined,
      deleteSessionForSelectedAssistant: () => undefined,
      stopGeneration: () => undefined,
      regenerateReply: () => undefined
    } as unknown as ExtensionContext['chatController'],
    assistantEditorPanelController: {
      openAssistantEditor: () => undefined,
      openCreateAssistantEditor: () => undefined
    } as unknown as ExtensionContext['assistantEditorPanelController'],
    settingsCenterPanelController: {} as ExtensionContext['settingsCenterPanelController'],
    sidebarViewProviders: {
      assistantsViewProvider: {
        clearSearch: () => undefined,
        collapseAll: () => undefined,
        focusSearch: () => undefined,
        scrollToAssistant: () => undefined
      },
      recycleBinViewProvider: {
        clearSearch: () => undefined,
        collapseAll: () => undefined,
        focusSearch: () => undefined,
        scrollToAssistant: () => undefined
      },
      sessionsViewProvider: {
        clearSearch: () => undefined,
        focusSearch: () => undefined,
        scrollToSession: () => undefined,
        postState: () => undefined,
        buildState: () => undefined
      }
    } as unknown as ExtensionContext['sidebarViewProviders'],
    refreshAll: () => undefined,
    getRuntimeLocale: () => 'en',
    getRuntimeStrings: () => ({
      deleteAction: 'Delete',
      clearAllSessionsAction: 'Clear All',
      exportSessionAction: 'Export',
      sessionSearchPlaceholder: 'Search sessions',
      renameSessionPrompt: 'Rename session',
      noAssistantSelectedBody: 'No assistant selected',
      noSessionsToRename: 'No sessions to rename',
      noSessionsToDelete: 'No sessions to delete',
      noSessionsToExport: 'No sessions to export',
      noSessionsToClear: 'No sessions to clear',
      confirmDeleteSession: 'Delete {title}?',
      confirmClearAllSessions: 'Clear {count} sessions?',
      exportSessionSelectHint: 'Select a session',
      exportFormatPrompt: 'Choose format',
      exportFormatJson: 'JSON',
      exportFormatMarkdown: 'Markdown',
      exportFormatHtml: 'HTML',
      exportSessionDone: 'Exported to {path}',
      exportSessionFailed: 'Export failed',
      untitledSession: 'Untitled',
      assistantRole: 'Assistant',
      exportGeneratedAtLabel: 'Generated at',
      userRole: 'User',
      systemRole: 'System',
      reasoningSectionTitle: 'Reasoning'
    }),
    ...overrides
  };
}

// ─── VS Code stub extensions ────────────────────────────────────────

const registeredCommands = new Map<string, CommandHandler>();
const originalRegisterCommand = (vscode.commands as unknown as Record<string, unknown>).registerCommand;
const originalShowWarningMessage = vscode.window.showWarningMessage;
const originalShowInformationMessage = vscode.window.showInformationMessage;
const originalShowInputBox = (vscode.window as unknown as Record<string, unknown>).showInputBox;
const originalShowQuickPick = (vscode.window as unknown as Record<string, unknown>).showQuickPick;
const originalWorkspaceFolders = (vscode.workspace as unknown as Record<string, unknown>).workspaceFolders;
const originalWriteFile = (vscode.workspace.fs as unknown as Record<string, unknown>)?.writeFile;

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
  (vscode.window as unknown as { showInputBox: unknown }).showInputBox = originalShowInputBox;
  (vscode.window as unknown as { showQuickPick: unknown }).showQuickPick = originalShowQuickPick;
  (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = originalWorkspaceFolders;
  if (vscode.workspace.fs) {
    (vscode.workspace.fs as unknown as { writeFile: unknown }).writeFile = originalWriteFile;
  }
}

// ─── registerSessionCommands ────────────────────────────────────────

describe('registerSessionCommands', () => {
  beforeEach(setupVscodeStubs);
  afterEach(restoreVscodeStubs);

  test('registers the correct commands', () => {
    const ctx = createMockContext();
    const disposables = registerSessionCommands(ctx);

    assert.equal(disposables.length, 9);
    assert.ok(registeredCommands.has('chatbuddy.searchSessions'));
    assert.ok(registeredCommands.has('chatbuddy.clearSessionSearch'));
    assert.ok(registeredCommands.has('chatbuddy.createSession'));
    assert.ok(registeredCommands.has('chatbuddy.renameSession'));
    assert.ok(registeredCommands.has('chatbuddy.deleteSession'));
    assert.ok(registeredCommands.has('chatbuddy.exportSession'));
    assert.ok(registeredCommands.has('chatbuddy.stopGeneration'));
    assert.ok(registeredCommands.has('chatbuddy.regenerateReply'));
    assert.ok(registeredCommands.has('chatbuddy.clearAllSessions'));
  });
});

// ─── createSession ──────────────────────────────────────────────────

describe('createSession', () => {
  beforeEach(setupVscodeStubs);
  afterEach(restoreVscodeStubs);

  test('creates session and refreshes', () => {
    let createCalled = false;
    let openChatCalled = false;
    let refreshed = false;
    const ctx = createMockContext({
      chatController: {
        createSessionForSelectedAssistant: () => { createCalled = true; },
        openAssistantChat: () => { openChatCalled = true; }
      } as unknown as ExtensionContext['chatController'],
      refreshAll: () => { refreshed = true; }
    });

    registerSessionCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.createSession')!;
    handler();

    assert.equal(createCalled, true);
    assert.equal(openChatCalled, true);
    assert.equal(refreshed, true);
  });
});

// ─── renameSession ──────────────────────────────────────────────────

describe('renameSession', () => {
  beforeEach(setupVscodeStubs);
  afterEach(restoreVscodeStubs);

  test('renames session when valid input provided', async () => {
    let renameCalled = false;
    let setSelectedCalled = false;
    let openChatCalled = false;
    let refreshed = false;
    const assistant = makeAssistant();
    const session = makeSession();
    const ctx = createMockContext({
      repository: {
        getAssistantById: () => assistant,
        setSelectedAssistant: () => { setSelectedCalled = true; },
        getSessionById: () => session
      } as unknown as ExtensionContext['repository'],
      chatController: {
        renameSessionForSelectedAssistant: (sessionId: string, title: string) => {
          renameCalled = true;
          assert.equal(sessionId, session.id);
          assert.equal(title, 'New Title');
        },
        openAssistantChat: (id?: string) => {
          openChatCalled = true;
          assert.equal(id, assistant.id);
        }
      } as unknown as ExtensionContext['chatController'],
      refreshAll: () => { refreshed = true; }
    });

    (vscode.window as unknown as Record<string, unknown>).showInputBox = async () => 'New Title';

    registerSessionCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.renameSession')!;
    await handler(assistant.id, session.id);

    assert.equal(setSelectedCalled, true);
    assert.equal(renameCalled, true);
    assert.equal(openChatCalled, true);
    assert.equal(refreshed, true);
  });

  test('aborts when no assistant found', async () => {
    let shownMessage: string | undefined;
    const ctx = createMockContext({
      repository: {
        getAssistantById: () => undefined
      } as unknown as ExtensionContext['repository'],
      getRuntimeStrings: () => ({
        noAssistantSelectedBody: 'No assistant selected'
      })
    });

    vscode.window.showInformationMessage = async (message: string) => {
      shownMessage = message;
      return undefined;
    };

    registerSessionCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.renameSession')!;
    await handler('a1', 's1');

    assert.equal(shownMessage, 'No assistant selected');
  });

  test('aborts when no session found', async () => {
    let shownMessage: string | undefined;
    const assistant = makeAssistant();
    const ctx = createMockContext({
      repository: {
        getAssistantById: () => assistant,
        getSessionById: () => undefined
      } as unknown as ExtensionContext['repository'],
      getRuntimeStrings: () => ({
        noSessionsToRename: 'No sessions to rename'
      })
    });

    vscode.window.showInformationMessage = async (message: string) => {
      shownMessage = message;
      return undefined;
    };

    registerSessionCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.renameSession')!;
    await handler(assistant.id, 's1');

    assert.equal(shownMessage, 'No sessions to rename');
  });

  test('aborts when input is empty', async () => {
    let renameCalled = false;
    const assistant = makeAssistant();
    const session = makeSession();
    const ctx = createMockContext({
      repository: {
        getAssistantById: () => assistant,
        getSessionById: () => session
      } as unknown as ExtensionContext['repository'],
      chatController: {
        renameSessionForSelectedAssistant: () => { renameCalled = true; }
      } as unknown as ExtensionContext['chatController']
    });

    (vscode.window as unknown as Record<string, unknown>).showInputBox = async () => '';

    registerSessionCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.renameSession')!;
    await handler(assistant.id, session.id);

    assert.equal(renameCalled, false);
  });
});

// ─── deleteSession ──────────────────────────────────────────────────

describe('deleteSession', () => {
  beforeEach(setupVscodeStubs);
  afterEach(restoreVscodeStubs);

  test('deletes session (confirmation handled by webview)', async () => {
    let deleteCalled = false;
    let setSelectedCalled = false;
    let openChatCalled = false;
    let refreshed = false;
    const assistant = makeAssistant();
    const session = makeSession();
    const ctx = createMockContext({
      repository: {
        getAssistantById: () => assistant,
        setSelectedAssistant: () => { setSelectedCalled = true; },
        getSessionById: () => session
      } as unknown as ExtensionContext['repository'],
      chatController: {
        deleteSessionForSelectedAssistant: (sessionId: string) => {
          deleteCalled = true;
          assert.equal(sessionId, session.id);
        },
        openAssistantChat: (id?: string) => {
          openChatCalled = true;
          assert.equal(id, assistant.id);
        }
      } as unknown as ExtensionContext['chatController'],
      refreshAll: () => { refreshed = true; }
    });

    // P0 改造：确认已前移到 webview Danger Modal，Host 端不再弹 VS Code 原生对话框
    registerSessionCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.deleteSession')!;
    await handler(assistant.id, session.id);

    assert.equal(setSelectedCalled, true);
    assert.equal(deleteCalled, true);
    assert.equal(openChatCalled, true);
    assert.equal(refreshed, true);
  });

  test('directly executes without host confirmation (confirmed in webview)', async () => {
    // P0 改造：确认逻辑前移到 webview Danger Modal，Host 端命令直接执行
    let deleteCalled = false;
    let setSelectedCalled = false;
    const assistant = makeAssistant();
    const session = makeSession();
    const ctx = createMockContext({
      repository: {
        getAssistantById: () => assistant,
        setSelectedAssistant: () => { setSelectedCalled = true; },
        getSessionById: () => session
      } as unknown as ExtensionContext['repository'],
      chatController: {
        deleteSessionForSelectedAssistant: () => { deleteCalled = true; },
        openAssistantChat: () => { /* no-op */ }
      } as unknown as ExtensionContext['chatController'],
      refreshAll: () => { /* no-op */ }
    });

    registerSessionCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.deleteSession')!;
    await handler(assistant.id, session.id);

    // Host 端不再弹确认框，直接执行删除
    assert.equal(setSelectedCalled, true);
    assert.equal(deleteCalled, true);
  });
});

// ─── exportSession ──────────────────────────────────────────────────

describe('exportSession', () => {
  beforeEach(setupVscodeStubs);
  afterEach(restoreVscodeStubs);

  test('shows hint when ids are missing', async () => {
    let shownMessage: string | undefined;
    const ctx = createMockContext({
      getRuntimeStrings: () => ({
        exportSessionSelectHint: 'Select a session'
      })
    });

    vscode.window.showInformationMessage = async (message: string) => {
      shownMessage = message;
      return undefined;
    };

    registerSessionCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.exportSession')!;
    await handler(undefined, undefined);

    assert.equal(shownMessage, 'Select a session');
  });

  test('exports session to JSON', async () => {
    let writeFileCalled = false;
    const assistant = makeAssistant();
    const session = makeSession();
    const ctx = createMockContext({
      repository: {
        getAssistantById: () => assistant,
        getSessionById: () => session
      } as unknown as ExtensionContext['repository'],
      getRuntimeStrings: () => ({
        exportSessionAction: 'Export',
        exportFormatPrompt: 'Choose format',
        exportFormatJson: 'JSON',
        exportFormatMarkdown: 'Markdown',
        exportFormatHtml: 'HTML',
        exportSessionDone: 'Exported to {path}',
        exportSessionFailed: 'Export failed',
        untitledSession: 'Untitled',
        assistantRole: 'Assistant',
        exportGeneratedAtLabel: 'Generated at',
        userRole: 'User',
        systemRole: 'System',
        reasoningSectionTitle: 'Reasoning'
      })
    });

    (vscode.window as unknown as Record<string, unknown>).showQuickPick = async (items: Array<{ label: string; format: string; extension: string }>) =>
      items.find((item) => item.format === 'json');

    (vscode.window as unknown as Record<string, unknown>).showSaveDialog = async () =>
      vscode.Uri.file('/tmp/export.json');

    (vscode.workspace as unknown as { fs: { writeFile: typeof vscode.workspace.fs.writeFile } }).fs = {
      writeFile: async (_uri: unknown, _content: Uint8Array) => {
        writeFileCalled = true;
      }
    };

    vscode.window.showInformationMessage = async () => undefined;

    registerSessionCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.exportSession')!;
    await handler(assistant.id, session.id);

    assert.equal(writeFileCalled, true);
  });

  test('aborts when format is not selected', async () => {
    const assistant = makeAssistant();
    const session = makeSession();
    const ctx = createMockContext({
      repository: {
        getAssistantById: () => assistant,
        getSessionById: () => session
      } as unknown as ExtensionContext['repository'],
      getRuntimeStrings: () => ({
        exportFormatJson: 'JSON',
        exportFormatMarkdown: 'Markdown',
        exportFormatHtml: 'HTML',
        exportSessionAction: 'Export',
        exportFormatPrompt: 'Choose format',
        assistantRole: 'Assistant',
        exportGeneratedAtLabel: 'Generated at',
        userRole: 'User',
        systemRole: 'System',
        reasoningSectionTitle: 'Reasoning',
        untitledSession: 'Untitled'
      })
    });

    (vscode.window as unknown as Record<string, unknown>).showQuickPick = async () => undefined;

    registerSessionCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.exportSession')!;
    await handler(assistant.id, session.id);

    // Should not throw
    assert.ok(true);
  });
});

// ─── stopGeneration / regenerateReply ───────────────────────────────

describe('stopGeneration', () => {
  beforeEach(setupVscodeStubs);
  afterEach(restoreVscodeStubs);

  test('calls chatController.stopGeneration', () => {
    let stopCalled = false;
    const ctx = createMockContext({
      chatController: {
        stopGeneration: (reason: string) => {
          stopCalled = true;
          assert.equal(reason, 'manual');
        }
      } as unknown as ExtensionContext['chatController']
    });

    registerSessionCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.stopGeneration')!;
    handler();

    assert.equal(stopCalled, true);
  });
});

describe('regenerateReply', () => {
  beforeEach(setupVscodeStubs);
  afterEach(restoreVscodeStubs);

  test('calls chatController.regenerateReply', () => {
    let regenerateCalled = false;
    const ctx = createMockContext({
      chatController: {
        regenerateReply: () => { regenerateCalled = true; }
      } as unknown as ExtensionContext['chatController']
    });

    registerSessionCommands(ctx);
    const handler = registeredCommands.get('chatbuddy.regenerateReply')!;
    handler();

    assert.equal(regenerateCalled, true);
  });
});
