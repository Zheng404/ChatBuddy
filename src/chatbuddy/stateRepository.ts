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
import { unwrapImportedState, unwrapImportedStorageBackup } from './stateHelpers';
import { sanitizeAssistantName } from './security';
import { createInitialState, sanitizeSettings } from './stateSanitizers';
import { AssistantStateService } from './stateRepositoryAssistantService';
import { createId, nowTs, warn } from './utils';
import {
  applyProviderApiKeysToSettings,
  extractProviderApiKeys,
  mergePersistedState,
  normalizeLocalizedDefaultTitles,
  normalizeTitleSourceConsistency
} from './stateRepositoryImportExport';
import { StatePersistenceService } from './stateRepositoryPersistenceService';
import { SessionStateService } from './stateRepositorySessionService';
import { hasValidCompassState, hasCompassData } from './compassStorage/io';

const BACKUP_SCHEMA = 'chatbuddy.backup.compass';
const BACKUP_VERSION = 2;
const DEFAULT_ASSISTANT_SYSTEM_PROMPT = '';

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

/**
 * ChatBuddy 单一状态源（Single Source of Truth）。
 *
 * 管理整个扩展的运行时状态，包括助手、会话、设置、模板和 MCP 服务器配置。
 * 通过内部服务拆分（AssistantStateService、SessionStateService、StatePersistenceService）
 * 管理不同领域的数据操作。
 *
 * 状态读取带版本缓存，避免不必要的深拷贝。
 * 所有变更通过 `bump()` 递增版本号触发刷新。
 */
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
      this.state.settings = applyProviderApiKeysToSettings(this.providerApiKeys, this.state.settings);
    },
    getProviderApiKeys: () => this.providerApiKeys,
    setProviderApiKeys: (providerApiKeys) => {
      this.providerApiKeys = providerApiKeys;
    },
    bumpVersion: () => this.bump()
  });

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

  // ─── UI state helpers（直接读写 this.state，存入 Compass 文件夹）────────────

  /** 标记 UI 状态迁移为已完成（UI 状态已存入 Compass，无需从 globalState 迁移） */
  private markUiStateMigrationDone(): void {
    const hasMigrated = this.context.globalState.get<boolean>('chatbuddy.ui.migrated');
    if (!hasMigrated) {
      void this.context.globalState.update('chatbuddy.ui.migrated', true);
    }
  }

  private getUiSelectedAssistantId(): string | undefined {
    return this.state.selectedAssistantId;
  }

  private setUiSelectedAssistantId(id: string | undefined): void {
    this.state.selectedAssistantId = id;
  }

  private getUiSelectedSessionIds(): Record<string, string> {
    return this.state.selectedSessionIdByAssistant;
  }

  private setUiSelectedSessionIds(ids: Record<string, string>): void {
    this.state.selectedSessionIdByAssistant = { ...ids };
  }

  private getUiCollapsedGroupIds(): string[] {
    return this.state.collapsedGroupIds;
  }

  private setUiCollapsedGroupIds(ids: string[]): void {
    this.state.collapsedGroupIds = [...ids];
  }

  private getUiSessionPanelCollapsed(): boolean {
    return this.state.sessionPanelCollapsed;
  }

  private setUiSessionPanelCollapsed(collapsed: boolean): void {
    this.state.sessionPanelCollapsed = collapsed;
  }

  /**
   * 初始化状态仓库和底层存储。
   * @returns Promise，初始化完成后 resolve
   */
  public async initialize(): Promise<void> {
    await this.storage.initialize(this.context.globalStorageUri.fsPath);
    this.storageReady = true;
    this.persistenceService.hydrateStateFromStorage();
    this.persistenceService.hydrateProviderApiKeysFromStorage();
    this.state.settings = applyProviderApiKeysToSettings(this.providerApiKeys, this.state.settings);
    normalizeLocalizedDefaultTitles(this.storage, this.state.settings.locale);
    normalizeTitleSourceConsistency(this.storage, this.state.settings.locale);

    this.markUiStateMigrationDone();

    const isFirstUse = this.state.assistants.length === 0 && !this.storage.hasAnySession();
    if (isFirstUse) {
      const storagePath = this.storage.getStorageRootPath();
      if (storagePath) {
        const hasValidState = await hasValidCompassState(storagePath);
        if (hasValidState) {
          console.warn('[ChatBuddy] Memory state is empty but Compass storage has valid data. Skipping initial persist to avoid data loss.');
        } else {
          const hasAnyData = await hasCompassData(storagePath);
          if (hasAnyData) {
            console.warn('[ChatBuddy] Compass directory exists but has no valid state. Skipping initial persist.');
          } else {
            await this.persistenceService.persistSecrets();
            await this.persistenceService.persist();
          }
        }
      } else {
        await this.persistenceService.persistSecrets();
        await this.persistenceService.persist();
      }
    }
  }

  /**
   * 关闭状态仓库，确保所有待写入数据持久化。
   * @returns Promise，关闭完成后 resolve
   */
  public async close(): Promise<void> {
    await this.persistenceService.drain();
    await this.storage.close();
  }

  /**
   * 获取当前完整状态的深拷贝（带版本缓存）。
   * @returns 当前状态的深拷贝对象
   */
  public getState(): import('./types').PersistedStateLite {
    if (this.cachedStateVersion === this.version && this.cachedState) {
      return this.cachedState;
    }
    const { settings: _settings, ...stateRest } = this.state;
    const cloned = {
      ...stateRest,
      groups: this.state.groups.map(cloneGroup),
      assistants: this.state.assistants.map(cloneAssistant),
      selectedAssistantId: this.state.selectedAssistantId,
      selectedSessionIdByAssistant: { ...this.state.selectedSessionIdByAssistant },
      collapsedGroupIds: [...this.state.collapsedGroupIds],
      sessionPanelCollapsed: this.state.sessionPanelCollapsed,
      templates: this.state.templates.map(cloneTemplate),
      settings: this.getSettings()
    };
    this.cachedState = cloned;
    this.cachedStateVersion = this.version;
    return cloned;
  }

  /**
   * 获取当前状态版本号，用于判断状态是否发生变化。
   * @returns 当前版本号
   */
  public getVersion(): number {
    return this.version;
  }

  /**
   * 当版本号比给定值新时返回完整状态，否则返回 undefined。
   * @param lastVersion - 上次已知的版本号
   * @returns 新版本状态，或 undefined（若版本未变化）
   */
  public getStateIfNewer(lastVersion: number): import('./types').PersistedStateLite | undefined {
    if (this.version === lastVersion) {
      return undefined;
    }
    return this.getState();
  }

  /**
   * 获取所有助手分组（按类型排序后的深拷贝）。
   * @returns 助手分组数组
   */
  public getGroups(): AssistantGroup[] {
    return this.sortGroups(this.state.groups).map(cloneGroup);
  }

  /**
   * 获取所有助手配置（深拷贝）。
   * @returns 助手配置数组
   */
  public getAssistants(): AssistantProfile[] {
    return this.state.assistants.map(cloneAssistant);
  }

  /**
   * 获取当前设置（深拷贝，包含 API key 抹除后的提供商列表）。
   * @returns 当前设置对象
   */
  public getSettings(): ChatBuddySettings {
    return {
      ...this.state.settings,
      providers: this.state.settings.providers.map(cloneProvider),
      defaultModels: cloneDefaultModels(this.state.settings.defaultModels),
      mcp: cloneMcpSettings(this.state.settings.mcp)
    };
  }

  /**
   * 获取当前界面语言设置。
   * @returns 语言标识，如 'zh-CN' 或 'en'
   */
  public getLocaleSetting(): ChatBuddyLocaleSetting {
    return this.state.settings.locale;
  }

  /**
   * 获取所有可用模型选项列表。
   * @param includeDisabled - 是否包含已禁用的提供商的模型
   * @param strings - 可选的本地化字符串映射
   * @returns 模型选项数组
   */
  public getModelOptions(includeDisabled = false, strings?: Record<string, string>): ProviderModelOption[] {
    return getProviderModelOptions(this.state.settings.providers, includeDisabled, strings);
  }

  /**
   * 根据 modelRef 解析对应的模型选项。
   * @param modelRef - 模型引用字符串，如 "openai/gpt-4"
   * @returns 模型选项，未找到时返回 undefined
   */
  public resolveModelOption(modelRef: string | undefined): ProviderModelOption | undefined {
    return resolveModelOption(this.state.settings.providers, modelRef);
  }

  /**
   * 更新全局设置，并自动清理无效的 MCP 服务器引用。
   * @param settings - 新的设置对象
   */
  public updateSettings(settings: ChatBuddySettings): void {
    const normalized = sanitizeSettings(settings);
    this.providerApiKeys = extractProviderApiKeys(normalized.providers);
    this.state.settings = applyProviderApiKeysToSettings(this.providerApiKeys, normalized);
    const validMcpServerIds = new Set(normalized.mcp.servers.map((server) => server.id));
    this.state.assistants = this.state.assistants.map((assistant) => ({
      ...cloneAssistant(assistant),
      enabledMcpServerIds: assistant.enabledMcpServerIds.filter((serverId) => validMcpServerIds.has(serverId))
    }));
    this.bump(); // 立即失效缓存，确保后续 getState() 返回最新状态
    normalizeLocalizedDefaultTitles(this.storage, normalized.locale);
    // persist() 已内嵌 API keys 合并，无需单独调用 persistSecrets
    this.schedulePersist();
  }

  /**
   * 获取所有 MCP 服务器配置（深拷贝）。
   * @returns MCP 服务器配置数组
   */
  public getMcpServers(): import('./types').McpServerProfile[] {
    return this.state.settings.mcp.servers.map(cloneMcpServer);
  }

  // ─── Template methods ─────────────────────────────────────────────────────

  /**
   * 获取所有助手模板（深拷贝）。
   * @returns 模板数组
   */
  public getTemplates(): AssistantTemplate[] {
    return this.state.templates.map(cloneTemplate);
  }

  /**
   * 将指定助手保存为模板。
   * @param assistantId - 要保存的助手 ID
   * @param name - 模板名称
   * @param description - 可选的模板描述
   * @returns 新创建的模板，若助手不存在则返回 undefined
   */
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

  /**
   * 从模板创建新助手。
   * @param templateId - 模板 ID
   * @returns 新创建的助手配置，若模板不存在则返回 undefined
   */
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

  /**
   * 删除指定模板。
   * @param templateId - 要删除的模板 ID
   * @returns 是否成功删除
   */
  public deleteTemplate(templateId: string): boolean {
    const index = this.state.templates.findIndex((t) => t.id === templateId);
    if (index === -1) {
      return false;
    }
    this.state.templates.splice(index, 1);
    this.schedulePersist();
    return true;
  }

  /**
   * 重命名指定模板。
   * @param templateId - 模板 ID
   * @param name - 新名称
   * @returns 是否成功重命名
   */
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

  /**
   * 重置所有状态到初始值，并清空所有存储数据。
   * @returns Promise，重置完成后 resolve
   */
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

  /**
   * 获取 MCP 探测缓存数据。
   * @returns 缓存对象（包含 lastProbeAt 和 entries），无缓存时返回 undefined
   */
  public getMcpProbeCache(): { lastProbeAt: number; entries: unknown[] } | undefined {
    if (!this.storageReady) { return undefined; }
    const raw = this.storage.getKv('mcp.probeCache');
    if (!raw) { return undefined; }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entries) && typeof parsed.lastProbeAt === 'number') {
        return parsed;
      }
    } catch (err) {
      warn('Error parsing MCP probe cache:', err);
      return undefined;
    }
    return undefined;
  }

  /**
   * 设置 MCP 探测缓存数据。
   * @param cache - 缓存对象
   */
  public setMcpProbeCache(cache: { lastProbeAt: number; entries: unknown[] }): void {
    if (!this.storageReady) { return; }
    this.storage.setKv('mcp.probeCache', JSON.stringify(cache));
  }

  /**
   * 按类别导出选择性数据（不含会话内容）。
   * @param categories - 要导出的类别数组，如 ['providers', 'assistants', 'settings']
   * @returns 包含所选数据的导出对象
   */
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

  /**
   * 导出完整备份数据（含所有状态、会话和 KV 存储）。
   * @returns 完整备份数据对象
   */
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

  /**
   * 从备份数据导入状态并覆盖当前状态。
   * @param input - 备份数据对象
   * @returns Promise，导入完成后 resolve
   * @throws {Error} 当输入格式无效时抛出
   */
  public async importBackupData(input: unknown): Promise<void> {
    const storageBackup = unwrapImportedStorageBackup(input);
    const legacyState = storageBackup ? undefined : unwrapImportedState(input);
    if (!storageBackup && !legacyState) {
      throw new Error('Invalid import payload');
    }
    this.ensureStorageReady();
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

  /**
   * 根据 ID 获取提供商配置。
   * @param providerId - 提供商 ID
   * @returns 提供商配置，未找到时返回 undefined
   */
  public getProviderById(providerId: string): ProviderProfile | undefined {
    const provider = this.state.settings.providers.find((item) => item.id === providerId);
    return provider ? cloneProvider(provider) : undefined;
  }

  /**
   * 获取当前选中的助手（优先使用 UI 选择，否则回退到第一个可用助手）。
   * @returns 当前选中的助手配置，无助手时返回 undefined
   */
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

  /**
   * 获取当前选中助手的 ID。
   * @returns 选中助手的 ID，无助手时返回 undefined
   */
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

  /**
   * 根据 ID 获取助手配置。
   * @param assistantId - 助手 ID
   * @returns 助手配置，未找到时返回 undefined
   */
  public getAssistantById(assistantId: string): AssistantProfile | undefined {
    const assistant = this.state.assistants.find((item) => item.id === assistantId);
    return assistant ? cloneAssistant(assistant) : undefined;
  }

  /**
   * 设置当前选中的助手。
   * @param assistantId - 要选择的助手 ID
   */
  public setSelectedAssistant(assistantId: string): void {
    this.assistantStateService.setSelectedAssistant(assistantId);
  }

  /**
   * 创建新分组。
   * @param name - 分组名称
   * @returns 新创建的分组，失败时返回 undefined
   */
  public createGroup(name: string): AssistantGroup | undefined {
    return this.assistantStateService.createGroup(name);
  }

  /**
   * 重命名分组。
   * @param groupId - 分组 ID
   * @param name - 新名称
   * @returns 是否成功重命名
   */
  public renameGroup(groupId: string, name: string): boolean {
    return this.assistantStateService.renameGroup(groupId, name);
  }

  /**
   * 删除分组。
   * @param groupId - 分组 ID
   * @returns 是否成功删除
   */
  public deleteGroup(groupId: string): boolean {
    return this.assistantStateService.deleteGroup(groupId);
  }

  /**
   * 创建新助手。
   * @param input - 创建助手所需参数
   * @returns 新创建的助手配置
   */
  public createAssistant(input: CreateAssistantInput): AssistantProfile {
    return this.assistantStateService.createAssistant(input);
  }

  /**
   * 更新助手配置。
   * @param assistantId - 助手 ID
   * @param patch - 要更新的字段
   * @returns 更新后的助手配置，助手不存在时返回 undefined
   */
  public updateAssistant(assistantId: string, patch: UpdateAssistantInput): AssistantProfile | undefined {
    return this.assistantStateService.updateAssistant(assistantId, patch);
  }

  /**
   * 切换助手的置顶状态。
   * @param assistantId - 助手 ID
   * @returns 更新后的助手配置，助手不存在时返回 undefined
   */
  public toggleAssistantPinned(assistantId: string): AssistantProfile | undefined {
    return this.assistantStateService.toggleAssistantPinned(assistantId);
  }

  /**
   * 软删除助手（标记为已删除，可恢复）。
   * @param assistantId - 助手 ID
   * @returns 更新后的助手配置，助手不存在时返回 undefined
   */
  public softDeleteAssistant(assistantId: string): AssistantProfile | undefined {
    return this.assistantStateService.softDeleteAssistant(assistantId);
  }

  /**
   * 恢复已软删除的助手。
   * @param assistantId - 助手 ID
   * @returns 更新后的助手配置，助手不存在时返回 undefined
   */
  public restoreAssistant(assistantId: string): AssistantProfile | undefined {
    return this.assistantStateService.restoreAssistant(assistantId);
  }

  /**
   * 永久删除助手及其所有会话。
   * @param assistantId - 助手 ID
   * @returns 是否成功删除
   */
  public async hardDeleteAssistant(assistantId: string): Promise<boolean> {
    return this.assistantStateService.hardDeleteAssistant(assistantId);
  }

  /**
   * 永久删除所有已软删除的助手。
   * @returns 被删除的助手数量
   */
  public async hardDeleteDeletedAssistants(): Promise<number> {
    return this.assistantStateService.hardDeleteDeletedAssistants();
  }

  /**
   * 设置助手的流式生成开关。
   * @param assistantId - 助手 ID
   * @param enabled - 是否启用流式生成
   */
  public setAssistantStreaming(assistantId: string, enabled: boolean): void {
    this.assistantStateService.setAssistantStreaming(assistantId, enabled);
  }

  /**
   * 标记助手已发生过交互（更新 lastInteractedAt 时间戳）。
   * @param assistantId - 助手 ID
   * @param persist - 是否立即持久化
   */
  public markAssistantInteracted(assistantId: string, persist = true): void {
    this.assistantStateService.markAssistantInteracted(assistantId, persist);
  }

  /**
   * 获取指定助手的所有会话摘要。
   * @param assistantId - 助手 ID
   * @returns 会话摘要数组
   */
  public getSessionsForAssistant(assistantId: string): ChatSessionSummary[] {
    return this.sessionStateService.getSessionsForAssistant(assistantId);
  }

  /**
   * 搜索包含指定关键字的会话 ID。
   * @param assistantId - 助手 ID
   * @param keyword - 搜索关键字
   * @returns 匹配的会话 ID 数组
   */
  public searchSessionContent(assistantId: string, keyword: string): string[] {
    if (!this.storageReady) {
      return [];
    }
    return this.storage.searchSessionIdsByContent(assistantId, keyword);
  }

  /**
   * 获取指定助手当前选中的会话详情。
   * @param assistantId - 可选的助手 ID，不传入则使用当前选中助手
   * @returns 会话详情，无选中会话时返回 undefined
   */
  public getSelectedSession(assistantId?: string): ChatSessionDetail | undefined {
    return this.sessionStateService.getSelectedSession(assistantId);
  }

  /**
   * 获取指定助手当前选中的会话 ID。
   * @param assistantId - 可选的助手 ID，不传入则使用当前选中助手
   * @returns 会话 ID，无选中会话时返回 undefined
   */
  public getSelectedSessionId(assistantId?: string): string | undefined {
    return this.sessionStateService.getSelectedSessionId(assistantId);
  }

  /**
   * 根据 ID 获取会话详情。
   * @param sessionId - 会话 ID
   * @returns 会话详情，未找到时返回 undefined
   */
  public getSessionById(sessionId: string): ChatSessionDetail | undefined {
    return this.sessionStateService.getSessionById(sessionId);
  }

  public async loadMessageImages(sessionId: string, messageId: string): Promise<ChatMessage['images']> {
    return this.storage.loadMessageImages(sessionId, messageId);
  }

  public createSession(assistantId: string, title: string): ChatSessionDetail {
    return this.sessionStateService.createSession(assistantId, title);
  }

  /**
   * 选中指定会话。
   * @param assistantId - 助手 ID
   * @param sessionId - 会话 ID
   */
  public selectSession(assistantId: string, sessionId: string): void {
    this.sessionStateService.selectSession(assistantId, sessionId);
  }

  /**
   * 重命名指定会话。
   * @param assistantId - 助手 ID
   * @param sessionId - 会话 ID
   * @param title - 新标题
   */
  public renameSession(assistantId: string, sessionId: string, title: string): void {
    this.sessionStateService.renameSession(assistantId, sessionId, title);
  }

  /**
   * 为指定会话生成 AI 标题（设置 generatedTitle 字段）。
   * @param assistantId - 助手 ID
   * @param sessionId - 会话 ID
   * @param title - 生成的标题
   */
  public generateSessionTitle(assistantId: string, sessionId: string, title: string): void {
    this.sessionStateService.generateSessionTitle(assistantId, sessionId, title);
  }

  /**
   * 删除指定会话。
   * @param assistantId - 助手 ID
   * @param sessionId - 会话 ID
   * @returns Promise，删除完成后 resolve
   */
  public async deleteSession(assistantId: string, sessionId: string): Promise<void> {
    await this.sessionStateService.deleteSession(assistantId, sessionId);
  }

  /**
   * 清空指定助手的所有会话。
   * @param assistantId - 助手 ID
   * @returns 被删除的会话数量
   */
  public async clearSessionsForAssistant(assistantId: string): Promise<number> {
    return await this.sessionStateService.clearSessionsForAssistant(assistantId);
  }

  /**
   * 向指定会话追加一条消息。
   * @param assistantId - 助手 ID
   * @param sessionId - 会话 ID
   * @param message - 要追加的消息对象
   * @returns 更新后的会话详情
   */
  public appendMessage(assistantId: string, sessionId: string, message: ChatMessage): ChatSessionDetail {
    return this.sessionStateService.appendMessage(assistantId, sessionId, message);
  }

  /**
   * 更新指定会话中最后一条助手消息。
   * @param assistantId - 助手 ID
   * @param sessionId - 会话 ID
   * @param updater - 更新函数，接收当前消息并返回更新后的消息
   * @param persist - 是否立即持久化
   * @returns 更新后的会话详情
   */
  public updateLastAssistantMessage(
    assistantId: string,
    sessionId: string,
    updater: (current: ChatMessage | undefined) => ChatMessage,
    persist = true
  ): ChatSessionDetail {
    return this.sessionStateService.updateLastAssistantMessage(assistantId, sessionId, updater, persist);
  }

  /**
   * 截断指定会话的消息历史，只保留最近 N 条。
   * @param assistantId - 助手 ID
   * @param sessionId - 会话 ID
   * @param keepCount - 要保留的消息数量
   * @returns 更新后的会话详情，会话不存在时返回 undefined
   */
  public truncateSessionMessages(assistantId: string, sessionId: string, keepCount: number): ChatSessionDetail | undefined {
    return this.sessionStateService.truncateSessionMessages(assistantId, sessionId, keepCount);
  }

  /**
   * 删除指定会话中的单条消息。
   * @param assistantId - 助手 ID
   * @param sessionId - 会话 ID
   * @param messageId - 消息 ID
   * @returns 更新后的会话详情，消息不存在时返回 undefined
   */
  public deleteMessage(assistantId: string, sessionId: string, messageId: string): ChatSessionDetail | undefined {
    return this.sessionStateService.deleteMessage(assistantId, sessionId, messageId);
  }

  /**
   * 编辑指定会话中的单条消息内容。
   * @param assistantId - 助手 ID
   * @param sessionId - 会话 ID
   * @param messageId - 消息 ID
   * @param newContent - 新内容
   * @returns 更新后的会话详情，消息不存在时返回 undefined
   */
  public editMessage(assistantId: string, sessionId: string, messageId: string, newContent: string): ChatSessionDetail | undefined {
    return this.sessionStateService.editMessage(assistantId, sessionId, messageId, newContent);
  }

  /**
   * 编辑指定消息并截断该消息之后的所有消息（用于重新生成分支）。
   * @param assistantId - 助手 ID
   * @param sessionId - 会话 ID
   * @param messageId - 消息 ID
   * @param newContent - 新内容
   * @returns 更新后的会话详情，消息不存在时返回 undefined
   */
  public editMessageAndTruncateAfter(assistantId: string, sessionId: string, messageId: string, newContent: string): ChatSessionDetail | undefined {
    return this.sessionStateService.editMessageAndTruncateAfter(assistantId, sessionId, messageId, newContent);
  }

  /**
   * 清空指定会话的所有消息（保留会话本身）。
   * @param assistantId - 助手 ID
   * @param sessionId - 会话 ID
   * @returns 更新后的会话详情，会话不存在时返回 undefined
   */
  public clearSessionMessages(assistantId: string, sessionId: string): ChatSessionDetail | undefined {
    return this.sessionStateService.clearSessionMessages(assistantId, sessionId);
  }

  /**
   * 设置会话面板的折叠状态。
   * @param collapsed - 是否折叠
   */
  public setSessionPanelCollapsed(collapsed: boolean): void {
    this.sessionStateService.setSessionPanelCollapsed(collapsed);
  }

  /**
   * 设置分组的折叠状态。
   * @param groupId - 分组 ID
   * @param collapsed - 是否折叠
   */
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
