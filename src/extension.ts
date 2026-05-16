import * as vscode from 'vscode';

import type { AssistantsTreeNode } from './chatbuddy/assistantsView';
import { ChatController } from './chatbuddy/chatController';
import { getStrings, resolveLocale } from './chatbuddy/i18n';
import { McpRuntime } from './chatbuddy/mcpRuntime';
import { OpenAICompatibleClient } from './chatbuddy/providerClient';
import { warn } from './chatbuddy/utils';
import { ChatStateRepository } from './chatbuddy/stateRepository';
import { ChatBuddySettings } from './chatbuddy/types';

import { PanelControllers } from './extension/activationTypes';
import { createDataActionHandlers } from './extension/dataActions';
import { createPanelControllers } from './extension/panelControllers';
import { createTreeProviders, createTreeViews, createSettingsTreeDataSource } from './extension/treeViews';
import { registerCommands } from './extension/commands';
import { getBackupIntervalMs, runScheduledBackup } from './chatbuddy/localBackup';
import { SyncWatcher } from './chatbuddy/syncWatcher';

// Module-level references for async cleanup in deactivate()
let _mcpRuntime: McpRuntime | undefined;
let _repository: ChatStateRepository | undefined;

export async function activate(context: vscode.ExtensionContext) {
  // Polyfill DOMMatrix for libraries (e.g. pdf-parse) that bundle browser code
  // containing DOMMatrix usage, which is undefined in some VS Code/Electron versions.
  if (typeof (globalThis as unknown as Record<string, unknown>).DOMMatrix === 'undefined') {
    (globalThis as unknown as Record<string, unknown>).DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      m11 = 1; m12 = 0; m13 = 0; m14 = 0;
      m21 = 0; m22 = 1; m23 = 0; m24 = 0;
      m31 = 0; m32 = 0; m33 = 1; m34 = 0;
      m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    };
  }

  // Global unhandled rejection handler — prevents silent crashes in production.
  // Silently ignore benign errors from VSCode's internal lifecycle:
  // - Canceled: panel disposal, extension deactivation, abort controllers
  // - AbortError: standard fetch/web API abort
  // - Channel has been closed: webview disposed while message in flight
  const unhandledRejectionHandler = (reason: unknown) => {
    if (reason instanceof Error) {
      const msg = reason.message || '';
      const name = reason.name || '';
      if (name === 'Canceled' || name === 'AbortError' || msg === 'Channel has been closed') {
        return;
      }
    }
    warn('Unhandled promise rejection:', reason);
  };
  process.on('unhandledRejection', unhandledRejectionHandler);
  context.subscriptions.push({
    dispose: () => {
      process.off('unhandledRejection', unhandledRejectionHandler);
    }
  });

  const repository = new ChatStateRepository(context);
  try {
    await repository.initialize();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warn('ChatStateRepository initialization failed:', msg);
    void vscode.window.showErrorMessage(
      `ChatBuddy initialization failed: ${msg}. Some features may be unavailable.`
    );
  }
  const providerClient = new OpenAICompatibleClient();
  const mcpRuntime = new McpRuntime();
  const chatController = new ChatController(repository, providerClient, mcpRuntime, context.extensionUri);

  // Store references for async cleanup in deactivate()
  _mcpRuntime = mcpRuntime;
  _repository = repository;

  const getRuntimeLocale = () => resolveLocale(repository.getLocaleSetting(), vscode.env.language);
  const getRuntimeStrings = () => getStrings(getRuntimeLocale());
  const updateLocaleContext = () => {
    void vscode.commands.executeCommand('setContext', 'chatbuddy.locale', getRuntimeLocale());
  };
  const { emitter: settingsTreeDataEmitter, provider: settingsTreeProvider } = createSettingsTreeDataSource(getRuntimeStrings);
  const { assistantsTreeProvider, recycleBinTreeProvider, sessionsTreeProvider } = createTreeProviders(repository);
  const { assistantsTreeView, recycleBinTreeView, sessionsTreeView, settingsTreeView } = createTreeViews({
    assistantsTreeProvider,
    recycleBinTreeProvider,
    sessionsTreeProvider,
    settingsTreeProvider
  });

  const panelControllers: Partial<PanelControllers> = {};

  const updateViewHeadings = () => {
    const strings = getRuntimeStrings();
    assistantsTreeView.title = strings.assistantsViewTitle || strings.searchAssistants;
    assistantsTreeView.description = undefined;
    recycleBinTreeView.title = strings.recycleBinViewTitle || strings.emptyRecycleBin;
    recycleBinTreeView.description = undefined;
    settingsTreeView.title = strings.settingsViewTitle || strings.settingsTitle;
    settingsTreeView.description = undefined;

    const selectedAssistant = repository.getSelectedAssistant();
    sessionsTreeView.title =
      selectedAssistant && !selectedAssistant.isDeleted
        ? `${strings.sessions} · ${selectedAssistant.name}`
        : strings.sessions;
    sessionsTreeView.description = undefined;
  };

  const updateTreeMessage = () => {
    const strings = getRuntimeStrings();
    const keyword = assistantsTreeProvider.getSearchKeyword();
    assistantsTreeView.message = keyword ? `${strings.searchAssistants}: ${keyword}` : undefined;
    recycleBinTreeView.message = undefined;
    const sessionKeyword = sessionsTreeProvider.getSearchKeyword();
    sessionsTreeView.message = sessionKeyword ? `${strings.searchSessions}: ${sessionKeyword}` : undefined;
  };

  const refreshAll = () => {
    updateLocaleContext();
    assistantsTreeProvider.refresh();
    sessionsTreeProvider.refresh();
    recycleBinTreeProvider.refresh();
    settingsTreeDataEmitter.fire();
    panelControllers.settingsCenterPanelController?.refresh();
    panelControllers.assistantEditorPanelController?.refresh();
    updateViewHeadings();
  };

  chatController.setActivePanelChangeCallback(() => {
    sessionsTreeProvider.refresh();
    updateViewHeadings();
  });

  const applySettingsAndRefresh = (settings: ChatBuddySettings) => {
    repository.updateSettings(settings);
    chatController.applySettings(settings);
    // Prune MCP connections for servers that were removed or disabled
    const activeServerIds = new Set(settings.mcp.servers.map((s) => s.id));
    void mcpRuntime.pruneConnections(activeServerIds);
    restartBackupTimer(settings);
    refreshAll();
    updateTreeMessage();
  };

  const { handleResetData, handleExportData, handleImportData, handleImportLegacyData, handleSelectiveExportData } = createDataActionHandlers({
    repository,
    chatController,
    getAssistantsTreeProvider: () => assistantsTreeProvider,
    getRecycleBinTreeProvider: () => recycleBinTreeProvider,
    refreshAll,
    updateTreeMessage,
    getRuntimeStrings
  });

  const { settingsCenterPanelController, assistantEditorPanelController } = createPanelControllers({
    repository,
    providerClient,
    mcpRuntime,
    chatController,
    assistantsTreeProvider,
    assistantsTreeView,
    applySettingsAndRefresh,
    handleResetData,
    handleExportData,
    handleImportData,
    handleImportLegacyData,
    handleSelectiveExportData,
    getBackupPassword: async () => {
      const fromSecrets = await context.secrets.get('chatbuddy.backupPassword');
      if (fromSecrets) { return fromSecrets; }
      // 回退：从 Compass 共享存储读取密码（跨 IDE 同步场景）
      const fromSettings = repository.getSettings().localBackup.password;
      if (fromSettings) {
        await context.secrets.store('chatbuddy.backupPassword', fromSettings);
      }
      return fromSettings || undefined;
    },
    setBackupPassword: async (password: string) => context.secrets.store('chatbuddy.backupPassword', password),
    clearBackupPassword: async () => context.secrets.delete('chatbuddy.backupPassword'),
    onBackupSettingsChanged: () => restartBackupTimer(),
    refreshAll,
    updateTreeMessage,
    getRuntimeStrings
  });

  panelControllers.settingsCenterPanelController = settingsCenterPanelController;
  panelControllers.assistantEditorPanelController = assistantEditorPanelController;

  const commandDisposables = registerCommands({
    repository,
    chatController,
    settingsCenterPanelController,
    assistantEditorPanelController,
    assistantsTreeProvider,
    sessionsTreeProvider,
    refreshAll,
    updateTreeMessage,
    getRuntimeLocale,
    getRuntimeStrings
  });

  updateLocaleContext();
  updateTreeMessage();
  updateViewHeadings();

  // Local backup auto-timer
  let backupTimer: ReturnType<typeof setInterval> | undefined;
  const restartBackupTimer = (settings?: ChatBuddySettings) => {
    if (backupTimer !== undefined) {
      clearInterval(backupTimer);
      backupTimer = undefined;
    }
    const current = settings || repository.getSettings();

    const intervalMs = getBackupIntervalMs(current.localBackup);
    if (intervalMs > 0) {
      backupTimer = setInterval(() => {
        void runScheduledBackup(repository, current.localBackup);
      }, intervalMs);
    }
  };
  restartBackupTimer();

  // Cross-IDE sync watcher (only when shared storage is enabled)
  if (repository.isUsingSharedStorage()) {
    const syncStoragePath = repository.getStorageRootPath();
    if (syncStoragePath) {
      const syncWatcher = new SyncWatcher(syncStoragePath, {
        onExternalChange: (categories) => {
          const isGenerating = chatController.isGenerating();
          const hasSessions = categories.has('sessions');
          const hasNonSession = categories.has('core') || categories.has('settings') || categories.has('images');

          if (isGenerating && hasSessions && !hasNonSession) {
            // 只有 session 变更且正在生成：只刷新树视图，不 reload 数据
            // 避免打断用户的生成体验
            sessionsTreeProvider.refresh();
            return;
          }

          void repository.reloadFromSharedStorage(categories).then(async () => {
            // 同步备份密码：从 Compass 共享存储同步到 context.secrets
            const settings = repository.getSettings();
            const existingPassword = await context.secrets.get('chatbuddy.backupPassword');
            if (settings.localBackup.password && !existingPassword) {
              await context.secrets.store('chatbuddy.backupPassword', settings.localBackup.password);
            } else if (!settings.localBackup.password && existingPassword) {
              await context.secrets.delete('chatbuddy.backupPassword');
            }
            // 备份设置可能已变更（间隔、目录、启停），重启定时器
            restartBackupTimer();
            refreshAll();
            updateTreeMessage();
            // 刷新聊天面板，使 WebView 加载最新的会话数据
            chatController.postStateToActivePanel();
            // 通知设置中心刷新密码状态（跨 IDE 同步场景）
            settingsCenterPanelController.postBackupPasswordStatus();
          });
        },
        getIsGenerating: () => chatController.isGenerating()
      });

      syncWatcher.start();
      repository.setSyncWatcher(syncWatcher);
      context.subscriptions.push(syncWatcher);

      // Notify watcher when generation ends so pending changes can be surfaced
      chatController.setOnGenerationEnd(() => {
        syncWatcher.notifyGeneratingEnded();
      });
    }
  }

  context.subscriptions.push(
    assistantsTreeView,
    sessionsTreeView,
    recycleBinTreeView,
    settingsTreeView,
    settingsTreeDataEmitter,
    ...commandDisposables,
    assistantsTreeView.onDidExpandElement((e) => {
      const node = e.element as AssistantsTreeNode;
      if (node.kind === 'group') {
        repository.setGroupCollapsed(node.group.id, false);
      }
    }),
    assistantsTreeView.onDidCollapseElement((e) => {
      const node = e.element as AssistantsTreeNode;
      if (node.kind === 'group') {
        repository.setGroupCollapsed(node.group.id, true);
      }
    }),
    { dispose: () => { chatController.dispose(); } },
    // Note: mcpRuntime.dispose() and repository.close() are async;
    // they are awaited in deactivate() below rather than here.
    { dispose: () => { if (backupTimer !== undefined) { clearInterval(backupTimer); } } }
  );
}

export async function deactivate(): Promise<void> {
  // Resources are cleaned up via context.subscriptions dispose above.
  // Await async disposals to ensure proper cleanup before process exits.
  await _mcpRuntime?.dispose();
  await _repository?.close();
}
