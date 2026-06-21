/**
 * 状态持久化服务模块。
 *
 * 负责将内存中的 `PersistedStateLite` 异步持久化到 Compass 结构化存储，
 * 以及从存储中恢复状态。管理防抖持久化、版本冲突检测和数据一致性。
 */
import * as vscode from 'vscode';

import { cloneDefaultModels } from './modelCatalog';
import { ChatStorage } from './chatStorage';
import { getStrings, resolveLocale } from './i18n';
import { cloneMcpSettings } from './stateClone';
import { mergePersistedState } from './stateRepositoryImportExport';
import { PersistedStateLite, ProviderModelProfile } from './types';
import { error } from './utils';


type PersistenceServiceContext = {
  storage: Pick<
    ChatStorage,
    'readStateLite' | 'writeStateLite' | 'readProviderApiKeys' | 'writeProviderApiKeys' | 'flush'
  >;
  storageReady: () => boolean;
  getState: () => PersistedStateLite;
  setState: (state: PersistedStateLite) => void;
  getProviderApiKeys: () => Record<string, string>;
  setProviderApiKeys: (providerApiKeys: Record<string, string>) => void;
  bumpVersion: () => void;
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
      this.persistDirty = true;
      return;
    }
    this.persistScheduled = true;
    try {
      await this.queuePersist(async () => {
        const state = this.context.getState();
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
        this.context.storage.writeStateLite(persistedState, false);
        this.syncProviderApiKeysToStorage(persistedState);
        await this.context.storage.flush();
      });
    } finally {
      this.persistScheduled = false;
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
    const locale = resolveLocale(undefined, vscode.env.language);
    void vscode.window.showWarningMessage(getStrings(locale).dataSaveFailed);
  }

  /**
   * 将内存中的 API keys 同步到 storage。
   */
  private syncProviderApiKeysToStorage(state: PersistedStateLite): void {
    const providerApiKeys = this.context.getProviderApiKeys();
    const providerIds = new Set(state.settings.providers.map((p) => p.id.trim()));
    const normalized = Object.fromEntries(
      Object.entries(providerApiKeys)
        .filter(([id, key]) => id.trim() && providerIds.has(id.trim()) && key.trim())
        .map(([id, key]) => [id.trim(), key.trim()])
    );
    this.context.storage.writeProviderApiKeys(normalized, false);
  }

}
