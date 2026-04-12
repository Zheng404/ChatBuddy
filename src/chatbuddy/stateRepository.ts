import * as vscode from 'vscode';

import { cloneDefaultModels, getProviderModelOptions, resolveModelOption } from './modelCatalog';
import { error } from './utils';
import {
  AssistantGroup,
  AssistantProfile,
  ChatBuddyLocaleSetting,
  ChatBuddySettings,
  ChatMessage,
  ChatSessionDetail,
  ChatSessionSummary,
  ProviderModelOption,
  ProviderProfile
} from './types';
import { ChatStorage } from './chatStorage';
import { cloneAssistant, cloneGroup, cloneMcpServer, cloneMcpSettings, cloneProvider } from './stateClone';
import { parsePersistedStateLiteStore, parseProviderApiKeysStore, unwrapImportedState } from './stateHelpers';
import { createInitialState, sanitizeSettings } from './stateSanitizers';
import { AssistantStateService } from './stateRepositoryAssistantService';
import {
  applyProviderApiKeysToSettings,
  extractProviderApiKeys,
  mergePersistedState,
  normalizeLocalizedDefaultTitles,
  normalizeTitleSourceConsistency
} from './stateRepositoryImportExport';
import { SessionStateService } from './stateRepositorySessionService';

const SQLITE_STATE_KEY = 'chatbuddy.sqlite.state.v1';
const SQLITE_PROVIDER_API_KEYS_KEY = 'chatbuddy.sqlite.providerApiKeys.v1';
const BACKUP_SCHEMA = 'chatbuddy.backup';
const BACKUP_VERSION = 1;
const DEFAULT_ASSISTANT_SYSTEM_PROMPT = '';

export interface ChatBuddyBackupData {
  schema: typeof BACKUP_SCHEMA;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  state: import('./types').PersistedState;
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
  contextCount?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  streaming?: boolean;
  avatar?: string;
  enabledMcpServerIds?: string[];
}

export class ChatStateRepository {
  private state: import('./types').PersistedStateLite;
  private readonly storage = new ChatStorage();
  private providerApiKeys: Record<string, string> = {};
  private persistQueue: Promise<void> = Promise.resolve();
  private storageReady = false;
  private version = 0;
  private cachedState: import('./types').PersistedStateLite | undefined;
  private cachedStateVersion = -1;
  private persistScheduled = false;
  private readonly assistantStateService = new AssistantStateService({
    getState: () => this.state,
    setState: (state) => {
      this.state = state;
    },
    storage: this.storage,
    storageReady: () => this.storageReady,
    persistLater: () => {
      void this.persist();
    },
    isWritableGroup: (groupId) => this.isWritableGroup(groupId),
    defaultAssistantSystemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT
  });
  private readonly sessionStateService = new SessionStateService({
    getState: () => this.state,
    storage: this.storage,
    storageReady: () => this.storageReady,
    persistLater: () => {
      void this.persist();
    },
    ensureStorageReady: () => this.ensureStorageReady(),
    getSelectedAssistantId: () => this.getSelectedAssistantId(),
    markAssistantInteracted: (assistantId, persist) => this.assistantStateService.markAssistantInteracted(assistantId, persist)
  });

  private bump(): void {
    this.version++;
  }

  constructor(private readonly context: vscode.ExtensionContext) {
    this.state = createInitialState();
  }

  public async initialize(): Promise<void> {
    await this.storage.initialize(this.context.globalStorageUri.fsPath);
    this.storageReady = true;
    this.hydrateStateFromSqlite();
    this.hydrateProviderApiKeysFromSqlite();
    this.state.settings = applyProviderApiKeysToSettings(this.providerApiKeys, this.state.settings);
    normalizeLocalizedDefaultTitles(this.storage, this.state.settings.locale);
    normalizeTitleSourceConsistency(this.storage, this.state.settings.locale);
    await this.persistSecrets();
    await this.persist();
  }

  public async close(): Promise<void> {
    await this.storage.close();
  }

  public getState(): import('./types').PersistedStateLite {
    if (this.cachedStateVersion === this.version && this.cachedState) {
      return this.cachedState;
    }
    const cloned = {
      ...this.state,
      groups: this.state.groups.map(cloneGroup),
      assistants: this.state.assistants.map(cloneAssistant),
      selectedSessionIdByAssistant: { ...this.state.selectedSessionIdByAssistant },
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

  public getModelOptions(includeDisabled = false): ProviderModelOption[] {
    return getProviderModelOptions(this.state.settings.providers, includeDisabled);
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
    void this.persistSecrets();
    void this.persist();
  }

  public getMcpServers(): import('./types').McpServerProfile[] {
    return this.state.settings.mcp.servers.map(cloneMcpServer);
  }

  public async resetState(): Promise<void> {
    this.state = createInitialState();
    this.providerApiKeys = {};
    if (this.storageReady) {
      this.storage.replaceAllSessions([], false);
      await this.storage.flush();
    }
    await this.persistSecrets();
    await this.persist();
  }

  public exportBackupData(): ChatBuddyBackupData {
    return {
      schema: BACKUP_SCHEMA,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      state: {
        ...this.getState(),
        sessions: this.storageReady ? this.storage.listAllSessions() : []
      }
    };
  }

  public async importBackupData(input: unknown): Promise<void> {
    const unwrapped = unwrapImportedState(input);
    if (!unwrapped) {
      throw new Error('Invalid import payload');
    }
    const merged = this.mergeState(unwrapped);
    this.state = merged.state;
    this.providerApiKeys = extractProviderApiKeys(this.state.settings.providers);
    this.state.settings = applyProviderApiKeysToSettings(this.providerApiKeys, this.state.settings);
    this.ensureStorageReady();
    this.storage.replaceAllSessions(merged.sessions, false);
    await this.storage.flush();
    normalizeLocalizedDefaultTitles(this.storage, this.state.settings.locale);
    normalizeTitleSourceConsistency(this.storage, this.state.settings.locale);
    await this.persistSecrets();
    await this.persist();
  }

  public getProviderById(providerId: string): ProviderProfile | undefined {
    const provider = this.state.settings.providers.find((item) => item.id === providerId);
    return provider ? cloneProvider(provider) : undefined;
  }

  public getSelectedAssistant(): AssistantProfile | undefined {
    if (!this.state.assistants.length) {
      return undefined;
    }
    if (this.state.selectedAssistantId) {
      const selected = this.state.assistants.find((assistant) => assistant.id === this.state.selectedAssistantId);
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
    if (this.state.selectedAssistantId && this.state.assistants.some((assistant) => assistant.id === this.state.selectedAssistantId)) {
      return this.state.selectedAssistantId;
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

  public hardDeleteAssistant(assistantId: string): boolean {
    return this.assistantStateService.hardDeleteAssistant(assistantId);
  }

  public hardDeleteDeletedAssistants(): number {
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

  private getLatestSessionForAssistantRaw(assistantId: string): ChatSessionSummary | undefined {
    return this.sessionStateService.getLatestSessionForAssistantRaw(assistantId);
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

  public deleteSession(assistantId: string, sessionId: string): void {
    this.sessionStateService.deleteSession(assistantId, sessionId);
  }

  public clearSessionsForAssistant(assistantId: string): number {
    return this.sessionStateService.clearSessionsForAssistant(assistantId);
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

  public clearSessionMessages(assistantId: string, sessionId: string): ChatSessionDetail | undefined {
    return this.sessionStateService.clearSessionMessages(assistantId, sessionId);
  }

  public setSessionPanelCollapsed(collapsed: boolean): void {
    this.sessionStateService.setSessionPanelCollapsed(collapsed);
  }

  public setGroupCollapsed(groupId: string, collapsed: boolean): void {
    const ids = this.state.collapsedGroupIds;
    const index = ids.indexOf(groupId);
    if (collapsed) {
      if (index < 0) {
        ids.push(groupId);
        void this.persist();
      }
    } else if (index >= 0) {
      ids.splice(index, 1);
      void this.persist();
    }
  }

  private hydrateStateFromSqlite(): void {
    const stored = parsePersistedStateLiteStore(this.storage.getKv(SQLITE_STATE_KEY));
    if (!stored) {
      return;
    }
    const merged = mergePersistedState(stored);
    this.state = merged.state;
  }

  private hydrateProviderApiKeysFromSqlite(): void {
    const stored = parseProviderApiKeysStore(this.storage.getKv(SQLITE_PROVIDER_API_KEYS_KEY));
    this.providerApiKeys = stored;
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

  private readonly PERSIST_MAX_RETRIES = 2;
  private readonly PERSIST_RETRY_DELAY_MS = 500;
  private persistFailureNotified = false;

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
    for (let attempt = 0; attempt <= this.PERSIST_MAX_RETRIES; attempt++) {
      try {
        await task();
        this.persistFailureNotified = false;
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < this.PERSIST_MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, this.PERSIST_RETRY_DELAY_MS * (attempt + 1)));
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
    void vscode.window.showWarningMessage(
      'ChatBuddy: Failed to save data. Your changes may not be persisted.'
    );
  }

  private async persistSecrets(): Promise<void> {
    if (!this.storageReady) {
      return;
    }
    await this.queuePersist(async () => {
      const providerIds = new Set(this.state.settings.providers.map((provider) => provider.id.trim()));
      const normalizedEntries = Object.entries(this.providerApiKeys).filter(([providerId, apiKey]) => {
        const normalizedProviderId = providerId.trim();
        return normalizedProviderId.length > 0 && providerIds.has(normalizedProviderId) && apiKey.trim().length > 0;
      });
      const normalized = Object.fromEntries(
        normalizedEntries.map(([providerId, apiKey]) => [providerId.trim(), apiKey.trim()])
      );
      this.storage.setKv(SQLITE_PROVIDER_API_KEYS_KEY, JSON.stringify(normalized), false);
      await this.storage.flush();
    });
  }

  private async persist(): Promise<void> {
    if (!this.storageReady) {
      return;
    }
    this.bump();
    if (this.persistScheduled) {
      return;
    }
    this.persistScheduled = true;
    await this.queuePersist(async () => {
      const persistedState: import('./types').PersistedStateLite = {
        ...this.state,
        settings: {
          ...this.state.settings,
          defaultModels: cloneDefaultModels(this.state.settings.defaultModels),
          mcp: cloneMcpSettings(this.state.settings.mcp),
          providers: this.state.settings.providers.map((provider) => ({
            ...provider,
            apiKey: '',
            models: provider.models.map((model) => ({ ...model }))
          }))
        }
      };
      this.storage.setKv(SQLITE_STATE_KEY, JSON.stringify(persistedState), false);
      await this.storage.flush();
      this.persistScheduled = false;
    });
  }
}
