import * as vscode from 'vscode';

import { ChatController } from './chatbuddy/chatController';
import { formatString, getStrings, resolveLocale } from './chatbuddy/i18n';
import { McpRuntime } from './chatbuddy/mcpRuntime';
import { OpenAICompatibleClient } from './chatbuddy/providerClient';
import { safeSetContext, warn } from './chatbuddy/utils';
import { ChatStateRepository } from './chatbuddy/stateRepository';
import { ChatBuddySettings } from './chatbuddy/types';

import { PanelControllers } from './extension/activationTypes';
import { createDataActionHandlers } from './extension/dataActions';
import { createPanelControllers } from './extension/panelControllers';
import { createSidebarViewProviders } from './extension/sidebarViewProviders';
import { registerCommands } from './extension/commands';
import { getBackupIntervalMs, runScheduledBackup } from './chatbuddy/localBackup';

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
    const initStrings = getStrings(resolveLocale(undefined, vscode.env.language));
    void vscode.window.showErrorMessage(
      formatString(initStrings.initializationFailed, { msg })
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
    safeSetContext('chatbuddy.locale', getRuntimeLocale());
  };

  // 侧边栏 Webview View 集合（settings 阶段 1；assistants/recycleBin 阶段 2；sessions 阶段 3）
  const sidebarViewProviders = createSidebarViewProviders(context, {
    settings: { getLocale: getRuntimeLocale, getStrings: getRuntimeStrings },
    assistants: { repository, getLocale: getRuntimeLocale, getStrings: getRuntimeStrings },
    sessions: { repository, getLocale: getRuntimeLocale, getStrings: getRuntimeStrings }
  });
  const { settingsViewProvider, assistantsViewProvider, recycleBinViewProvider, sessionsViewProvider } = sidebarViewProviders;

  const panelControllers: Partial<PanelControllers> = {};

  const refreshAll = () => {
    updateLocaleContext();
    // 推送最新状态到各侧边栏 Webview
    settingsViewProvider.postState(settingsViewProvider.buildState());
    assistantsViewProvider.postState(assistantsViewProvider.buildState());
    recycleBinViewProvider.postState(recycleBinViewProvider.buildState());
    sessionsViewProvider.postState(sessionsViewProvider.buildState());
    panelControllers.settingsCenterPanelController?.refresh();
    panelControllers.assistantEditorPanelController?.refresh();
  };

  chatController.setActivePanelChangeCallback(() => {
    // 活动面板变化时刷新 sessions webview（与原 sessionsTreeProvider.refresh 等价）
    sessionsViewProvider.postState(sessionsViewProvider.buildState());
  });

  const applySettingsAndRefresh = (settings: ChatBuddySettings) => {
    repository.updateSettings(settings);
    chatController.applySettings(settings);
    // Prune MCP connections for servers that were removed or disabled
    const activeServerIds = new Set(settings.mcp.servers.map((s) => s.id));
    void mcpRuntime.pruneConnections(activeServerIds).catch(e => warn('MCP prune error:', e));
    restartBackupTimer(settings);
    refreshAll();
  };

  const { handleResetData, handleExportData, handleImportData, handleImportLegacyData, handleSelectiveExportData } = createDataActionHandlers({
    repository,
    chatController,
    sidebarViewProviders,
    refreshAll,
    getRuntimeStrings
  });

  const { settingsCenterPanelController, assistantEditorPanelController } = createPanelControllers({
    repository,
    providerClient,
    mcpRuntime,
    chatController,
    sidebarViewProviders,
    applySettingsAndRefresh,
    handleResetData,
    handleExportData,
    handleImportData,
    handleImportLegacyData,
    handleSelectiveExportData,
    onBackupSettingsChanged: () => restartBackupTimer(),
    refreshAll,
    getRuntimeStrings
  });

  panelControllers.settingsCenterPanelController = settingsCenterPanelController;
  panelControllers.assistantEditorPanelController = assistantEditorPanelController;

  const commandDisposables = registerCommands({
    repository,
    chatController,
    settingsCenterPanelController,
    assistantEditorPanelController,
    sidebarViewProviders,
    refreshAll,
    getRuntimeLocale,
    getRuntimeStrings
  });

  updateLocaleContext();

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
        const settings = repository.getSettings();
        void runScheduledBackup(repository, settings.localBackup).catch(e => warn('Scheduled backup error:', e));
      }, intervalMs);
    }
  };
  restartBackupTimer();

  context.subscriptions.push(
    ...commandDisposables,
    { dispose: () => { settingsCenterPanelController.dispose(); } },
    { dispose: () => { assistantEditorPanelController.dispose(); } },
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
