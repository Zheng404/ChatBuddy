/**
 * 状态持久化服务模块。
 *
 * 负责将内存中的 `PersistedStateLite` 异步持久化到 Compass 结构化存储，
 * 以及从存储中恢复状态。管理防抖持久化、版本冲突检测和数据一致性。
 */
import * as vscode from 'vscode';

import { cloneDefaultModels } from './modelCatalog';
import { ChatStorage, COMPASS_PROVIDER_API_KEYS_STORE_KEY, COMPASS_STATE_STORE_KEY } from './chatStorage';
import { cloneMcpSettings } from './stateClone';
import { mergePersistedState } from './stateRepositoryImportExport';
import { AssistantGroup, AssistantProfile, AssistantTemplate, ChatBuddySettings, PersistedStateLite, ProviderModelProfile } from './types';
import { getFileHash } from './compassStorage/io.js';
import { error } from './utils';
import { mergeById, mergeLocalBackup } from './stateMerge';

export const COMPASS_STATE_KEY = COMPASS_STATE_STORE_KEY;
export const COMPASS_PROVIDER_API_KEYS_KEY = COMPASS_PROVIDER_API_KEYS_STORE_KEY;

type PersistenceServiceContext = {
  storage: Pick<
    ChatStorage,
    'readStateLite' | 'writeStateLite' | 'readProviderApiKeys' | 'writeProviderApiKeys' | 'flush' | 'getStateCorePath' | 'readFullDiskState' | 'readProviderApiKeysFromDisk'
  >;
  storageReady: () => boolean;
  getState: () => PersistedStateLite;
  setState: (state: PersistedStateLite) => void;
  getProviderApiKeys: () => Record<string, string>;
  setProviderApiKeys: (providerApiKeys: Record<string, string>) => void;
  bumpVersion: () => void;
  /** 返回本会话中已删除的 provider ID 集合，防止 persist 合并时从磁盘复活 */
  getDeletedProviderIds: () => Set<string>;
  getDeletedMcpServerIds: () => Set<string>;
  getDeletedAssistantIds: () => Set<string>;
  getDeletedGroupIds: () => Set<string>;
  getDeletedTemplateIds: () => Set<string>;
  /** persist 成功后清理已合并的删除 ID，防止误过滤后续 reload */
  clearDeletedEntityIds: () => void;
};

/**
 * Strip runtime-resolved kind/capabilities before persisting to storage.
 * Only user overrides (userKindOverride / userCapabilitiesOverride) are kept.
 * Returns a plain object for JSON serialization (not a ProviderModelProfile).
 */
function stripTransientModelFields(model: ProviderModelProfile): object {
  const { kind: _kind, capabilities: _caps, userKindOverride, userCapabilitiesOverride, ...rest } = model;
  const result: object = { ...rest };
  if (userKindOverride) {
    (result as Record<string, unknown>).userKindOverride = userKindOverride;
  }
  if (userCapabilitiesOverride) {
    (result as Record<string, unknown>).userCapabilitiesOverride = userCapabilitiesOverride;
  }
  return result;
}

/**
 * persist 时合并 settings：memory 优先，保留本地修改。
 * 防止本 IDE 的 settings 修改被其他 IDE 的数据覆盖。
 *
 * 合并方向说明：
 * - persist 时（本函数）：memory 优先 → 保留本 IDE 未持久化的修改
 * - reload 时（mergeSettingsForReload）：disk 优先 → 加载其他 IDE 的更新
 * - 两个方向互补：persist 保留本地修改，reload 接收远程更新
 * - 高频并发编辑同一字段可能产生"乒乓"效应（最后编辑者胜出），但不会丢失数据
 */
interface DeletedEntityIds {
  providers?: ReadonlySet<string>;
  mcpServers?: ReadonlySet<string>;
}

function mergeSettingsForPersist(memory: ChatBuddySettings, disk: ChatBuddySettings, deletedIds?: DeletedEntityIds): ChatBuddySettings {
  const memoryProviderIds = new Set(memory.providers.map((p) => p.id));
  const mergedProviders = [
    ...memory.providers,
    ...disk.providers.filter((p) => !memoryProviderIds.has(p.id) && !(deletedIds?.providers && deletedIds.providers.has(p.id)))
  ];

  const memoryMcpIds = new Set(memory.mcp.servers.map((s) => s.id));
  const mergedMcpServers = [
    ...memory.mcp.servers,
    ...disk.mcp.servers.filter((s) => !memoryMcpIds.has(s.id) && !(deletedIds?.mcpServers && deletedIds.mcpServers.has(s.id)))
  ];

  return {
    providers: mergedProviders,
    defaultModels: memory.defaultModels.assistant ? memory.defaultModels : disk.defaultModels,
    mcp: { ...memory.mcp, servers: mergedMcpServers },
    temperature: memory.temperature !== undefined ? memory.temperature : disk.temperature,
    topP: memory.topP !== undefined ? memory.topP : disk.topP,
    maxTokens: memory.maxTokens !== undefined ? memory.maxTokens : disk.maxTokens,
    presencePenalty: memory.presencePenalty !== undefined ? memory.presencePenalty : disk.presencePenalty,
    frequencyPenalty: memory.frequencyPenalty !== undefined ? memory.frequencyPenalty : disk.frequencyPenalty,
    timeoutMs: memory.timeoutMs !== undefined ? memory.timeoutMs : disk.timeoutMs,
    streamingDefault: memory.streamingDefault !== undefined ? memory.streamingDefault : disk.streamingDefault,
    locale: memory.locale !== undefined ? memory.locale : disk.locale,
    sendShortcut: memory.sendShortcut !== undefined ? memory.sendShortcut : disk.sendShortcut,
    chatTabMode: memory.chatTabMode !== undefined ? memory.chatTabMode : disk.chatTabMode,
    localBackup: mergeLocalBackup(memory.localBackup, disk.localBackup) ?? memory.localBackup ?? disk.localBackup
  };
}

/**
 * 三向合并：将内存状态与磁盘状态合并，保留更新的数据。
 * 用于跨 IDE 同时写入时防止数据覆盖丢失。
 */
interface AllDeletedIds {
  providers: ReadonlySet<string>;
  mcpServers: ReadonlySet<string>;
  assistants: ReadonlySet<string>;
  groups: ReadonlySet<string>;
  templates: ReadonlySet<string>;
}

function threeWayMergeState(memory: PersistedStateLite, disk: PersistedStateLite, deletedIds?: AllDeletedIds): PersistedStateLite {
  const mergedAssistants = mergeById<AssistantProfile>(memory.assistants, disk.assistants, deletedIds?.assistants);
  const mergedGroups = mergeById<AssistantGroup>(memory.groups, disk.groups, deletedIds?.groups);

  const mergedTemplates = mergeById<AssistantTemplate>(memory.templates, disk.templates, deletedIds?.templates);

  const mergedSettings = mergeSettingsForPersist(memory.settings, disk.settings, deletedIds ? { providers: deletedIds.providers, mcpServers: deletedIds.mcpServers } : undefined);

  // UI 状态现在也存入 Compass（跨 IDE 同步）
  // selectedAssistantId / selectedSessionIdByAssistant 使用 memory 优先：
  // 这些字段代表本 IDE 的用户交互状态，persist 异步合并时磁盘可能过时，
  // memory 优先避免用户切换助手后被磁盘旧值覆盖
  return {
    groups: mergedGroups,
    assistants: mergedAssistants,
    selectedAssistantId: memory.selectedAssistantId ?? disk.selectedAssistantId,
    selectedSessionIdByAssistant: { ...disk.selectedSessionIdByAssistant, ...memory.selectedSessionIdByAssistant },
    sessionPanelCollapsed: memory.sessionPanelCollapsed ?? disk.sessionPanelCollapsed,
    collapsedGroupIds: [...new Set([...disk.collapsedGroupIds, ...memory.collapsedGroupIds])],
    templates: mergedTemplates,
    settings: mergedSettings
  };
}

export class StatePersistenceService {
  private persistQueue: Promise<void> = Promise.resolve();
  private persistScheduled = false;
  private persistDirty = false;
  private persistFailureNotified = false;
  private readonly persistMaxRetries = 3;
  private readonly persistRetryDelayMs = 200;

  constructor(private readonly context: PersistenceServiceContext) {}

  public hydrateStateFromStorage(): void {
    const stored = this.context.storage.readStateLite();
    if (!stored) {
      return;
    }
    const merged = mergePersistedState(stored);
    this.context.setState(merged.state);
  }

  public hydrateProviderApiKeysFromStorage(): void {
    const stored = this.context.storage.readProviderApiKeys();
    this.context.setProviderApiKeys(stored);
  }

  public async persistSecrets(): Promise<void> {
    if (!this.context.storageReady()) {
      return;
    }
    await this.queuePersist(async () => {
      const state = this.context.getState();
      const providerApiKeys = this.context.getProviderApiKeys();
      const providerIds = new Set(state.settings.providers.map((provider) => provider.id.trim()));
      const normalizedEntries = Object.entries(providerApiKeys).filter(([providerId, apiKey]) => {
        const normalizedProviderId = providerId.trim();
        return normalizedProviderId.length > 0 && providerIds.has(normalizedProviderId) && apiKey.trim().length > 0;
      });
      const normalized = Object.fromEntries(
        normalizedEntries.map(([providerId, apiKey]) => [providerId.trim(), apiKey.trim()])
      );

      // 写前读取合并：从磁盘读取其他 IDE 写入的 API Key，
      // 防止跨 IDE persistSecrets 互相覆盖导致 Key 丢失。
      // 注意：必须从磁盘读取（非内存），否则其他 IDE 新增的 Key 无法被保留。
      let diskKeys: Record<string, string> = {};
      try {
        diskKeys = await this.context.storage.readProviderApiKeysFromDisk();
      } catch {
        // 磁盘读取失败时降级为内存读取
        diskKeys = this.context.storage.readProviderApiKeys();
      }
      for (const [id, key] of Object.entries(diskKeys)) {
        // 跳过本会话已删除的 provider，防止从磁盘复活
        if (!(id in normalized) && providerIds.has(id) && !this.context.getDeletedProviderIds().has(id)) {
          normalized[id] = key;
        }
      }

      this.context.storage.writeProviderApiKeys(normalized, false);
      await this.context.storage.flush();
    });
  }

  public async persist(): Promise<void> {
    if (!this.context.storageReady()) {
      return;
    }
    this.context.bumpVersion();
    if (this.persistScheduled) {
      // 标记为 dirty，当前 persist 完成后会自动重新执行
      this.persistDirty = true;
      return;
    }
    this.persistScheduled = true;
    try {
      await this.queuePersist(async () => {
        const state = this.context.getState();
        // UI 状态现在存入 Compass（跨 IDE 同步），不再剥离
        const persistedState: PersistedStateLite = {
          ...state,
          settings: {
            ...state.settings,
            defaultModels: cloneDefaultModels(state.settings.defaultModels),
            mcp: cloneMcpSettings(state.settings.mcp),
            providers: state.settings.providers.map((provider) => ({
              ...provider,
              models: provider.models.map(stripTransientModelFields)
            })) as PersistedStateLite['settings']['providers']
          }
        };

        // 写前读取：检测其他 IDE 是否修改了磁盘数据
        // 读取磁盘全量状态（所有结构化文件）并与内存状态合并
        // 使用 content hash 乐观锁：读取后到写入前再次检查 hash，若变化则重新合并
        const stateCorePath = this.context.storage.getStateCorePath();
        if (stateCorePath) {
          const merged = await this.mergeWithDisk(persistedState);
          this.context.storage.writeStateLite(merged, false);
          await this.context.storage.flush();
          // 如果合并后数据与内存不同，更新内存状态（仅更新非 UI 字段）
          const mergedStr = JSON.stringify(merged);
          const memoryStr = JSON.stringify(persistedState);
          if (mergedStr !== memoryStr) {
            this.context.setState(merged);
            this.context.bumpVersion();
          }
          return;
        }

        this.context.storage.writeStateLite(persistedState, false);
        await this.context.storage.flush();
      });
      // persist 成功：清理已合并的删除 ID，避免后续 reload 时误过滤
      this.context.clearDeletedEntityIds();
    } finally {
      this.persistScheduled = false;
      // 如果 persist 期间有新的变更请求，自动重新触发
      if (this.persistDirty) {
        this.persistDirty = false;
        void this.persist();
      }
    }
  }

  public async drain(): Promise<void> {
    await this.persistQueue;
  }

  private queuePersist(task: () => Promise<void>): Promise<void> {
    const run = this.persistQueue.then(
      () => this.executeWithRetry(task),
      () => this.executeWithRetry(task)
    );
    this.persistQueue = run.catch((err) => {
      error('Persist queue error:', err);
      this.notifyPersistFailure();
    });
    return run;
  }

  private async executeWithRetry(task: () => Promise<void>): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.persistMaxRetries; attempt += 1) {
      try {
        await task();
        this.persistFailureNotified = false;
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < this.persistMaxRetries) {
          await new Promise((resolve) => setTimeout(resolve, this.persistRetryDelayMs * (attempt + 1)));
        }
      }
    }
    throw lastErr;
  }

  private notifyPersistFailure(): void {
    if (this.persistFailureNotified) {
      return;
    }
    this.persistFailureNotified = true;
    void vscode.window.showWarningMessage('ChatBuddy: Failed to save data. Your changes may not be persisted.');
  }

  /**
   * 写前读取磁盘全部状态文件并与内存状态合并（含 content hash 乐观锁重试）。
   *
   * 从磁盘读取所有结构化状态文件（state.core、settings.*、ui.selection 等），
   * 重建完整的 PersistedStateLite 后与内存状态三向合并。
   * 使用 state.core.json 的 SHA-256 哈希作为乐观锁：如果在读取后、写入前内容变化
   * （其他 IDE 写入），重新读取并合并，最多重试 3 次。
   * 比 mtime 更可靠，不受文件系统时间戳精度限制。
   */
  private async mergeWithDisk(
    persistedState: PersistedStateLite
  ): Promise<PersistedStateLite> {
    const maxAttempts = 5;
    let lastMerged: PersistedStateLite | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const diskResult = await this.context.storage.readFullDiskState();

      if (!diskResult.state) {
        // 磁盘无数据，直接返回内存状态
        return persistedState;
      }

      const diskState = diskResult.state;
      const hashBeforeMerge = diskResult.contentHash;
      const merged = threeWayMergeState(persistedState, diskState, {
        providers: this.context.getDeletedProviderIds(),
        mcpServers: this.context.getDeletedMcpServerIds(),
        assistants: this.context.getDeletedAssistantIds(),
        groups: this.context.getDeletedGroupIds(),
        templates: this.context.getDeletedTemplateIds()
      });
      lastMerged = merged;

      // content hash 乐观锁：写入前再次检查文件内容是否变化
      // 如果变化说明其他 IDE 在我们读取后又写入了，需要重新合并
      if (hashBeforeMerge) {
        const stateCorePath = this.context.storage.getStateCorePath();
        const currentHash = stateCorePath ? await getFileHash(stateCorePath) : '';
        if (currentHash !== hashBeforeMerge) {
          // 内容变化，其他 IDE 有新写入，加随机退避后重试
          if (attempt < maxAttempts - 1) {
            const delay = 10 + Math.floor(Math.random() * 20);
            await new Promise((r) => setTimeout(r, delay));
          }
          continue;
        }
      }

      return merged;
    }
    // 重试耗尽：返回最后一次合并结果（包含磁盘数据），避免丢失其他 IDE 的数据
    error('mergeWithDisk: %d retries exhausted, concurrent writes detected. Using last merged result.', maxAttempts);
    return lastMerged ?? persistedState;
  }
}
