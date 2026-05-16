/**
 * 状态持久化服务模块。
 *
 * 负责将内存中的 `PersistedStateLite` 异步持久化到 Compass 结构化存储，
 * 以及从存储中恢复状态。管理防抖持久化、版本冲突检测和数据一致性。
 */
import * as vscode from 'vscode';

import { cloneDefaultModels } from './modelCatalog';
import { ChatStorage, COMPASS_PROVIDER_API_KEYS_STORE_KEY, COMPASS_STATE_STORE_KEY } from './chatStorage';
import { readJsonFileWithMtime } from './compassStorage/io';
import { cloneMcpSettings } from './stateClone';
import { mergePersistedState } from './stateRepositoryImportExport';
import { AssistantGroup, AssistantProfile, AssistantTemplate, ChatBuddySettings, PersistedStateLite, ProviderModelProfile } from './types';
import { error } from './utils';
import { mergeById } from './stateMerge';

export const COMPASS_STATE_KEY = COMPASS_STATE_STORE_KEY;
export const COMPASS_PROVIDER_API_KEYS_KEY = COMPASS_PROVIDER_API_KEYS_STORE_KEY;

type PersistenceServiceContext = {
  storage: Pick<
    ChatStorage,
    'readStateLite' | 'writeStateLite' | 'readProviderApiKeys' | 'writeProviderApiKeys' | 'flush' | 'getStateCorePath'
  >;
  storageReady: () => boolean;
  getState: () => PersistedStateLite;
  setState: (state: PersistedStateLite) => void;
  getProviderApiKeys: () => Record<string, string>;
  setProviderApiKeys: (providerApiKeys: Record<string, string>) => void;
  bumpVersion: () => void;
  getGlobalState: () => vscode.Memento;
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
 */
function mergeSettingsForPersist(memory: ChatBuddySettings, disk: ChatBuddySettings): ChatBuddySettings {
  const memoryProviderIds = new Set(memory.providers.map((p) => p.id));
  const mergedProviders = [
    ...memory.providers,
    ...disk.providers.filter((p) => !memoryProviderIds.has(p.id))
  ];

  const memoryMcpIds = new Set(memory.mcp.servers.map((s) => s.id));
  const mergedMcpServers = [
    ...memory.mcp.servers,
    ...disk.mcp.servers.filter((s) => !memoryMcpIds.has(s.id))
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
    localBackup: memory.localBackup !== undefined ? memory.localBackup : disk.localBackup
  };
}

/**
 * 三向合并：将内存状态与磁盘状态合并，保留更新的数据。
 * 用于跨 IDE 同时写入时防止数据覆盖丢失。
 */
function threeWayMergeState(memory: PersistedStateLite, disk: PersistedStateLite): PersistedStateLite {
  const mergedAssistants = mergeById<AssistantProfile>(memory.assistants, disk.assistants);
  const mergedGroups = mergeById<AssistantGroup>(memory.groups, disk.groups);

  const mergedTemplates = mergeById<AssistantTemplate>(memory.templates, disk.templates);

  const mergedSettings = mergeSettingsForPersist(memory.settings, disk.settings);

  // UI 状态（selectedAssistantId、selectedSessionIdByAssistant 等）保留内存值
  // 因为 UI 状态是本地临时的，不应被其他 IDE 覆盖
  return {
    groups: mergedGroups,
    assistants: mergedAssistants,
    selectedAssistantId: memory.selectedAssistantId,
    selectedSessionIdByAssistant: memory.selectedSessionIdByAssistant,
    sessionPanelCollapsed: memory.sessionPanelCollapsed,
    collapsedGroupIds: memory.collapsedGroupIds,
    templates: mergedTemplates,
    settings: mergedSettings
  };
}

export class StatePersistenceService {
  private persistQueue: Promise<void> = Promise.resolve();
  private persistScheduled = false;
  private persistFailureNotified = false;
  private readonly persistMaxRetries = 2;
  private readonly persistRetryDelayMs = 500;

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
      return;
    }
    this.persistScheduled = true;
    try {
      await this.queuePersist(async () => {
        const state = this.context.getState();
        // Strip UI state fields before persisting to Compass storage.
        // These are kept in VS Code globalState (per-IDE, not shared).
        const {
          selectedAssistantId: _sa,
          selectedSessionIdByAssistant: _ss,
          collapsedGroupIds: _cg,
          sessionPanelCollapsed: _sp,
          ...stateWithoutUi
        } = state;
        const persistedState: PersistedStateLite = {
          ...stateWithoutUi,
          selectedAssistantId: undefined,
          selectedSessionIdByAssistant: {},
          collapsedGroupIds: [],
          sessionPanelCollapsed: false,
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
        const stateCorePath = this.context.storage.getStateCorePath();
        if (stateCorePath) {
          const disk = await readJsonFileWithMtime<{
            groups?: AssistantGroup[];
            assistants?: AssistantProfile[];
            templates?: AssistantTemplate[];
            settings?: ChatBuddySettings;
          }>(stateCorePath);
          if (disk.data) {
            const diskState: PersistedStateLite = {
              groups: disk.data.groups ?? [],
              assistants: disk.data.assistants ?? [],
              selectedAssistantId: undefined,
              selectedSessionIdByAssistant: {},
              sessionPanelCollapsed: false,
              collapsedGroupIds: [],
              templates: disk.data.templates ?? [],
              settings: disk.data.settings ?? state.settings
            };
            const merged = threeWayMergeState(persistedState, diskState);
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
        }

        this.context.storage.writeStateLite(persistedState, false);
        await this.context.storage.flush();
      });
    } finally {
      this.persistScheduled = false;
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
}
