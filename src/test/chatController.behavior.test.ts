import test from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';

import { ChatController } from '../chatbuddy/chatController';
import { AssistantProfile, ChatBuddySettings } from '../chatbuddy/types';

type Disposable = { dispose: () => void };

type FakeWebview = {
  cspSource: string;
  html: string;
  asWebviewUri: (uri: unknown) => unknown;
  onDidReceiveMessage: (cb: (message: unknown) => void) => Disposable;
  postMessage: (message: unknown) => Promise<boolean>;
};

type FakePanel = {
  title: string;
  iconPath: unknown;
  webview: FakeWebview;
  revealCount: number;
  onDidDispose: (cb: () => void) => Disposable;
  onDidChangeViewState: (cb: (e: { webviewPanel: FakePanel }) => void) => Disposable;
  reveal: (column: unknown) => void;
  dispose: () => void;
};

function createAssistant(id: string, name: string): AssistantProfile {
  const now = Date.now();
  return {
    id,
    name,
    note: '',
    avatar: 'account',
    groupId: 'default',
    systemPrompt: '',
    greeting: '',
    questionPrefix: '',
    modelRef: 'provider:model',
    temperature: 0.7,
    topP: 1,
    maxTokens: 1024,
    contextCount: 8,
    presencePenalty: 0,
    frequencyPenalty: 0,
    streaming: true,
    enabledMcpServerIds: [],
    pinned: false,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
    lastInteractedAt: now
  };
}

function createSettings(chatTabMode: 'single' | 'multi'): ChatBuddySettings {
  return {
    providers: [],
    defaultModels: {},
    mcp: {
      servers: [],
      maxToolRounds: 3
    },
    temperature: 0.7,
    topP: 1,
    maxTokens: 1024,
    presencePenalty: 0,
    frequencyPenalty: 0,
    timeoutMs: 30000,
    streamingDefault: true,
    locale: 'en',
    sendShortcut: 'enter',
    chatTabMode
  };
}

function createFakePanel(): FakePanel {
  const disposeListeners: Array<() => void> = [];
  const panel: FakePanel = {
    title: '',
    iconPath: undefined,
    webview: {
      cspSource: 'vscode-test',
      html: '',
      asWebviewUri: (uri) => uri,
      onDidReceiveMessage(_cb) {
        return {
          dispose() {
            return undefined;
          }
        };
      },
      async postMessage(_message: unknown) {
        return true;
      }
    },
    revealCount: 0,
    onDidDispose(cb) {
      disposeListeners.push(cb);
      return {
        dispose() {
          const index = disposeListeners.indexOf(cb);
          if (index >= 0) {
            disposeListeners.splice(index, 1);
          }
        }
      };
    },
    onDidChangeViewState() {
      return { dispose() { return undefined; } };
    },
    reveal(_column: unknown) {
      this.revealCount += 1;
    },
    dispose() {
      for (const listener of [...disposeListeners]) {
        listener();
      }
      disposeListeners.length = 0;
    }
  };
  return panel;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('openAssistantChat reuses single-tab panel', () => {
  const assistant = createAssistant('a-1', 'Assistant 1');
  let selectedAssistantId = assistant.id;
  const panels: FakePanel[] = [];
  const originalCreatePanel = (vscode.window as { createWebviewPanel?: unknown }).createWebviewPanel;
  (vscode.window as unknown as { createWebviewPanel: (...args: unknown[]) => FakePanel }).createWebviewPanel = () => {
    const panel = createFakePanel();
    panels.push(panel);
    return panel;
  };

  try {
    const repository = {
      getSelectedAssistant: () => (selectedAssistantId === assistant.id ? assistant : undefined),
      setSelectedAssistant: (id: string) => {
        selectedAssistantId = id;
      },
      getSettings: () => createSettings('single'),
      getModelOptions: () => []
    };

    const controller = new ChatController(
      repository as unknown as ConstructorParameters<typeof ChatController>[0],
      {} as ConstructorParameters<typeof ChatController>[1],
      {} as ConstructorParameters<typeof ChatController>[2],
      vscode.Uri.file('/tmp/chatbuddy-test')
    );
    const controllerProxy = controller as unknown as {
      ensureSession: (assistantId: string) => void;
      postState: () => void;
      panel?: FakePanel;
      openAssistantChat: () => void;
    };
    controllerProxy.ensureSession = () => undefined;
    controllerProxy.postState = () => undefined;

    controllerProxy.openAssistantChat();
    controllerProxy.openAssistantChat();

    assert.equal(panels.length, 1);
    assert.equal(panels[0].revealCount, 1);
    assert.equal(controllerProxy.panel, panels[0]);
  } finally {
    if (originalCreatePanel) {
      (vscode.window as { createWebviewPanel: unknown }).createWebviewPanel = originalCreatePanel;
    } else {
      delete (vscode.window as { createWebviewPanel?: unknown }).createWebviewPanel;
    }
  }
});

test('openAssistantChat creates separate panels in multi-tab mode', () => {
  const assistantA = createAssistant('a-1', 'Assistant 1');
  const assistantB = createAssistant('a-2', 'Assistant 2');
  const assistants = new Map([
    [assistantA.id, assistantA],
    [assistantB.id, assistantB]
  ]);
  let selectedAssistantId = assistantA.id;
  const panels: FakePanel[] = [];
  const originalCreatePanel = (vscode.window as { createWebviewPanel?: unknown }).createWebviewPanel;
  (vscode.window as unknown as { createWebviewPanel: (...args: unknown[]) => FakePanel }).createWebviewPanel = () => {
    const panel = createFakePanel();
    panels.push(panel);
    return panel;
  };

  try {
    const repository = {
      getSelectedAssistant: () => assistants.get(selectedAssistantId),
      setSelectedAssistant: (id: string) => {
        selectedAssistantId = id;
      },
      getSettings: () => createSettings('multi'),
      getModelOptions: () => []
    };

    const controller = new ChatController(
      repository as unknown as ConstructorParameters<typeof ChatController>[0],
      {} as ConstructorParameters<typeof ChatController>[1],
      {} as ConstructorParameters<typeof ChatController>[2],
      vscode.Uri.file('/tmp/chatbuddy-test')
    );
    const controllerProxy = controller as unknown as {
      ensureSession: (assistantId: string) => void;
      postState: () => void;
      panelsByAssistantId: Map<string, FakePanel>;
      openAssistantChat: (assistantId?: string) => void;
    };
    controllerProxy.ensureSession = () => undefined;
    controllerProxy.postState = () => undefined;

    controllerProxy.openAssistantChat(assistantA.id);
    controllerProxy.openAssistantChat(assistantA.id);
    controllerProxy.openAssistantChat(assistantB.id);

    assert.equal(panels.length, 2);
    assert.equal(panels[0].revealCount, 1);
    assert.equal(controllerProxy.panelsByAssistantId.size, 2);
    assert.equal(controllerProxy.panelsByAssistantId.get(assistantA.id), panels[0]);
    assert.equal(controllerProxy.panelsByAssistantId.get(assistantB.id), panels[1]);
  } finally {
    if (originalCreatePanel) {
      (vscode.window as { createWebviewPanel: unknown }).createWebviewPanel = originalCreatePanel;
    } else {
      delete (vscode.window as { createWebviewPanel?: unknown }).createWebviewPanel;
    }
  }
});

test('stream state post scheduling is throttled and flush posts immediately', async () => {
  const assistant = createAssistant('a-1', 'Assistant 1');
  const repository = {
    getSelectedAssistant: () => assistant,
    setSelectedAssistant: (_id: string) => undefined,
    getSettings: () => createSettings('single'),
    getModelOptions: () => []
  };

  const controller = new ChatController(
    repository as unknown as ConstructorParameters<typeof ChatController>[0],
    {} as ConstructorParameters<typeof ChatController>[1],
    {} as ConstructorParameters<typeof ChatController>[2],
    vscode.Uri.file('/tmp/chatbuddy-test')
  );
  const panel = createFakePanel();
  let postStateCount = 0;
  const controllerProxy = controller as unknown as {
    panel?: FakePanel;
    postState: () => void;
    scheduleStreamStatePost: (context?: { panel: FakePanel }) => void;
    flushScheduledStreamStatePost: (context?: { panel: FakePanel }) => void;
  };
  controllerProxy.panel = panel;
  controllerProxy.postState = () => {
    postStateCount += 1;
  };

  controllerProxy.scheduleStreamStatePost({ panel });
  controllerProxy.scheduleStreamStatePost({ panel });
  await wait(120);
  assert.equal(postStateCount, 1);

  controllerProxy.scheduleStreamStatePost({ panel });
  controllerProxy.flushScheduledStreamStatePost({ panel });
  assert.equal(postStateCount, 2);
  await wait(120);
  assert.equal(postStateCount, 2);
});
