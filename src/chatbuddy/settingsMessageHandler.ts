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
import { migrateStorage, validateStorageData } from './syncMigration';
import { ensureStorageDir, getSharedStoragePath, hasCompassData, type StorageMode } from './syncConfig';
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
  readonly onReset: () => Promise<boolean> | boolean;
  readonly onExportData: () => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined;
  readonly onImportData: () => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined;
  readonly onImportLegacyData: () => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined;
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
    const timeoutMs = message.payload.timeoutMs === 0 ? 0 : Math.max(5000, Math.min(300000, message.payload.timeoutMs || 300000));
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
    void deps.probeAllMcpServers().catch((err) => { warn('[Settings] MCP probe failed:', err); });
    return;
  }

  if (message.type === 'testMcpServer') {
    void deps.probeSingleMcpServer(message.payload.server).catch((err) => { warn('[Settings] MCP server probe failed:', err); });
    return;
  }

  if (message.type === 'saveProvider') {
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

    // webview 已确认时跳过 VS Code 原生对话框，避免关闭面板导致对话框被取消
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

    // 追踪已删除的 MCP server ID，防止 reload 合并时从磁盘复活
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
    deps.onSave({ ...current, localBackup: { ...message.payload } });
    deps.onBackupSettingsChanged?.();
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
      await createLocalBackup(deps.repository, settings.directory);
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
      await restoreLocalBackup(deps.repository, settings.directory, fileName);
      deps.postMessage({ type: 'backupOperationResult', payload: { success: true, message: deps.getStrings().backupRestored } });
      deps.postState(deps.getStrings().backupRestored, 'success');
    } catch (err) {
      deps.postMessage({ type: 'backupOperationResult', payload: { success: false, message: toErrorMessage(err, deps.getStrings().unknownError) } });
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

  if (message.type === 'switchStorageMode') {
    const strings = deps.getStrings();
    const mode = message.payload.mode as StorageMode;
    const syncConfig = deps.repository.getSyncConfig();

    // Same mode, nothing to do
    if (syncConfig.storageMode === mode) {
      return;
    }

    // Determine target path
    const targetPath = mode === 'shared'
      ? getSharedStoragePath()
      : deps.repository.getDefaultStoragePath();

    try {
      // Check if target has existing data
      const hasData = await hasCompassData(targetPath);
      if (hasData) {
        // Target has data — just save config, will use existing data after restart
        await deps.repository.updateSyncConfig({ storageMode: mode });
        deps.postMessage({
          type: 'storageSwitchResult',
          payload: { success: true, restartNeeded: true }
        });
        deps.postState(strings.dataStorageStatusRestart || 'Configuration saved. Restart IDE to apply.', 'success');
      } else {
        // No data at target — prompt user for migration
        deps.postMessage({
          type: 'storageMigrationPrompt',
          payload: { targetMode: mode }
        });
      }
    } catch (err) {
      deps.postMessage({
        type: 'storageSwitchResult',
        payload: { success: false, reason: toErrorMessage(err, strings.unknownError), restartNeeded: false }
      });
    }
    return;
  }

  if (message.type === 'confirmStorageMigration') {
    const strings = deps.getStrings();
    const payload = message.payload as { mode: StorageMode; migrate: boolean };
    if (typeof payload.mode !== 'string' || typeof payload.migrate !== 'boolean') { return; }
    const { mode, migrate } = payload;

    // Determine source and target paths
    const currentPath = deps.repository.getStorageRootPath();
    const targetPath = mode === 'shared'
      ? getSharedStoragePath()
      : deps.repository.getDefaultStoragePath();

    if (!currentPath) {
      deps.postState(strings.dataStorageMigrateFailed || 'Migration failed: no current storage path.', 'error');
      return;
    }

    try {
      if (migrate) {
        // Ensure target directory exists
        const ensureResult = await ensureStorageDir(targetPath);
        if (!ensureResult.ok) {
          deps.postMessage({
            type: 'storageSwitchResult',
            payload: { success: false, reason: ensureResult.reason || 'Cannot create directory', restartNeeded: false }
          });
          return;
        }

        // Run migration (source → target) with progress
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: strings.dataStorageMigrating || 'Migrating data...',
            cancellable: false
          },
          async (progress) => {
            return migrateStorage(currentPath, targetPath, (p) => {
              progress.report({
                message: `${p.filesCopied} files copied`,
                increment: undefined
              });
            });
          }
        );

        if (!result.success) {
          deps.postMessage({
            type: 'storageSwitchResult',
            payload: { success: false, reason: result.reason, restartNeeded: false }
          });
          return;
        }

        // 验证迁移后的数据完整性
        const validation = await validateStorageData(targetPath);

        await deps.repository.updateSyncConfig({ storageMode: mode });
        deps.postMessage({
          type: 'storageSwitchResult',
          payload: { success: true, filesCopied: result.filesCopied, restartNeeded: true }
        });

        const baseMsg = strings.dataStorageMigrateSuccess || 'Data migrated. Restart IDE to apply.';
        const filesMsg = result.filesCopied ? ` (${result.filesCopied} files)` : '';
        const validateMsg = validation.valid
          ? ''
          : ` ${strings.dataStorageValidationWarning || '(validation warning)'}: ${validation.reason}`;
        deps.postState(baseMsg + filesMsg + validateMsg, validation.valid ? 'success' : 'info');
      } else {
        // No migration — just save config, target will be initialized on next startup
        const ensureResult = await ensureStorageDir(targetPath);
        if (!ensureResult.ok) {
          deps.postMessage({
            type: 'storageSwitchResult',
            payload: { success: false, reason: ensureResult.reason || 'Cannot create directory', restartNeeded: false }
          });
          return;
        }

        await deps.repository.updateSyncConfig({ storageMode: mode });
        deps.postMessage({
          type: 'storageSwitchResult',
          payload: { success: true, restartNeeded: true }
        });
        deps.postState(strings.dataStorageNoMigrateSuccess || 'Configuration saved. New location will be initialized on restart.', 'success');
      }
    } catch (err) {
      deps.postMessage({
        type: 'storageSwitchResult',
        payload: { success: false, reason: toErrorMessage(err, strings.unknownError), restartNeeded: false }
      });
    }
    return;
  }
}
