/**
 * ChatBuddy 单一状态源（Single Source of Truth）。
 *
 * `ChatStateRepository` 管理整个扩展的运行时状态（`PersistedStateLite`），
 * 通过内部服务拆分（AssistantStateService、SessionStateService、StatePersistenceService）
 * 管理不同领域的数据操作。
 *
 * 状态读取带版本缓存，避免不必要的深拷贝。
 * 所有变更通过 `bump()` 递增版本号触发刷新。
 */
import * as vscode from 'vscode';

import { COMPASS_LAYOUT_VERSION, persistedStateLiteToStructuredStateDocument, structuredStateDocumentToPersistedStateLite } from './compassStorage';
import { cloneDefaultModels, getProviderModelOptions, resolveModelOption } from './modelCatalog';
import {
  AssistantGroup,
  AssistantProfile,
  AssistantTemplate,
  ChatBuddyLocaleSetting,
  ChatBuddySettings,
  ChatMessage,
  ChatSessionDetail,
  ChatSessionSummary,
  ProviderModelOption,
  ProviderProfile
} from './types';
import { ChatStorage } from './chatStorage';
import { cloneAssistant, cloneGroup, cloneMcpServer, cloneMcpSettings, cloneProvider, cloneTemplate } from './stateClone';
import { mergeById } from './stateMerge';
import { unwrapImportedState, unwrapImportedStorageBackup } from './stateHelpers';
import { sanitizeAssistantName } from './security';
import { createInitialState, sanitizeSettings } from './stateSanitizers';
import { AssistantStateService } from './stateRepositoryAssistantService';
import { createId, nowTs } from './utils';
import {
  applyProviderApiKeysToSettings,
  extractProviderApiKeys,
  mergePersistedState,
  normalizeLocalizedDefaultTitles,
  normalizeTitleSourceConsistency
} from './stateRepositoryImportExport';
import { StatePersistenceService } from './stateRepositoryPersistenceService';
import { SessionStateService } from './stateRepositorySessionService';
import { readSyncConfig, resolveStoragePath, ensureStorageDir, writeSyncConfig, type SyncConfig } from './syncConfig.js';

const BACKUP_SCHEMA = 'chatbuddy.backup.compass';
const BACKUP_VERSION = 2;
const DEFAULT_ASSISTANT_SYSTEM_PROMPT = '';

// globalState keys for per-IDE UI state (not shared across IDE instances)
const GS_SELECTED_ASSISTANT = 'chatbuddy.ui.selectedAssistantId';
const GS_SELECTED_SESSION_IDS = 'chatbuddy.ui.selectedSessionIds';
const GS_COLLAPSED_GROUPS = 'chatbuddy.ui.collapsedGroups';
const GS_SESSION_PANEL_COLLAPSED = 'chatbuddy.ui.sessionPanelCollapsed';

export interface ChatBuddyBackupStorageData {
  layout: 'compass';
  layoutVersion: typeof COMPASS_LAYOUT_VERSION;
  structuredState: import('./compassStorage').StructuredStateDocument;
  providerApiKeys: Record<string, string>;
  sessions: import('./types').PersistedState['sessions'];
  kv: Record<string, string>;
}

export interface ChatBuddyBackupData {
  schema: typeof BACKUP_SCHEMA;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  storage: ChatBuddyBackupStorageData;
}

export interface CreateAssistantInput {
  name: string;
  note?: string;
  groupId?: string;
}

export interface UpdateAssistantInput {
  name?: string;
  note?: string;
  groupId?: string;
  greeting?: string;
  systemPrompt?: string;
  questionPrefix?: string;
  modelRef?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  topK?: number;
  contextCount?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  streaming?: boolean;
  avatar?: string;
  enabledMcpServerIds?: string[];
  overrides?: AssistantProfile['overrides'];
  stopSequences?: string[];
  seed?: number;
  responseFormat?: AssistantProfile['responseFormat'];
  toolChoice?: AssistantProfile['toolChoice'];
  geminiSafetyLevel?: AssistantProfile['geminiSafetyLevel'];
  failoverModelRefs?: string[];
}

export class ChatStateRepository {
  private state: import('./types').PersistedStateLite;
  private readonly storage = new ChatStorage();
  private providerApiKeys: Record<string, string> = {};
  private storageReady = false;
  private version = 0;
  private cachedState: import('./types').PersistedStateLite | undefined;
  private cachedStateVersion = -1;
  private readonly assistantStateService = new AssistantStateService({
    getState: () => this.state,
    setState: (state) => {
      this.state = state;
    },
    storage: this.storage,
    storageReady: () => this.storageReady,
    persistLater: () => {
      this.schedulePersist();
    },
    isWritableGroup: (groupId) => this.isWritableGroup(groupId),
    defaultAssistantSystemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT,
    getSelectedAssistantId: () => this.getUiSelectedAssistantId(),
    setSelectedAssistantId: (id) => this.setUiSelectedAssistantId(id),
    getSelectedSessionIds: () => this.getUiSelectedSessionIds(),
    setSelectedSessionIds: (ids) => this.setUiSelectedSessionIds(ids)
  });
  private readonly sessionStateService = new SessionStateService({
    getState: () => this.state,
    storage: this.storage,
    storageReady: () => this.storageReady,
    persistLater: () => {
      this.schedulePersist();
    },
    ensureStorageReady: () => this.ensureStorageReady(),
    getSelectedAssistantId: () => this.getSelectedAssistantId(),
    markAssistantInteracted: (assistantId, persist) => this.assistantStateService.markAssistantInteracted(assistantId, persist),
    getSelectedSessionIds: () => this.getUiSelectedSessionIds(),
    setSelectedSessionIds: (ids) => this.setUiSelectedSessionIds(ids),
    getSessionPanelCollapsed: () => this.getUiSessionPanelCollapsed(),
    setSessionPanelCollapsed: (collapsed) => this.setUiSessionPanelCollapsed(collapsed)
  });
  private readonly persistenceService = new StatePersistenceService({
    storage: this.storage,
    storageReady: () => this.storageReady,
    getState: () => this.state,
    setState: (state) => {
      this.state = state;
    },
    getProviderApiKeys: () => this.providerApiKeys,
    setProviderApiKeys: (providerApiKeys) => {
      this.providerApiKeys = providerApiKeys;
    },
    bumpVersion: () => this.bump(),
    getGlobalState: () => this.context.globalState
  });

  /**
   * reload 时合并 settings：disk 优先，加载其他 IDE 的更新。
   * 保留本地独有的 providers/mcp servers（防止新生成未 persist 的数据丢失）。
   */
  private mergeSettingsForReload(memory: ChatBuddySettings, disk: ChatBuddySettings): ChatBuddySettings {
    // providers: disk 优先，保留本地独有的
    const diskProviderIds = new Set(disk.providers.map((p) => p.id));
    const mergedProviders = [
      ...disk.providers,
      ...memory.providers.filter((p) => !diskProviderIds.has(p.id))
    ];

    // mcp.servers: disk 优先，保留本地独有的
    const diskMcpIds = new Set(disk.mcp.servers.map((s) => s.id));
    const mergedMcpServers = [
      ...disk.mcp.servers,
      ...memory.mcp.servers.filter((s) => !diskMcpIds.has(s.id))
    ];

    // defaultModels: disk 优先
    const mergedDefaultModels = disk.defaultModels.assistant
      ? disk.defaultModels
      : memory.defaultModels;

    // scalar 字段：disk 优先（加载其他 IDE 的更新）
    return {
      providers: mergedProviders,
      defaultModels: mergedDefaultModels,
      mcp: { ...disk.mcp, servers: mergedMcpServers },
      temperature: disk.temperature !== undefined ? disk.temperature : memory.temperature,
      topP: disk.topP !== undefined ? disk.topP : memory.topP,
      maxTokens: disk.maxTokens !== undefined ? disk.maxTokens : memory.maxTokens,
      presencePenalty: disk.presencePenalty !== undefined ? disk.presencePenalty : memory.presencePenalty,
      frequencyPenalty: disk.frequencyPenalty !== undefined ? disk.frequencyPenalty : memory.frequencyPenalty,
      timeoutMs: disk.timeoutMs !== undefined ? disk.timeoutMs : memory.timeoutMs,
      streamingDefault: disk.streamingDefault !== undefined ? disk.streamingDefault : memory.streamingDefault,
      locale: disk.locale !== undefined ? disk.locale : memory.locale,
      sendShortcut: disk.sendShortcut !== undefined ? disk.sendShortcut : memory.sendShortcut,
      chatTabMode: disk.chatTabMode !== undefined ? disk.chatTabMode : memory.chatTabMode,
      localBackup: disk.localBackup !== undefined ? disk.localBackup : memory.localBackup
    };
  }

  private bump(): void {
    this.version++;
  }

  private schedulePersist(): void {
    void this.persistenceService.persist().catch((err) => {
      console.error('[ChatBuddy] persist error:', err);
    });
  }

  constructor(private readonly context: vscode.ExtensionContext) {
    this.state = createInitialState();
  }

  private syncConfig: SyncConfig = { storageMode: 'default' };
  private usingSharedStorage = false;
  private reloadPromise: Promise<void> = Promise.resolve();

  // ─── Per-IDE UI state (globalState) helpers ───────────────────────────────

  private readGlobalState<T>(key: string, fallback: T): T {
    const value = this.context.globalState.get<T>(key);
    return value !== undefined && value !== null ? value : fallback;
  }

  private writeGlobalState<T>(key: string, value: T): void {
    void this.context.globalState.update(key, value);
  }

  /** Migrate UI fields from Compass state to globalState on first startup */
  private migrateUiStateFromCompass(): void {
    // Only migrate if globalState doesn't have these keys yet
    const hasMigrated = this.context.globalState.get<boolean>('chatbuddy.ui.migrated');
    if (hasMigrated) { return; }

    // Migrate from Compass state (this.state) to globalState
    if (this.state.selectedAssistantId) {
      this.writeGlobalState(GS_SELECTED_ASSISTANT, this.state.selectedAssistantId);
    }
    if (Object.keys(this.state.selectedSessionIdByAssistant).length > 0) {
      this.writeGlobalState(GS_SELECTED_SESSION_IDS, { ...this.state.selectedSessionIdByAssistant });
    }
    if (this.state.collapsedGroupIds.length > 0) {
      this.writeGlobalState(GS_COLLAPSED_GROUPS, [...this.state.collapsedGroupIds]);
    }
    this.writeGlobalState(GS_SESSION_PANEL_COLLAPSED, this.state.sessionPanelCollapsed);
    this.writeGlobalState('chatbuddy.ui.migrated', true);
  }

  private getUiSelectedAssistantId(): string | undefined {
    return this.readGlobalState<string | undefined>(GS_SELECTED_ASSISTANT, undefined)
      ?? this.state.selectedAssistantId;
  }

  private setUiSelectedAssistantId(id: string | undefined): void {
    this.writeGlobalState(GS_SELECTED_ASSISTANT, id);
    this.state.selectedAssistantId = id;
  }

  private getUiSelectedSessionIds(): Record<string, string> {
    return this.readGlobalState<Record<string, string>>(GS_SELECTED_SESSION_IDS, {});
  }

  private setUiSelectedSessionIds(ids: Record<string, string>): void {
    this.writeGlobalState(GS_SELECTED_SESSION_IDS, { ...ids });
    this.state.selectedSessionIdByAssistant = { ...ids };
  }

  private getUiCollapsedGroupIds(): string[] {
    return this.readGlobalState<string[]>(GS_COLLAPSED_GROUPS, []);
  }

  private setUiCollapsedGroupIds(ids: string[]): void {
    this.writeGlobalState(GS_COLLAPSED_GROUPS, [...ids]);
    this.state.collapsedGroupIds = [...ids];
  }

  private getUiSessionPanelCollapsed(): boolean {
    return this.readGlobalState<boolean>(GS_SESSION_PANEL_COLLAPSED, false);
  }

  private setUiSessionPanelCollapsed(collapsed: boolean): void {
    this.writeGlobalState(GS_SESSION_PANEL_COLLAPSED, collapsed);
    this.state.sessionPanelCollapsed = collapsed;
  }

  public getSyncConfig(): SyncConfig {
    return { ...this.syncConfig };
  }

  /** 将 SyncWatcher 传递给底层 storage，用于写入自写标记 */
  public setSyncWatcher(syncWatcher: import('./syncWatcher').SyncWatcher): void {
    this.storage.setSyncWatcher(syncWatcher);
  }

  public isUsingSharedStorage(): boolean {
    return this.usingSharedStorage;
  }

  /** 获取当前存储根路径（用于 syncWatcher 监听） */
  public getStorageRootPath(): string | undefined {
    return this.storage.getStorageRootPath();
  }

  /** 获取 VS Code 默认的 globalStorage 路径 */
  public getDefaultStoragePath(): string {
    return this.context.globalStorageUri.fsPath;
  }

  public async updateSyncConfig(config: SyncConfig): Promise<void> {
    await writeSyncConfig(this.context.globalState, config);
    this.syncConfig = { ...config };
  }

  public async initialize(): Promise<void> {
    this.syncConfig = readSyncConfig(this.context.globalState);
    const { path: storagePath, usingShared } = resolveStoragePath(
      this.syncConfig,
      this.context.globalStorageUri.fsPath
    );

    if (usingShared) {
      const ensureResult = await ensureStorageDir(storagePath);
      if (!ensureResult.ok) {
        console.warn(`[ChatBuddy] Shared storage unavailable (${ensureResult.reason}), falling back to local`);
        const locale = vscode.env.language?.startsWith('zh') ? 'zh-CN' : 'en';
        const warningMsg = locale === 'zh-CN'
          ? `共享存储目录不可用：${ensureResult.reason}。已回退到本地存储。`
          : `Shared storage directory unavailable: ${ensureResult.reason}. Falling back to local storage.`;
        void vscode.window.showWarningMessage(warningMsg);
        this.syncConfig = { storageMode: 'default' };
        await this.storage.initialize(this.context.globalStorageUri.fsPath);
      } else {
        this.usingSharedStorage = true;
        await this.storage.initialize(storagePath);
      }
    } else {
      this.usingSharedStorage = false;
      await this.storage.initialize(this.context.globalStorageUri.fsPath);
    }

    this.storageReady = true;
    this.persistenceService.hydrateStateFromStorage();
    this.persistenceService.hydrateProviderApiKeysFromStorage();
    this.state.settings = applyProviderApiKeysToSettings(this.providerApiKeys, this.state.settings);
    normalizeLocalizedDefaultTitles(this.storage, this.state.settings.locale);
    normalizeTitleSourceConsistency(this.storage, this.state.settings.locale);

    // Migrate UI state from Compass to globalState (one-time migration)
    this.migrateUiStateFromCompass();

    // 只在首次使用（无数据）时才 persist 初始状态，避免每次启动都重写文件触发其他 IDE 的 watcher
    const isFirstUse = this.state.assistants.length === 0 && !this.storage.hasAnySession();
    if (isFirstUse) {
      await this.persistenceService.persistSecrets();
      await this.persistenceService.persist();
    }
  }

  public async close(): Promise<void> {
    await this.persistenceService.drain();
    await this.storage.close();
  }

  /** 从共享存储重新加载数据（用于跨 IDE 同步刷新） */
  public async reloadFromSharedStorage(
    categories?: ReadonlySet<'core' | 'settings' | 'sessions' | 'images'>
  ): Promise<void> {
    if (!this.storageReady || !this.usingSharedStorage) { return; }

    this.reloadPromise = this.reloadPromise.then(async () => {
      // 等待进行中的持久化完成，避免并发读写导致数据不一致
      await this.persistenceService.drain();

      // 保存加载前的内存状态快照（深拷贝），用于后续合并和变更检测
      // 必须在 hydrateStateFromStorage 之前拷贝，否则引用会被覆盖
      const memoryState = {
        groups: this.state.groups.map(cloneGroup),
        assistants: this.state.assistants.map(cloneAssistant),
        templates: this.state.templates.map(cloneTemplate),
        settings: this.getSettings()
      };

      // 使用已克隆的 memoryState 构建变更前指纹，避免重复序列化 this.state
      const beforeData = JSON.stringify({
        groups: memoryState.groups,
        assistants: memoryState.assistants,
        templates: memoryState.templates,
        settings: memoryState.settings
      });

      if (categories && categories.size > 0) {
        // 增量刷新：只加载变更的类别
        await this.storage.reloadCategories(categories);
      } else {
        // 全量刷新（兼容旧行为）
        await this.storage.reload();
      }
      this.persistenceService.hydrateStateFromStorage();
      this.persistenceService.hydrateProviderApiKeysFromStorage();

      // 将磁盘数据与内存数据按 ID 合并（防止其他 IDE 的修改被覆盖）
      const diskState = this.state;
      const mergedAssistants = mergeById(memoryState.assistants, diskState.assistants);
      const mergedGroups = mergeById(memoryState.groups, diskState.groups);
      const mergedTemplates = mergeById(memoryState.templates, diskState.templates);
      // reload 时使用 memory 优先的合并策略，防止覆盖本地未 persist 的修改
      const mergedSettings = this.mergeSettingsForReload(memoryState.settings, diskState.settings);

      this.state.groups = mergedGroups;
      this.state.assistants = mergedAssistants;
      this.state.templates = mergedTemplates;
      this.state.settings = applyProviderApiKeysToSettings(this.providerApiKeys, mergedSettings);

      // 清理无效的 UI 引用，同时追踪 UI 状态是否变化
      let uiChanged = false;
      const validAssistantIds = new Set(mergedAssistants.map((a) => a.id));
      const currentSelectedId = this.getUiSelectedAssistantId();
      if (currentSelectedId && !validAssistantIds.has(currentSelectedId)) {
        const newSelectedId = mergedAssistants.find((a) => !a.isDeleted)?.id ?? mergedAssistants[0]?.id;
        this.setUiSelectedAssistantId(newSelectedId);
        uiChanged = true;
      }
      // 清理无效的 selectedSessionIdByAssistant 条目（在 globalState 中）
      const currentSessionIds = this.getUiSelectedSessionIds();
      for (const assistantId of Object.keys(currentSessionIds)) {
        if (!validAssistantIds.has(assistantId)) {
          delete currentSessionIds[assistantId];
          uiChanged = true;
        }
      }
      if (uiChanged) {
        this.setUiSelectedSessionIds(currentSessionIds);
      }

      normalizeLocalizedDefaultTitles(this.storage, this.state.settings.locale);
      normalizeTitleSourceConsistency(this.storage, this.state.settings.locale);

      // 轻量级变更检测：仅比较数据字段，UI 变化用布尔标志追踪
      const afterData = JSON.stringify({
        groups: this.state.groups,
        assistants: this.state.assistants,
        templates: this.state.templates,
        settings: this.state.settings
      });

      if (afterData !== beforeData || uiChanged) {
        this.bump();
      }
    });
    await this.reloadPromise;
  }

  public getState(): import('./types').PersistedStateLite {
    if (this.cachedStateVersion === this.version && this.cachedState) {
      return this.cachedState;
    }
    const cloned = {
      ...this.state,
      groups: this.state.groups.map(cloneGroup),
      assistants: this.state.assistants.map(cloneAssistant),
      selectedAssistantId: this.getUiSelectedAssistantId(),
      selectedSessionIdByAssistant: { ...this.getUiSelectedSessionIds() },
      collapsedGroupIds: [...this.getUiCollapsedGroupIds()],
      sessionPanelCollapsed: this.getUiSessionPanelCollapsed(),
      templates: this.state.templates.map(cloneTemplate),
      settings: this.getSettings()
    };
    this.cachedState = cloned;
    this.cachedStateVersion = this.version;
    return cloned;
  }

  public getVersion(): number {
    return this.version;
  }

  public getStateIfNewer(lastVersion: number): import('./types').PersistedStateLite | undefined {
    if (this.version === lastVersion) {
      return undefined;
    }
    return this.getState();
  }

  public getGroups(): AssistantGroup[] {
    return this.sortGroups(this.state.groups).map(cloneGroup);
  }

  public getAssistants(): AssistantProfile[] {
    return this.state.assistants.map(cloneAssistant);
  }

  public getSettings(): ChatBuddySettings {
    return {
      ...this.state.settings,
      providers: this.state.settings.providers.map(cloneProvider),
      defaultModels: cloneDefaultModels(this.state.settings.defaultModels),
      mcp: cloneMcpSettings(this.state.settings.mcp)
    };
  }

  public getLocaleSetting(): ChatBuddyLocaleSetting {
    return this.state.settings.locale;
  }

  public getModelOptions(includeDisabled = false, strings?: Record<string, string>): ProviderModelOption[] {
    return getProviderModelOptions(this.state.settings.providers, includeDisabled, strings);
  }

  public resolveModelOption(modelRef: string | undefined): ProviderModelOption | undefined {
    return resolveModelOption(this.state.settings.providers, modelRef);
  }

  public updateSettings(settings: ChatBuddySettings): void {
    const normalized = sanitizeSettings(settings);
    this.providerApiKeys = extractProviderApiKeys(normalized.providers);
    this.state.settings = applyProviderApiKeysToSettings(this.providerApiKeys, normalized);
    const validMcpServerIds = new Set(normalized.mcp.servers.map((server) => server.id));
    this.state.assistants = this.state.assistants.map((assistant) => ({
      ...cloneAssistant(assistant),
      enabledMcpServerIds: assistant.enabledMcpServerIds.filter((serverId) => validMcpServerIds.has(serverId))
    }));
    normalizeLocalizedDefaultTitles(this.storage, normalized.locale);
    void this.persistenceService.persistSecrets().catch((err) => {
      console.error('[ChatBuddy] persistSecrets error:', err);
    });
    this.schedulePersist();
  }

  public getMcpServers(): import('./types').McpServerProfile[] {
    return this.state.settings.mcp.servers.map(cloneMcpServer);
  }

  // ─── Template methods ─────────────────────────────────────────────────────

  public getTemplates(): AssistantTemplate[] {
    return this.state.templates.map(cloneTemplate);
  }

  public saveAsTemplate(assistantId: string, name: string, description?: string): AssistantTemplate | undefined {
    const assistant = this.state.assistants.find((a) => a.id === assistantId);
    if (!assistant) {
      return undefined;
    }
    const timestamp = nowTs();
    const sanitizedName = sanitizeAssistantName(name) || 'Untitled Template';
    const template: AssistantTemplate = {
      id: createId('tpl'),
      name: sanitizedName,
      description: description ? sanitizeAssistantName(description) : undefined,
      avatar: assistant.avatar,
      systemPrompt: assistant.systemPrompt,
      greeting: assistant.greeting,
      questionPrefix: assistant.questionPrefix,
      temperature: assistant.temperature,
      topP: assistant.topP,
      maxTokens: assistant.maxTokens,
      contextCount: assistant.contextCount,
      presencePenalty: assistant.presencePenalty,
      frequencyPenalty: assistant.frequencyPenalty,
      enabledMcpServerIds: [...assistant.enabledMcpServerIds],
      streaming: assistant.streaming,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.state.templates.push(template);
    this.schedulePersist();
    return cloneTemplate(template);
  }

  public createAssistantFromTemplate(templateId: string): AssistantProfile | undefined {
    const template = this.state.templates.find((t) => t.id === templateId);
    if (!template) {
      return undefined;
    }
    const assistant = this.assistantStateService.createAssistant({
      name: template.name,
      note: template.description
    });
    // Apply template configuration
    this.assistantStateService.updateAssistant(assistant.id, {
      avatar: template.avatar,
      systemPrompt: template.systemPrompt,
      greeting: template.greeting,
      questionPrefix: template.questionPrefix,
      temperature: template.temperature,
      topP: template.topP,
      maxTokens: template.maxTokens,
      contextCount: template.contextCount,
      presencePenalty: template.presencePenalty,
      frequencyPenalty: template.frequencyPenalty,
      enabledMcpServerIds: template.enabledMcpServerIds,
      streaming: template.streaming
    });
    const result = this.state.assistants.find((a) => a.id === assistant.id);
    return result ? cloneAssistant(result) : undefined;
  }

  public deleteTemplate(templateId: string): boolean {
    const index = this.state.templates.findIndex((t) => t.id === templateId);
    if (index === -1) {
      return false;
    }
    this.state.templates.splice(index, 1);
    this.schedulePersist();
    return true;
  }

  public renameTemplate(templateId: string, name: string): boolean {
    const template = this.state.templates.find((t) => t.id === templateId);
    if (!template || !name.trim()) {
      return false;
    }
    template.name = sanitizeAssistantName(name) || template.name;
    template.updatedAt = nowTs();
    this.schedulePersist();
    return true;
  }

  public async resetState(): Promise<void> {
    this.state = createInitialState();
    this.providerApiKeys = {};
    if (this.storageReady) {
      this.storage.replaceAllSessions([], false);
      this.storage.replaceAllKv({}, false);
      await this.storage.cleanupAllImages();
      await this.storage.flush();
    }
    await this.persistenceService.persistSecrets();
    await this.persistenceService.persist();
  }

  public getMcpProbeCache(): { lastProbeAt: number; entries: unknown[] } | undefined {
    if (!this.storageReady) { return undefined; }
    const raw = this.storage.getKv('mcp.probeCache');
    if (!raw) { return undefined; }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entries) && typeof parsed.lastProbeAt === 'number') {
        return parsed;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  public setMcpProbeCache(cache: { lastProbeAt: number; entries: unknown[] }): void {
    if (!this.storageReady) { return; }
    this.storage.setKv('mcp.probeCache', JSON.stringify(cache));
  }

  public exportSelectiveData(categories: string[]): Record<string, unknown> {
    const state = this.getState();
    const result: Record<string, unknown> = {
      schema: 'chatbuddy-selective-export',
      version: 1,
      exportedAt: new Date().toISOString()
    };
    const settings = state.settings;
    if (categories.includes('providers')) {
      result.providers = settings.providers.map((p) => ({ ...cloneProvider(p) }));
      result.providerApiKeys = { ...this.providerApiKeys };
    }
    if (categories.includes('mcp')) {
      result.mcp = { ...settings.mcp };
    }
    if (categories.includes('assistants')) {
      result.assistants = state.assistants.map((a) => ({ ...a }));
      result.groups = state.groups.map((g) => ({ ...g }));
      result.templates = state.templates?.map((t) => ({ ...t })) ?? [];
    }
    if (categories.includes('settings')) {
      const { providers: _p, mcp: _m, ...rest } = settings;
      result.settings = rest;
    }
    return result;
  }

  public exportBackupData(): ChatBuddyBackupData {
    const state = this.getState();
    return {
      schema: BACKUP_SCHEMA,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      storage: {
        layout: 'compass',
        layoutVersion: COMPASS_LAYOUT_VERSION,
        structuredState: persistedStateLiteToStructuredStateDocument(state),
        providerApiKeys: { ...this.providerApiKeys },
        sessions: this.storageReady ? this.storage.listAllSessions() : [],
        kv: this.storageReady ? this.storage.listAllKv() : {}
      }
    };
  }

  public async importBackupData(input: unknown): Promise<void> {
    const storageBackup = unwrapImportedStorageBackup(input);
    const legacyState = storageBackup ? undefined : unwrapImportedState(input);
    if (!storageBackup && !legacyState) {
      throw new Error('Invalid import payload');
    }
    const merged = storageBackup
      ? this.mergeState({
          ...structuredStateDocumentToPersistedStateLite(storageBackup.structuredState),
          sessions: storageBackup.sessions
        })
      : this.mergeState(legacyState);
    this.state = merged.state;
    this.providerApiKeys = storageBackup
      ? storageBackup.providerApiKeys
      : extractProviderApiKeys(this.state.settings.providers);
    this.state.settings = applyProviderApiKeysToSettings(this.providerApiKeys, this.state.settings);
    this.ensureStorageReady();
    this.storage.replaceAllSessions(merged.sessions, false);
    this.storage.replaceAllKv(storageBackup?.kv ?? {}, false);
    normalizeLocalizedDefaultTitles(this.storage, this.state.settings.locale);
    normalizeTitleSourceConsistency(this.storage, this.state.settings.locale);
    await this.persistenceService.persistSecrets();
    await this.persistenceService.persist();
  }

  public getProviderById(providerId: string): ProviderProfile | undefined {
    const provider = this.state.settings.providers.find((item) => item.id === providerId);
    return provider ? cloneProvider(provider) : undefined;
  }

  public getSelectedAssistant(): AssistantProfile | undefined {
    if (!this.state.assistants.length) {
      return undefined;
    }
    const selectedId = this.getUiSelectedAssistantId();
    if (selectedId) {
      const selected = this.state.assistants.find((assistant) => assistant.id === selectedId);
      if (selected) {
        return cloneAssistant(selected);
      }
    }
    const fallback = this.state.assistants.find((assistant) => !assistant.isDeleted) ?? this.state.assistants[0];
    return fallback ? cloneAssistant(fallback) : undefined;
  }

  public getSelectedAssistantId(): string | undefined {
    if (!this.state.assistants.length) {
      return undefined;
    }
    const selectedId = this.getUiSelectedAssistantId();
    if (selectedId && this.state.assistants.some((assistant) => assistant.id === selectedId)) {
      return selectedId;
    }
    return (this.state.assistants.find((assistant) => !assistant.isDeleted) ?? this.state.assistants[0])?.id;
  }

  public getAssistantById(assistantId: string): AssistantProfile | undefined {
    const assistant = this.state.assistants.find((item) => item.id === assistantId);
    return assistant ? cloneAssistant(assistant) : undefined;
  }

  public setSelectedAssistant(assistantId: string): void {
    this.assistantStateService.setSelectedAssistant(assistantId);
  }

  public createGroup(name: string): AssistantGroup | undefined {
    return this.assistantStateService.createGroup(name);
  }

  public renameGroup(groupId: string, name: string): boolean {
    return this.assistantStateService.renameGroup(groupId, name);
  }

  public deleteGroup(groupId: string): boolean {
    return this.assistantStateService.deleteGroup(groupId);
  }

  public createAssistant(input: CreateAssistantInput): AssistantProfile {
    return this.assistantStateService.createAssistant(input);
  }

  public updateAssistant(assistantId: string, patch: UpdateAssistantInput): AssistantProfile | undefined {
    return this.assistantStateService.updateAssistant(assistantId, patch);
  }

  public toggleAssistantPinned(assistantId: string): AssistantProfile | undefined {
    return this.assistantStateService.toggleAssistantPinned(assistantId);
  }

  public softDeleteAssistant(assistantId: string): AssistantProfile | undefined {
    return this.assistantStateService.softDeleteAssistant(assistantId);
  }

  public restoreAssistant(assistantId: string): AssistantProfile | undefined {
    return this.assistantStateService.restoreAssistant(assistantId);
  }

  public async hardDeleteAssistant(assistantId: string): Promise<boolean> {
    return this.assistantStateService.hardDeleteAssistant(assistantId);
  }

  public async hardDeleteDeletedAssistants(): Promise<number> {
    return this.assistantStateService.hardDeleteDeletedAssistants();
  }

  public setAssistantStreaming(assistantId: string, enabled: boolean): void {
    this.assistantStateService.setAssistantStreaming(assistantId, enabled);
  }

  public markAssistantInteracted(assistantId: string, persist = true): void {
    this.assistantStateService.markAssistantInteracted(assistantId, persist);
  }

  public getSessionsForAssistant(assistantId: string): ChatSessionSummary[] {
    return this.sessionStateService.getSessionsForAssistant(assistantId);
  }

  public searchSessionContent(assistantId: string, keyword: string): string[] {
    if (!this.storageReady) {
      return [];
    }
    return this.storage.searchSessionIdsByContent(assistantId, keyword);
  }

  public getSelectedSession(assistantId?: string): ChatSessionDetail | undefined {
    return this.sessionStateService.getSelectedSession(assistantId);
  }

  public getSelectedSessionId(assistantId?: string): string | undefined {
    return this.sessionStateService.getSelectedSessionId(assistantId);
  }

  public getSessionById(sessionId: string): ChatSessionDetail | undefined {
    return this.sessionStateService.getSessionById(sessionId);
  }

  public createSession(assistantId: string, title: string): ChatSessionDetail {
    return this.sessionStateService.createSession(assistantId, title);
  }

  public selectSession(assistantId: string, sessionId: string): void {
    this.sessionStateService.selectSession(assistantId, sessionId);
  }

  public renameSession(assistantId: string, sessionId: string, title: string): void {
    this.sessionStateService.renameSession(assistantId, sessionId, title);
  }

  public generateSessionTitle(assistantId: string, sessionId: string, title: string): void {
    this.sessionStateService.generateSessionTitle(assistantId, sessionId, title);
  }

  public async deleteSession(assistantId: string, sessionId: string): Promise<void> {
    await this.sessionStateService.deleteSession(assistantId, sessionId);
  }

  public async clearSessionsForAssistant(assistantId: string): Promise<number> {
    return await this.sessionStateService.clearSessionsForAssistant(assistantId);
  }

  public appendMessage(assistantId: string, sessionId: string, message: ChatMessage): ChatSessionDetail {
    return this.sessionStateService.appendMessage(assistantId, sessionId, message);
  }

  public updateLastAssistantMessage(
    assistantId: string,
    sessionId: string,
    updater: (current: ChatMessage | undefined) => ChatMessage,
    persist = true
  ): ChatSessionDetail {
    return this.sessionStateService.updateLastAssistantMessage(assistantId, sessionId, updater, persist);
  }

  public truncateSessionMessages(assistantId: string, sessionId: string, keepCount: number): ChatSessionDetail | undefined {
    return this.sessionStateService.truncateSessionMessages(assistantId, sessionId, keepCount);
  }

  public deleteMessage(assistantId: string, sessionId: string, messageId: string): ChatSessionDetail | undefined {
    return this.sessionStateService.deleteMessage(assistantId, sessionId, messageId);
  }

  public editMessage(assistantId: string, sessionId: string, messageId: string, newContent: string): ChatSessionDetail | undefined {
    return this.sessionStateService.editMessage(assistantId, sessionId, messageId, newContent);
  }

  public editMessageAndTruncateAfter(assistantId: string, sessionId: string, messageId: string, newContent: string): ChatSessionDetail | undefined {
    return this.sessionStateService.editMessageAndTruncateAfter(assistantId, sessionId, messageId, newContent);
  }

  public clearSessionMessages(assistantId: string, sessionId: string): ChatSessionDetail | undefined {
    return this.sessionStateService.clearSessionMessages(assistantId, sessionId);
  }

  public setSessionPanelCollapsed(collapsed: boolean): void {
    this.sessionStateService.setSessionPanelCollapsed(collapsed);
  }

  public setGroupCollapsed(groupId: string, collapsed: boolean): void {
    const ids = this.getUiCollapsedGroupIds();
    const index = ids.indexOf(groupId);
    if (collapsed) {
      if (index < 0) {
        ids.push(groupId);
        this.setUiCollapsedGroupIds(ids);
        this.bump();
      }
    } else if (index >= 0) {
      ids.splice(index, 1);
      this.setUiCollapsedGroupIds(ids);
      this.bump();
    }
  }

  private mergeState(
    saved: import('./types').PersistedState | import('./types').PersistedStateLite | Record<string, unknown> | undefined
  ): { state: import('./types').PersistedStateLite; sessions: ChatSessionDetail[] } {
    return mergePersistedState(saved);
  }

  private sortGroups(groups: AssistantGroup[]): AssistantGroup[] {
    const byKindWeight: Record<AssistantGroup['kind'], number> = {
      default: 0,
      custom: 1,
      deleted: 2
    };
    return [...groups].sort((a, b) => {
      const byKind = byKindWeight[a.kind] - byKindWeight[b.kind];
      if (byKind !== 0) {
        return byKind;
      }
      if (a.kind === 'custom' && b.kind === 'custom') {
        return a.name.localeCompare(b.name, 'zh-Hans-CN');
      }
      return a.createdAt - b.createdAt;
    });
  }

  private isWritableGroup(groupId: string): boolean {
    const group = this.state.groups.find((item) => item.id === groupId);
    return !!group && group.kind !== 'deleted';
  }

  private ensureStorageReady(): void {
    if (!this.storageReady) {
      throw new Error('Chat storage not initialized');
    }
  }
}
