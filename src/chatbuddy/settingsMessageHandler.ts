/**
 * 设置中心消息处理器。
 *
 * 从 settingsCenterPanel 的 handleMessage 方法中提取，
 * 通过依赖注入接口解耦与控制器实例的直接绑定。
 */
import * as vscode from 'vscode';

import { formatString } from './i18n';
import { parseModelRef } from './modelCatalog';
import { McpRuntime } from './mcpRuntime';
import { OpenAICompatibleClient } from './providerClient';
import { ChatStateRepository } from './stateRepository';
import {
  cleanExpiredBackups,
  createLocalBackup,
  deleteLocalBackup,
  listLocalBackups,
  restoreLocalBackup
} from './localBackup';
import type { ChatBuddySettings, McpServerProfile, RuntimeLocale, RuntimeStrings } from './types';
import { normalizeProvider, toErrorMessage } from './utils';
import type {
  SettingsActionResult,
  SettingsCenterMessage,
  SettingsCenterOutbound
} from './settingsTypes';
import { normalizeMcpServers, normalizeMcpToolRounds } from './settingsTypes';

// ─── 依赖注入接口 ────────────────────────────────────────────────────

export interface SettingsMessageHandlerDeps {
  readonly repository: ChatStateRepository;
  readonly providerClient: OpenAICompatibleClient;
  readonly mcpRuntime: McpRuntime;
  readonly onSave: (settings: ChatBuddySettings) => void;
  readonly onReset: () => Promise<boolean> | boolean;
  readonly onExportData: () => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined;
  readonly onImportData: () => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined;
  readonly onImportLegacyData: () => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined;
  readonly onSelectiveExport: (categories: string[]) => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined;
  readonly onGetBackupPassword: () => Promise<string | undefined>;
  readonly onSetBackupPassword: (password: string) => Promise<void>;
  readonly onClearBackupPassword: () => Promise<void>;
  getLocale(): RuntimeLocale;
  getStrings(): RuntimeStrings;
  postState(notice?: string, tone?: 'success' | 'error' | 'info'): void;
  postMessage(message: SettingsCenterOutbound): void;
  probeAllMcpServers(): Promise<void>;
  probeSingleMcpServer(server: McpServerProfile): Promise<void>;
}

// ─── 消息处理器 ──────────────────────────────────────────────────────

export async function handleSettingsMessage(
  message: SettingsCenterMessage,
  deps: SettingsMessageHandlerDeps
): Promise<void> {
  if (message.type === 'ready') {
    deps.postState();
    return;
  }

  if (message.type === 'switchSection') {
    // Note: activeSection 更新由调用方处理
    return;
  }

  if (message.type === 'saveLocale') {
    const next = { ...deps.repository.getSettings(), locale: message.payload.locale };
    deps.onSave(next);
    deps.postState(deps.getStrings().localeSaved, 'success');
    return;
  }

  if (message.type === 'saveSendShortcut') {
    const validShortcuts = ['enter', 'ctrlEnter', 'shiftEnter'] as const;
    const raw = message.payload.sendShortcut;
    const sendShortcut = validShortcuts.includes(raw) ? raw : 'enter';
    const next: ChatBuddySettings = { ...deps.repository.getSettings(), sendShortcut };
    deps.onSave(next);
    deps.postState(deps.getStrings().sendShortcutSaved, 'success');
    return;
  }

  if (message.type === 'saveChatTabMode') {
    const chatTabMode = message.payload.chatTabMode === 'multi' ? 'multi' : 'single';
    const next: ChatBuddySettings = { ...deps.repository.getSettings(), chatTabMode };
    deps.onSave(next);
    deps.postState(deps.getStrings().chatTabModeSaved, 'success');
    return;
  }

  if (message.type === 'saveTimeout') {
    const timeoutMs = Math.max(5000, Math.min(300000, message.payload.timeoutMs || 300000));
    const next: ChatBuddySettings = { ...deps.repository.getSettings(), timeoutMs };
    deps.onSave(next);
    deps.postState(deps.getStrings().timeoutSaved, 'success');
    return;
  }

  if (message.type === 'saveDefaultAssistant') {
    const current = deps.repository.getSettings();
    deps.onSave({
      ...current,
      defaultModels: {
        ...current.defaultModels,
        assistant: parseModelRef(message.payload.assistant.trim())
      }
    });
    deps.postState(deps.getStrings().defaultAssistantModelSaved, 'success');
    return;
  }

  if (message.type === 'saveDefaultTitleSummary') {
    const current = deps.repository.getSettings();
    deps.onSave({
      ...current,
      defaultModels: {
        ...current.defaultModels,
        titleSummary: parseModelRef(message.payload.titleSummary.trim()) || undefined
      }
    });
    deps.postState(deps.getStrings().defaultTitleSummaryModelSaved, 'success');
    return;
  }

  if (message.type === 'saveTitleSummaryPrompt') {
    const current = deps.repository.getSettings();
    deps.onSave({
      ...current,
      defaultModels: {
        ...current.defaultModels,
        titleSummaryPrompt: message.payload.titleSummaryPrompt.trim() || undefined
      }
    });
    deps.postState(deps.getStrings().defaultTitleSummaryPromptSaved, 'success');
    return;
  }

  if (message.type === 'saveMcpServers') {
    const current = deps.repository.getSettings();
    deps.onSave(normalizeMcpServers(message.payload, current));
    deps.postState(deps.getStrings().mcpSettingsSaved, 'success');
    return;
  }

  if (message.type === 'saveMcpToolRounds') {
    const current = deps.repository.getSettings();
    const next = normalizeMcpToolRounds(message.payload, current);
    deps.onSave(next);
    deps.postState(deps.getStrings().mcpSettingsSaved, 'success');
    return;
  }

  if (message.type === 'requestAddMcpGroup') {
    const strings = deps.getStrings();
    const input = await vscode.window.showInputBox({
      prompt: strings.mcpGroupNameLabel || 'Group Name',
      value: 'New Group',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return strings.mcpGroupNameRequired || 'Group name is required';
        }
        return undefined;
      }
    });
    if (input?.trim()) {
      deps.postMessage({ type: 'mcpGroupAdded', payload: { name: input.trim() } });
    }
    return;
  }

  if (message.type === 'requestDeleteMcpGroup') {
    const strings = deps.getStrings();
    const groupName = message.payload.groupName || message.payload.groupId;
    const confirmDelete = await vscode.window.showWarningMessage(
      formatString(strings.mcpDeleteGroupConfirm || 'Delete group "{name}"?', { name: groupName }),
      { modal: true },
      strings.deleteAction || 'Delete'
    );
    if (confirmDelete === (strings.deleteAction || 'Delete')) {
      deps.postMessage({ type: 'mcpGroupDeleted', payload: { groupId: message.payload.groupId } });
    }
    return;
  }

  if (message.type === 'probeMcpServers') {
    void deps.probeAllMcpServers().catch(() => {});
    return;
  }

  if (message.type === 'testMcpServer') {
    void deps.probeSingleMcpServer(message.payload.server).catch(() => {});
    return;
  }

  if (message.type === 'saveProvider') {
    const provider = normalizeProvider(message.payload.provider);
    const silent = message.payload.silent === true;
    const current = deps.repository.getSettings();
    const nextProviders = current.providers.map((item) => (item.id === provider.id ? provider : item));
    const providerExists = nextProviders.some((item) => item.id === provider.id);
    if (!providerExists) {
      nextProviders.push(provider);
    }
    deps.onSave({
      ...current,
      providers: nextProviders
    });
    deps.postState(silent ? undefined : deps.getStrings().providerSaved, silent ? 'info' : 'success');
    return;
  }

  if (message.type === 'toggleProviderEnabled') {
    const providerId = message.payload.providerId.trim();
    if (!providerId) {
      deps.postState(deps.getStrings().providerIdRequired, 'error');
      return;
    }

    const current = deps.repository.getSettings();
    const target = current.providers.find((item) => item.id === providerId);
    if (!target) {
      deps.postState();
      return;
    }

    const strings = deps.getStrings();
    const enabled = !!message.payload.enabled;
    if (target.enabled === enabled) {
      deps.postState();
      return;
    }

    if (!enabled) {
      const confirmDisable = await vscode.window.showWarningMessage(
        formatString(strings.confirmDisableProvider, { name: target.name || providerId }),
        { modal: true },
        strings.disableProviderAction
      );
      if (confirmDisable !== strings.disableProviderAction) {
        return;
      }
    }

    deps.onSave({
      ...current,
      providers: current.providers.map((item) => (item.id === providerId ? { ...item, enabled } : item))
    });
    deps.postState(
      enabled
        ? formatString(strings.providerEnabledApplied, { name: target.name || providerId })
        : formatString(strings.providerDisabledApplied, { name: target.name || providerId }),
      'success'
    );
    return;
  }

  if (message.type === 'deleteProvider') {
    const providerId = message.payload.providerId.trim();
    const providerName = message.payload.providerName.trim();
    const strings = deps.getStrings();
    if (!providerId) {
      deps.postState(strings.providerIdRequired, 'error');
      return;
    }

    const confirmDelete = await vscode.window.showWarningMessage(
      formatString(strings.confirmDeleteProvider, {
        name: providerName || providerId
      }),
      { modal: true },
      strings.deleteProviderAction
    );
    if (confirmDelete !== strings.deleteProviderAction) {
      return;
    }

    const current = deps.repository.getSettings();
    const nextProviders = current.providers.filter((item) => item.id !== providerId);
    if (nextProviders.length === current.providers.length) {
      deps.postState();
      return;
    }

    deps.onSave({
      ...current,
      providers: nextProviders
    });
    deps.postState(deps.getStrings().providerDeleted, 'success');
    return;
  }

  if (message.type === 'deleteMcpServer') {
    const serverId = message.payload.serverId.trim();
    const serverName = message.payload.serverName.trim();
    const strings = deps.getStrings();
    if (!serverId) {
      deps.postState(strings.mcpServerIdRequired || 'Server ID is required', 'error');
      return;
    }

    const confirmDelete = await vscode.window.showWarningMessage(
      formatString(strings.mcpDeleteConfirm || 'Are you sure you want to delete server "{name}"?', {
        name: serverName || serverId
      }),
      { modal: true },
      strings.mcpDeleteServerAction || 'Delete'
    );
    if (confirmDelete !== (strings.mcpDeleteServerAction || 'Delete')) {
      return;
    }

    const current = deps.repository.getSettings();
    const nextServers = current.mcp.servers.filter((item) => item.id !== serverId);
    if (nextServers.length === current.mcp.servers.length) {
      deps.postState();
      return;
    }

    deps.onSave({
      ...current,
      mcp: {
        ...current.mcp,
        servers: nextServers
      }
    });
    deps.postState(strings.mcpServerDeleted || 'MCP server deleted', 'success');
    return;
  }

  if (message.type === 'testConnection') {
    const provider = normalizeProvider(message.payload.provider);
    const strings = deps.getStrings();
    const modelId = message.payload.modelId.trim();
    if (!modelId) {
      deps.postMessage({
        type: 'connectionResult',
        payload: {
          providerId: provider.id,
          success: false,
          message: strings.providerTestModelRequired
        }
      });
      return;
    }

    try {
      await deps.providerClient.testConnection(
        {
          id: provider.id,
          kind: provider.kind,
          name: provider.name,
          apiType: provider.apiType,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
          modelId
        },
        deps.getLocale()
      );
      deps.postMessage({
        type: 'connectionResult',
        payload: {
          providerId: provider.id,
          success: true,
          message: strings.providerConnectionSuccess
        }
      });
    } catch (error) {
      deps.postMessage({
        type: 'connectionResult',
        payload: {
          providerId: provider.id,
          success: false,
          message: toErrorMessage(error, strings.unknownError)
        }
      });
    }
    return;
  }

  if (message.type === 'fetchModels') {
    const provider = normalizeProvider(message.payload);
    const strings = deps.getStrings();
    try {
      const models = await deps.providerClient.fetchModels(
        {
          id: provider.id,
          kind: provider.kind,
          name: provider.name,
          apiType: provider.apiType,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl
        },
        deps.getLocale()
      );
      deps.postMessage({
        type: 'modelsFetched',
        payload: {
          providerId: provider.id,
          models,
          success: true,
          message: strings.providerModelsFetched
        }
      });
    } catch (error) {
      deps.postMessage({
        type: 'modelsFetched',
        payload: {
          providerId: provider.id,
          models: provider.models,
          success: false,
          message: toErrorMessage(error, strings.unknownError)
        }
      });
    }
    return;
  }

  if (message.type === 'reset') {
    const confirmed = await deps.onReset();
    if (confirmed) {
      deps.postState(deps.getStrings().resetDataDone, 'success');
    }
    return;
  }

  if (message.type === 'exportData') {
    try {
      const result = await deps.onExportData();
      if (result?.notice) {
        deps.postState(result.notice, result.tone ?? 'success');
      }
    } catch {
      deps.postState(deps.getStrings().unknownError, 'error');
    }
    return;
  }

  if (message.type === 'importData') {
    try {
      const result = await deps.onImportData();
      if (result?.notice) {
        deps.postState(result.notice, result.tone ?? 'success');
      }
    } catch {
      deps.postState(deps.getStrings().unknownError, 'error');
    }
    return;
  }

  if (message.type === 'importLegacyData') {
    try {
      const result = await deps.onImportLegacyData();
      if (result?.notice) {
        deps.postState(result.notice, result.tone ?? 'success');
      }
    } catch {
      deps.postState(deps.getStrings().unknownError, 'error');
    }
    return;
  }

  if (message.type === 'selectiveExport') {
    try {
      const categories = message.payload.categories;
      const result = await deps.onSelectiveExport(categories);
      if (result?.notice) {
        deps.postState(result.notice, result.tone ?? 'success');
      }
    } catch {
      deps.postState(deps.getStrings().unknownError, 'error');
    }
    return;
  }

  if (message.type === 'deleteTemplate') {
    const strings = deps.getStrings();
    const confirmDelete = await vscode.window.showWarningMessage(
      formatString(strings.templateDeleteConfirm || 'Are you sure you want to delete template "{name}"?', {
        name: message.templateName || message.templateId
      }),
      { modal: true },
      strings.deleteAction || 'Delete'
    );
    if (confirmDelete !== (strings.deleteAction || 'Delete')) {
      return;
    }
    deps.repository.deleteTemplate(message.templateId);
    deps.postState();
    return;
  }

  if (message.type === 'renameTemplate') {
    const strings = deps.getStrings();
    let name = message.name;
    if (!name?.trim()) {
      const input = await vscode.window.showInputBox({
        prompt: strings.templateRenamePrompt || 'Enter new template name',
        value: message.currentName || '',
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value || !value.trim()) {
            return strings.templateRenamePrompt || 'Name cannot be empty';
          }
          return undefined;
        }
      });
      if (!input) {
        return;
      }
      name = input.trim();
    }
    if (name?.trim()) {
      deps.repository.renameTemplate(message.templateId, name.trim());
    }
    deps.postState();
    return;
  }

  if (message.type === 'browseBackupDir') {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: deps.getStrings().backupDirBrowseTitle
    });
    if (result?.[0]) {
      deps.postMessage({ type: 'backupDirSelected', payload: { dir: result[0].fsPath } });
    }
    return;
  }

  if (message.type === 'saveLocalBackupSettings') {
    const current = deps.repository.getSettings();
    deps.onSave({ ...current, localBackup: message.payload });
    deps.postState(deps.getStrings().backupSettingsSaved, 'success');
    return;
  }

  if (message.type === 'triggerLocalBackup') {
    try {
      const settings = deps.repository.getSettings().localBackup;
      if (!settings.directory) {
        deps.postMessage({ type: 'backupOperationResult', payload: { success: false, message: deps.getStrings().backupDirNotSet } });
        return;
      }
      let password: string | undefined;
      if (settings.encryptionEnabled) {
        password = await deps.onGetBackupPassword();
        if (!password) {
          deps.postMessage({ type: 'backupOperationResult', payload: { success: false, message: deps.getStrings().backupPasswordRequired || 'Backup password is required' } });
          return;
        }
      }
      await createLocalBackup(deps.repository, settings.directory, password);
      await cleanExpiredBackups(settings.directory, settings.maxCount, settings.maxAgeDays);
      const items = await listLocalBackups(settings.directory);
      deps.postMessage({ type: 'backupList', payload: { items } });
      deps.postMessage({ type: 'backupOperationResult', payload: { success: true, message: deps.getStrings().backupCreated } });
    } catch (err) {
      deps.postMessage({ type: 'backupOperationResult', payload: { success: false, message: toErrorMessage(err, deps.getStrings().unknownError) } });
    }
    return;
  }

  if (message.type === 'restoreLocalBackup') {
    try {
      const settings = deps.repository.getSettings().localBackup;
      const fileName = message.payload.fileName;
      let password: string | undefined;
      if (fileName.endsWith('.enc.zip')) {
        password = await deps.onGetBackupPassword();
        if (!password) {
          const inputPassword = await vscode.window.showInputBox({
            prompt: deps.getStrings().backupPasswordPrompt || 'Enter backup password',
            password: true,
            ignoreFocusOut: true
          });
          if (!inputPassword) {
            deps.postMessage({ type: 'backupOperationResult', payload: { success: false, message: deps.getStrings().backupPasswordRequired || 'Backup password is required' } });
            return;
          }
          password = inputPassword;
        }
      }
      await restoreLocalBackup(deps.repository, settings.directory, fileName, password);
      deps.postMessage({ type: 'backupOperationResult', payload: { success: true, message: deps.getStrings().backupRestored } });
      deps.postState(deps.getStrings().backupRestored, 'success');
    } catch (err) {
      deps.postMessage({ type: 'backupOperationResult', payload: { success: false, message: toErrorMessage(err, deps.getStrings().unknownError) } });
    }
    return;
  }

  if (message.type === 'setBackupPassword') {
    try {
      let password = message.payload?.password;
      if (!password) {
        password = await vscode.window.showInputBox({
          prompt: deps.getStrings().backupPasswordPrompt || 'Enter backup password',
          password: true,
          ignoreFocusOut: true,
          validateInput: (value) => {
            if (!value || !value.trim()) {
              return deps.getStrings().backupPasswordEmpty || 'Password cannot be empty';
            }
            return undefined;
          }
        });
        if (!password) { return; }
      }
      await deps.onSetBackupPassword(password.trim());
      deps.postMessage({ type: 'backupPasswordStatus', payload: { hasPassword: true } });
      deps.postMessage({ type: 'backupOperationResult', payload: { success: true, message: deps.getStrings().backupPasswordSaved || 'Backup password saved' } });
    } catch (err) {
      deps.postMessage({ type: 'backupOperationResult', payload: { success: false, message: toErrorMessage(err, deps.getStrings().unknownError) } });
    }
    return;
  }

  if (message.type === 'clearBackupPassword') {
    try {
      await deps.onClearBackupPassword();
      deps.postMessage({ type: 'backupPasswordStatus', payload: { hasPassword: false } });
      deps.postMessage({ type: 'backupOperationResult', payload: { success: true, message: deps.getStrings().backupPasswordCleared || 'Backup password cleared' } });
    } catch (err) {
      deps.postMessage({ type: 'backupOperationResult', payload: { success: false, message: toErrorMessage(err, deps.getStrings().unknownError) } });
    }
    return;
  }

  if (message.type === 'queryBackupPasswordStatus') {
    try {
      const password = await deps.onGetBackupPassword();
      deps.postMessage({ type: 'backupPasswordStatus', payload: { hasPassword: !!password } });
    } catch {
      deps.postMessage({ type: 'backupPasswordStatus', payload: { hasPassword: false } });
    }
    return;
  }

  if (message.type === 'deleteLocalBackup') {
    try {
      const settings = deps.repository.getSettings().localBackup;
      await deleteLocalBackup(settings.directory, message.payload.fileName);
      const items = await listLocalBackups(settings.directory);
      deps.postMessage({ type: 'backupList', payload: { items } });
      deps.postMessage({ type: 'backupOperationResult', payload: { success: true, message: deps.getStrings().backupDeleted } });
    } catch (err) {
      deps.postMessage({ type: 'backupOperationResult', payload: { success: false, message: toErrorMessage(err, deps.getStrings().unknownError) } });
    }
    return;
  }

  if (message.type === 'refreshBackupList') {
    try {
      const settings = deps.repository.getSettings().localBackup;
      const items = settings.directory ? await listLocalBackups(settings.directory) : [];
      deps.postMessage({ type: 'backupList', payload: { items } });
    } catch {
      deps.postMessage({ type: 'backupList', payload: { items: [] } });
    }
    return;
  }
}
