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
import { normalizeProvider, toErrorMessage, warn } from './utils';
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
  readonly onReset: (skipConfirm?: boolean) => Promise<boolean> | boolean;
  readonly onExportData: () => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined;
  readonly onImportData: (skipConfirm?: boolean) => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined;
  readonly onImportLegacyData: (skipConfirm?: boolean) => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined;
  readonly onSelectiveExport: (categories: string[]) => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined;
  /** 备份设置变更后回调（用于重启自动备份定时器） */
  onBackupSettingsChanged?: () => void;
  getLocale(): RuntimeLocale;
  getStrings(): RuntimeStrings;
  postState(notice?: string, tone?: 'success' | 'error' | 'info'): void;
  postMessage(message: SettingsCenterOutbound): void;
  probeAllMcpServers(): Promise<void>;
  probeSingleMcpServer(server: McpServerProfile): Promise<void>;
}

// ─── 删除竞态保护 ──────────────────────────────────────────────────
// 当 webview 删除 provider 后，可能仍有该 provider 的 autosave saveProvider
// 消息在队列中等待处理。upsert 逻辑会将已删除的 provider 重新添加回去。
// 通过记录最近删除的 provider ID 来阻止这种竞态重建。
const recentlyDeletedProviderIds = new Set<string>();
const RECENTLY_DELETED_TTL_MS = 5 * 60 * 1000; // 5 minutes
const recentlyDeletedTimestamps = new Map<string, number>();
const recentlyDeletedMcpServerIds = new Set<string>();
const recentlyDeletedMcpServerTimestamps = new Map<string, number>();

// 定期清理过期条目，避免模块级 Set/Map 无限增长
function cleanupStaleDeletedIds(): void {
  const now = Date.now();
  for (const [id, ts] of recentlyDeletedTimestamps) {
    if (now - ts > RECENTLY_DELETED_TTL_MS) {
      recentlyDeletedProviderIds.delete(id);
      recentlyDeletedTimestamps.delete(id);
    }
  }
  for (const [id, ts] of recentlyDeletedMcpServerTimestamps) {
    if (now - ts > RECENTLY_DELETED_TTL_MS) {
      recentlyDeletedMcpServerIds.delete(id);
      recentlyDeletedMcpServerTimestamps.delete(id);
    }
  }
}

// ─── 消息处理器 ──────────────────────────────────────────────────────

export async function handleSettingsMessage(
  message: SettingsCenterMessage,
  deps: SettingsMessageHandlerDeps
): Promise<void> {
  cleanupStaleDeletedIds();
  switch (message.type) {
    case 'ready': {
      deps.postState();
      return;
    }
    case 'switchSection': {
      // Note: activeSection 更新由调用方处理
      return;
    }
    case 'saveLocale': {
      const next = { ...deps.repository.getSettings(), locale: message.payload.locale };
      deps.onSave(next);
      deps.postState(deps.getStrings().localeSaved, 'success');
      return;
    }
    case 'saveSendShortcut': {
      const validShortcuts = ['enter', 'ctrlEnter', 'shiftEnter'] as const;
      const raw = message.payload.sendShortcut;
      const sendShortcut = validShortcuts.includes(raw) ? raw : 'enter';
      const next: ChatBuddySettings = { ...deps.repository.getSettings(), sendShortcut };
      deps.onSave(next);
      deps.postState(deps.getStrings().sendShortcutSaved, 'success');
      return;
    }
    case 'saveChatTabMode': {
      const chatTabMode = message.payload.chatTabMode === 'multi' ? 'multi' : 'single';
      const next: ChatBuddySettings = { ...deps.repository.getSettings(), chatTabMode };
      deps.onSave(next);
      deps.postState(deps.getStrings().chatTabModeSaved, 'success');
      return;
    }
    case 'saveTimeout': {
      const timeoutMs = message.payload.timeoutMs === 0 ? 0 : Math.max(5000, Math.min(300000, message.payload.timeoutMs || 300000));
      const next: ChatBuddySettings = { ...deps.repository.getSettings(), timeoutMs };
      deps.onSave(next);
      deps.postState(deps.getStrings().timeoutSaved, 'success');
      return;
    }
    case 'saveDefaultAssistant': {
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
    case 'saveDefaultTitleSummary': {
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
    case 'saveTitleSummaryPrompt': {
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
    case 'saveMcpServers': {
      cleanupStaleDeletedIds();
      const current = deps.repository.getSettings();
      // 过滤已删除的 MCP server，防止竞态重建
      const rawPayload = message.payload;
      const filteredPayload = Array.isArray(rawPayload)
        ? rawPayload.filter((s: { id: string }) => !recentlyDeletedMcpServerIds.has(s.id))
        : { ...rawPayload, servers: rawPayload.servers.filter((s: { id: string }) => !recentlyDeletedMcpServerIds.has(s.id)) };
      deps.onSave(normalizeMcpServers(filteredPayload, current));
      deps.postState(deps.getStrings().mcpSettingsSaved, 'success');
      return;
    }
    case 'saveMcpToolRounds': {
      const current = deps.repository.getSettings();
      const next = normalizeMcpToolRounds(message.payload, current);
      deps.onSave(next);
      deps.postState(deps.getStrings().mcpSettingsSaved, 'success');
      return;
    }
    case 'requestAddMcpGroup': {
      await handleRequestAddMcpGroup(deps);
      return;
    }
    case 'requestDeleteMcpGroup': {
      await handleRequestDeleteMcpGroup(message, deps);
      return;
    }
    case 'probeMcpServers': {
      void deps.probeAllMcpServers().catch((err) => { warn('[Settings] MCP probe failed:', err); });
      return;
    }
    case 'testMcpServer': {
      void deps.probeSingleMcpServer(message.payload.server).catch((err) => { warn('[Settings] MCP server probe failed:', err); });
      return;
    }
    case 'saveProvider': {
      await handleSaveProvider(message, deps);
      return;
    }
    case 'toggleProviderEnabled': {
      await handleToggleProviderEnabled(message, deps);
      return;
    }
    case 'deleteProvider': {
      await handleDeleteProvider(message, deps);
      return;
    }
    case 'deleteMcpServer': {
      await handleDeleteMcpServer(message, deps);
      return;
    }
    case 'testConnection': {
      await handleTestConnection(message, deps);
      return;
    }
    case 'fetchModels': {
      await handleFetchModels(message, deps);
      return;
    }
    case 'reset': {
      const confirmed = await deps.onReset(message.skipConfirm);
      if (confirmed) {
        deps.postState(deps.getStrings().resetDataDone, 'success');
      }
      return;
    }
    case 'exportData': {
      try {
        const result = await deps.onExportData();
        if (result?.notice) {
          deps.postState(result.notice, result.tone ?? 'success');
        }
      } catch (err) {
        warn('Error exporting data:', err);
        deps.postState(deps.getStrings().unknownError, 'error');
      }
      return;
    }
    case 'importData': {
      try {
        const result = await deps.onImportData(message.skipConfirm);
        if (result?.notice) {
          deps.postState(result.notice, result.tone ?? 'success');
        }
      } catch (err) {
        warn('Error importing data:', err);
        deps.postState(deps.getStrings().unknownError, 'error');
      }
      return;
    }
    case 'importLegacyData': {
      try {
        const result = await deps.onImportLegacyData(message.skipConfirm);
        if (result?.notice) {
          deps.postState(result.notice, result.tone ?? 'success');
        }
      } catch (err) {
        warn('Error importing legacy data:', err);
        deps.postState(deps.getStrings().unknownError, 'error');
      }
      return;
    }
    case 'selectiveExport': {
      try {
        const categories = message.payload.categories;
        const result = await deps.onSelectiveExport(categories);
        if (result?.notice) {
          deps.postState(result.notice, result.tone ?? 'success');
        }
      } catch (err) {
        warn('Error in selective export:', err);
        deps.postState(deps.getStrings().unknownError, 'error');
      }
      return;
    }
    case 'deleteTemplate': {
      await handleDeleteTemplate(message, deps);
      return;
    }
    case 'renameTemplate': {
      await handleRenameTemplate(message, deps);
      return;
    }
    case 'browseBackupDir': {
      await handleBrowseBackupDir(deps);
      return;
    }
    case 'saveLocalBackupSettings': {
      const current = deps.repository.getSettings();
      deps.onSave({ ...current, localBackup: { ...message.payload } });
      deps.onBackupSettingsChanged?.();
      deps.postState(deps.getStrings().backupSettingsSaved, 'success');
      return;
    }
    case 'triggerLocalBackup': {
      await handleTriggerLocalBackup(deps);
      return;
    }
    case 'restoreLocalBackup': {
      await handleRestoreLocalBackup(message, deps);
      return;
    }
    case 'deleteLocalBackup': {
      await handleDeleteLocalBackup(message, deps);
      return;
    }
    case 'refreshBackupList': {
      await handleRefreshBackupList(deps);
      return;
    }
  }
}

// ─── 提取的复杂 case 处理函数 ──────────────────────────────────────

async function handleRequestAddMcpGroup(deps: SettingsMessageHandlerDeps): Promise<void> {
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
}

async function handleRequestDeleteMcpGroup(
  message: Extract<SettingsCenterMessage, { type: 'requestDeleteMcpGroup' }>,
  deps: SettingsMessageHandlerDeps
): Promise<void> {
  // 前端 webview 已通过 Danger Modal 确认，Host 端直接执行
  deps.postMessage({ type: 'mcpGroupDeleted', payload: { groupId: message.payload.groupId } });
}

async function handleSaveProvider(
  message: Extract<SettingsCenterMessage, { type: 'saveProvider' }>,
  deps: SettingsMessageHandlerDeps
): Promise<void> {
  const provider = normalizeProvider(message.payload.provider);
  const silent = message.payload.silent === true;
  // 阻止已删除 provider 的延迟 autosave 消息重建供应商
  if (recentlyDeletedProviderIds.has(provider.id)) {
    return;
  }
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
}

async function handleToggleProviderEnabled(
  message: Extract<SettingsCenterMessage, { type: 'toggleProviderEnabled' }>,
  deps: SettingsMessageHandlerDeps
): Promise<void> {
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

  // 前端 webview 已确认时跳过 VS Code 原生对话框（A 类：webview 内触发）
  // 命令面板等其它路径暂无，保留兜底确认逻辑
  if (!message.payload.skipConfirm) {
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
}

async function handleDeleteProvider(
  message: Extract<SettingsCenterMessage, { type: 'deleteProvider' }>,
  deps: SettingsMessageHandlerDeps
): Promise<void> {
  const providerId = message.payload.providerId.trim();
  const providerName = message.payload.providerName.trim();
  const strings = deps.getStrings();
  if (!providerId) {
    deps.postState(strings.providerIdRequired, 'error');
    return;
  }

  // webview 已确认时跳过 VS Code 原生对话框，避免关闭面板导致对话框被取消
  // skipConfirm=false 为兜底路径（前端未覆盖时保留 Host 端确认）
  if (!message.payload.skipConfirm) {
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
  }

  const current = deps.repository.getSettings();
  const nextProviders = current.providers.filter((item) => item.id !== providerId);
  if (nextProviders.length === current.providers.length) {
    deps.postState();
    return;
  }

  // 记录已删除的 provider ID，阻止后续延迟到达的 saveProvider 消息重建该供应商
  cleanupStaleDeletedIds();
  recentlyDeletedProviderIds.add(providerId);
  recentlyDeletedTimestamps.set(providerId, Date.now());

  deps.onSave({
    ...current,
    providers: nextProviders
  });
  deps.postState(deps.getStrings().providerDeleted, 'success');
}

async function handleDeleteMcpServer(
  message: Extract<SettingsCenterMessage, { type: 'deleteMcpServer' }>,
  deps: SettingsMessageHandlerDeps
): Promise<void> {
  const serverId = message.payload.serverId.trim();
  const serverName = message.payload.serverName.trim();
  const strings = deps.getStrings();
  if (!serverId) {
    deps.postState(strings.mcpServerIdRequired || 'Server ID is required', 'error');
    return;
  }

  // 前端 webview 已确认时跳过 VS Code 原生对话框（A 类：webview 内触发）
  if (!message.payload.skipConfirm) {
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
  }

  const current = deps.repository.getSettings();
  const nextServers = current.mcp.servers.filter((item) => item.id !== serverId);
  if (nextServers.length === current.mcp.servers.length) {
    deps.postState();
    return;
  }

  // 追踪已删除的 MCP server ID，防止 reload 合并时从磁盘复活
  cleanupStaleDeletedIds();
  recentlyDeletedMcpServerIds.add(serverId);
  recentlyDeletedMcpServerTimestamps.set(serverId, Date.now());

  deps.onSave({
    ...current,
    mcp: {
      ...current.mcp,
      servers: nextServers
    }
  });
  deps.postState(strings.mcpServerDeleted || 'MCP server deleted', 'success');
}

async function handleTestConnection(
  message: Extract<SettingsCenterMessage, { type: 'testConnection' }>,
  deps: SettingsMessageHandlerDeps
): Promise<void> {
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
}

async function handleFetchModels(
  message: Extract<SettingsCenterMessage, { type: 'fetchModels' }>,
  deps: SettingsMessageHandlerDeps
): Promise<void> {
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
}

async function handleDeleteTemplate(
  message: Extract<SettingsCenterMessage, { type: 'deleteTemplate' }>,
  deps: SettingsMessageHandlerDeps
): Promise<void> {
  const strings = deps.getStrings();
  // 前端 webview 已确认时跳过 VS Code 原生对话框（A 类：webview 内触发）
  if (!message.skipConfirm) {
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
  }
  deps.repository.deleteTemplate(message.templateId);
  deps.postState();
}

async function handleRenameTemplate(
  message: Extract<SettingsCenterMessage, { type: 'renameTemplate' }>,
  deps: SettingsMessageHandlerDeps
): Promise<void> {
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
}

async function handleBrowseBackupDir(deps: SettingsMessageHandlerDeps): Promise<void> {
  const result = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title: deps.getStrings().backupDirBrowseTitle
  });
  if (result?.[0]) {
    deps.postMessage({ type: 'backupDirSelected', payload: { dir: result[0].fsPath } });
  }
}

async function handleTriggerLocalBackup(deps: SettingsMessageHandlerDeps): Promise<void> {
  try {
    const settings = deps.repository.getSettings().localBackup;
    if (!settings.directory) {
      deps.postMessage({ type: 'backupOperationResult', payload: { success: false, message: deps.getStrings().backupDirNotSet } });
      return;
    }
    await createLocalBackup(deps.repository, settings.directory);
    await cleanExpiredBackups(settings.directory, settings.maxCount, settings.maxAgeDays);
    const items = await listLocalBackups(settings.directory);
    deps.postMessage({ type: 'backupList', payload: { items } });
    deps.postMessage({ type: 'backupOperationResult', payload: { success: true, message: deps.getStrings().backupCreated } });
  } catch (err) {
    deps.postMessage({ type: 'backupOperationResult', payload: { success: false, message: toErrorMessage(err, deps.getStrings().unknownError) } });
  }
}

async function handleRestoreLocalBackup(
  message: Extract<SettingsCenterMessage, { type: 'restoreLocalBackup' }>,
  deps: SettingsMessageHandlerDeps
): Promise<void> {
  try {
    const settings = deps.repository.getSettings().localBackup;
    const fileName = message.payload.fileName;
    await restoreLocalBackup(deps.repository, settings.directory, fileName);
    deps.postMessage({ type: 'backupOperationResult', payload: { success: true, message: deps.getStrings().backupRestored } });
    deps.postState(deps.getStrings().backupRestored, 'success');
  } catch (err) {
    deps.postMessage({ type: 'backupOperationResult', payload: { success: false, message: toErrorMessage(err, deps.getStrings().unknownError) } });
  }
}

async function handleDeleteLocalBackup(
  message: Extract<SettingsCenterMessage, { type: 'deleteLocalBackup' }>,
  deps: SettingsMessageHandlerDeps
): Promise<void> {
  try {
    const settings = deps.repository.getSettings().localBackup;
    await deleteLocalBackup(settings.directory, message.payload.fileName);
    const items = await listLocalBackups(settings.directory);
    deps.postMessage({ type: 'backupList', payload: { items } });
    deps.postMessage({ type: 'backupOperationResult', payload: { success: true, message: deps.getStrings().backupDeleted } });
  } catch (err) {
    deps.postMessage({ type: 'backupOperationResult', payload: { success: false, message: toErrorMessage(err, deps.getStrings().unknownError) } });
  }
}

async function handleRefreshBackupList(deps: SettingsMessageHandlerDeps): Promise<void> {
  try {
    const settings = deps.repository.getSettings().localBackup;
    const items = settings.directory ? await listLocalBackups(settings.directory) : [];
    deps.postMessage({ type: 'backupList', payload: { items } });
  } catch (err) {
    warn('Error refreshing backup list:', err);
    deps.postMessage({ type: 'backupList', payload: { items: [] } });
  }
}
