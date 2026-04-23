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

export async function activate(context: vscode.ExtensionContext) {
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
  await repository.initialize();
  const providerClient = new OpenAICompatibleClient();
  const mcpRuntime = new McpRuntime();
  const chatController = new ChatController(repository, providerClient, mcpRuntime, context.extensionUri);

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

  const { handleResetData, handleExportData, handleImportData, handleImportLegacyData } = createDataActionHandlers({
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
    { dispose: () => { void mcpRuntime.dispose(); } },
    { dispose: () => { void repository.close(); } },
    { dispose: () => { if (backupTimer !== undefined) { clearInterval(backupTimer); } } }
  );
}

export function deactivate(): void {
  // Resources are cleaned up via context.subscriptions dispose
  // Backup timer cleanup handled via context.subscriptions below
}
