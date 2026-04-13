import * as vscode from 'vscode';

import { cloneDefaultModels } from './modelCatalog';
import { ChatStorage } from './chatStorage';
import { cloneMcpSettings } from './stateClone';
import { parsePersistedStateLiteStore, parseProviderApiKeysStore } from './stateHelpers';
import { mergePersistedState } from './stateRepositoryImportExport';
import { PersistedStateLite } from './types';
import { error } from './utils';

export const SQLITE_STATE_KEY = 'chatbuddy.sqlite.state.v1';
export const SQLITE_PROVIDER_API_KEYS_KEY = 'chatbuddy.sqlite.providerApiKeys.v1';

type PersistenceServiceContext = {
  storage: ChatStorage;
  storageReady: () => boolean;
  getState: () => PersistedStateLite;
  setState: (state: PersistedStateLite) => void;
  getProviderApiKeys: () => Record<string, string>;
  setProviderApiKeys: (providerApiKeys: Record<string, string>) => void;
  bumpVersion: () => void;
};

export class StatePersistenceService {
  private persistQueue: Promise<void> = Promise.resolve();
  private persistScheduled = false;
  private persistFailureNotified = false;
  private readonly persistMaxRetries = 2;
  private readonly persistRetryDelayMs = 500;

  constructor(private readonly context: PersistenceServiceContext) {}

  public hydrateStateFromSqlite(): void {
    const stored = parsePersistedStateLiteStore(this.context.storage.getKv(SQLITE_STATE_KEY));
    if (!stored) {
      return;
    }
    const merged = mergePersistedState(stored);
    this.context.setState(merged.state);
  }

  public hydrateProviderApiKeysFromSqlite(): void {
    const stored = parseProviderApiKeysStore(this.context.storage.getKv(SQLITE_PROVIDER_API_KEYS_KEY));
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
      this.context.storage.setKv(SQLITE_PROVIDER_API_KEYS_KEY, JSON.stringify(normalized), false);
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
            apiKey: '',
            models: provider.models.map((model) => ({ ...model }))
          }))
        }
      };
      this.context.storage.setKv(SQLITE_STATE_KEY, JSON.stringify(persistedState), false);
      await this.context.storage.flush();
      this.persistScheduled = false;
    });
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
