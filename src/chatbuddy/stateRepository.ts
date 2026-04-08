import * as vscode from 'vscode';

import { DEFAULT_GROUP_ID, DELETED_GROUP_ID } from './constants';
import { resolveLocale } from './i18n';
import {
  cloneDefaultModels,
  getProviderModelOptions,
  resolveModelOption
} from './modelCatalog';
import { sanitizeAssistantName, sanitizeGroupName } from './security';
import { clamp, createId, error, nowTs, resolveLocaleString } from './utils';
import {
  AssistantGroup,
  AssistantProfile,
  ChatBuddyLocaleSetting,
  ChatBuddySettings,
  ChatMessage,
  ChatSession,
  ChatSessionDetail,
  ChatSessionSummary,
  ProviderModelOption,
  ProviderProfile
} from './types';
import { ChatStorage } from './chatStorage';
import { cloneAssistant, cloneGroup, cloneMcpServer, cloneMcpSettings, cloneProvider, cloneSession, cloneSessionSummary } from './stateClone';
import {
  mergeModelBindingsIntoProviders,
  parsePersistedStateLiteStore,
  parseProviderApiKeysStore,
  getDefaultAssistantModelRef,
  resolveDefaultAssistantName,
  resolveUntitledSessionTitle,
  unwrapImportedState
} from './stateHelpers';
import {
  createInitialState,
  MAX_CONTEXT_COUNT,
  migrateAssistants,
  sanitizeGroups,
  sanitizeSessions,
  sanitizeSettings
} from './stateSanitizers';

const SQLITE_STATE_KEY = 'chatbuddy.sqlite.state.v1';
const SQLITE_PROVIDER_API_KEYS_KEY = 'chatbuddy.sqlite.providerApiKeys.v1';
const BACKUP_SCHEMA = 'chatbuddy.backup';
const BACKUP_VERSION = 1;
const LEGACY_UNTITLED_SESSION_TITLES = new Set(['新会话', 'New Chat']);
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

  constructor(private readonly context: vscode.ExtensionContext) {
    this.state = createInitialState();
  }

  public async initialize(): Promise<void> {
    await this.storage.initialize(this.context.globalStorageUri.fsPath);
    this.storageReady = true;
    this.hydrateStateFromSqlite();
    this.hydrateProviderApiKeysFromSqlite();
    this.applyProviderApiKeys(this.providerApiKeys);
    this.normalizeLocalizedDefaultTitles(this.state.settings.locale);
    this.normalizeTitleSourceConsistency(this.state.settings.locale);
    await this.persistSecrets();
    await this.persist();
  }

  public getState(): import('./types').PersistedStateLite {
    return {
      ...this.state,
      groups: this.state.groups.map(cloneGroup),
      assistants: this.state.assistants.map(cloneAssistant),
      selectedSessionIdByAssistant: { ...this.state.selectedSessionIdByAssistant },
      settings: this.getSettings()
    };
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
    this.providerApiKeys = this.extractProviderApiKeys(normalized.providers);
    this.applyProviderApiKeys(this.providerApiKeys, normalized);
    this.state.settings = normalized;
    const validMcpServerIds = new Set(normalized.mcp.servers.map((server) => server.id));
    this.state.assistants = this.state.assistants.map((assistant) => ({
      ...cloneAssistant(assistant),
      enabledMcpServerIds: assistant.enabledMcpServerIds.filter((serverId) => validMcpServerIds.has(serverId))
    }));
    this.normalizeLocalizedDefaultTitles(normalized.locale);
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
    this.providerApiKeys = this.extractProviderApiKeys(this.state.settings.providers);
    this.applyProviderApiKeys(this.providerApiKeys);
    this.ensureStorageReady();
    this.storage.replaceAllSessions(merged.sessions, false);
    await this.storage.flush();
    this.normalizeLocalizedDefaultTitles(this.state.settings.locale);
    this.normalizeTitleSourceConsistency(this.state.settings.locale);
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
    const assistant = this.state.assistants.find((item) => item.id === assistantId);
    if (!assistant) {
      return;
    }
    this.state.selectedAssistantId = assistant.id;
    assistant.lastInteractedAt = nowTs();
    assistant.updatedAt = nowTs();
    void this.persist();
  }

  public createGroup(name: string): AssistantGroup | undefined {
    const normalized = sanitizeGroupName(name);
    if (!normalized) {
      return undefined;
    }
    const timestamp = nowTs();
    const group: AssistantGroup = {
      id: createId('group'),
      name: normalized,
      kind: 'custom',
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.state.groups.push(group);
    void this.persist();
    return cloneGroup(group);
  }

  public renameGroup(groupId: string, name: string): boolean {
    const normalized = sanitizeGroupName(name);
    if (!normalized) {
      return false;
    }
    const group = this.state.groups.find((item) => item.id === groupId);
    if (!group || group.kind === 'deleted') {
      return false;
    }
    group.name = normalized;
    group.updatedAt = nowTs();
    void this.persist();
    return true;
  }

  public deleteGroup(groupId: string): boolean {
    const group = this.state.groups.find((item) => item.id === groupId);
    if (!group || group.kind !== 'custom') {
      return false;
    }
    this.state.groups = this.state.groups.filter((item) => item.id !== groupId);
    for (const assistant of this.state.assistants) {
      if (!assistant.isDeleted && assistant.groupId === groupId) {
        assistant.groupId = DEFAULT_GROUP_ID;
        assistant.updatedAt = nowTs();
      }
      if (assistant.originalGroupId === groupId) {
        assistant.originalGroupId = DEFAULT_GROUP_ID;
      }
    }
    void this.persist();
    return true;
  }

  public createAssistant(input: CreateAssistantInput): AssistantProfile {
    const settings = this.state.settings;
    const timestamp = nowTs();
    const groupId =
      typeof input.groupId === 'string' && this.isWritableGroup(input.groupId) ? input.groupId : DEFAULT_GROUP_ID;
    const defaultAssistantName = resolveDefaultAssistantName(settings.locale);
    const sanitizedName = sanitizeAssistantName(input.name) || defaultAssistantName;
    const sanitizedNote = input.note ? sanitizeAssistantName(input.note) : '';
    const assistant: AssistantProfile = {
      id: createId('assistant'),
      name: sanitizedName,
      note: sanitizedNote,
      avatar: undefined,
      groupId,
      systemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT,
      greeting: '',
      questionPrefix: '',
      modelRef: getDefaultAssistantModelRef(settings),
      temperature: settings.temperature,
      topP: settings.topP,
      maxTokens: 0,
      contextCount: 16,
      presencePenalty: settings.presencePenalty,
      frequencyPenalty: settings.frequencyPenalty,
      streaming: settings.streamingDefault,
      enabledMcpServerIds: [],
      pinned: false,
      isDeleted: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastInteractedAt: timestamp
    };
    this.state.assistants.push(assistant);
    this.state.selectedAssistantId = assistant.id;
    void this.persist();
    return cloneAssistant(assistant);
  }

  public updateAssistant(assistantId: string, patch: UpdateAssistantInput): AssistantProfile | undefined {
    const assistant = this.state.assistants.find((item) => item.id === assistantId);
    if (!assistant) {
      return undefined;
    }

    if (typeof patch.name === 'string') {
      const normalizedName = sanitizeAssistantName(patch.name);
      if (normalizedName) {
        assistant.name = normalizedName;
      }
    }
    if (typeof patch.note === 'string') {
      assistant.note = sanitizeAssistantName(patch.note);
    }
    if (typeof patch.avatar === 'string') {
      const normalizedAvatar = patch.avatar.trim();
      assistant.avatar = normalizedAvatar && /^[a-z0-9-]+$/i.test(normalizedAvatar) ? normalizedAvatar : undefined;
    }
    if (typeof patch.groupId === 'string' && this.isWritableGroup(patch.groupId) && !assistant.isDeleted) {
      assistant.groupId = patch.groupId;
    }
    if (typeof patch.greeting === 'string') {
      assistant.greeting = patch.greeting;
    }
    if (typeof patch.systemPrompt === 'string') {
      assistant.systemPrompt = patch.systemPrompt;
    }
    if (typeof patch.questionPrefix === 'string') {
      assistant.questionPrefix = patch.questionPrefix;
    }
    if (typeof patch.modelRef === 'string') {
      assistant.modelRef = patch.modelRef.trim();
    }
    if (typeof patch.temperature === 'number') {
      assistant.temperature = clamp(patch.temperature, 0, 2, assistant.temperature);
    }
    if (typeof patch.topP === 'number') {
      assistant.topP = clamp(patch.topP, 0, 1, assistant.topP);
    }
    if (typeof patch.maxTokens === 'number') {
      assistant.maxTokens = clamp(patch.maxTokens, 0, 65535, assistant.maxTokens);
    }
    if (typeof patch.contextCount === 'number') {
      assistant.contextCount = clamp(patch.contextCount, 0, MAX_CONTEXT_COUNT, assistant.contextCount);
    }
    if (typeof patch.presencePenalty === 'number') {
      assistant.presencePenalty = clamp(patch.presencePenalty, -2, 2, assistant.presencePenalty);
    }
    if (typeof patch.frequencyPenalty === 'number') {
      assistant.frequencyPenalty = clamp(patch.frequencyPenalty, -2, 2, assistant.frequencyPenalty);
    }
    if (typeof patch.streaming === 'boolean') {
      assistant.streaming = patch.streaming;
    }
    if (Array.isArray(patch.enabledMcpServerIds)) {
      const validIds = new Set(this.state.settings.mcp.servers.map((server) => server.id));
      assistant.enabledMcpServerIds = patch.enabledMcpServerIds
        .map((item) => item.trim())
        .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index && validIds.has(item));
    }
    assistant.updatedAt = nowTs();
    void this.persist();
    return cloneAssistant(assistant);
  }

  public toggleAssistantPinned(assistantId: string): AssistantProfile | undefined {
    const assistant = this.state.assistants.find((item) => item.id === assistantId);
    if (!assistant || assistant.isDeleted) {
      return undefined;
    }
    assistant.pinned = !assistant.pinned;
    assistant.updatedAt = nowTs();
    void this.persist();
    return cloneAssistant(assistant);
  }

  public softDeleteAssistant(assistantId: string): AssistantProfile | undefined {
    const assistant = this.state.assistants.find((item) => item.id === assistantId);
    if (!assistant || assistant.isDeleted) {
      return undefined;
    }
    assistant.originalGroupId = assistant.groupId === DELETED_GROUP_ID ? DEFAULT_GROUP_ID : assistant.groupId;
    assistant.groupId = DELETED_GROUP_ID;
    assistant.isDeleted = true;
    assistant.deletedAt = nowTs();
    assistant.pinned = false;
    assistant.updatedAt = nowTs();
    if (this.state.selectedAssistantId === assistant.id) {
      this.state.selectedAssistantId = assistant.id;
    }
    void this.persist();
    return cloneAssistant(assistant);
  }

  public restoreAssistant(assistantId: string): AssistantProfile | undefined {
    const assistant = this.state.assistants.find((item) => item.id === assistantId);
    if (!assistant || !assistant.isDeleted) {
      return undefined;
    }
    const targetGroupId =
      assistant.originalGroupId && this.isWritableGroup(assistant.originalGroupId)
        ? assistant.originalGroupId
        : DEFAULT_GROUP_ID;
    assistant.groupId = targetGroupId;
    assistant.isDeleted = false;
    assistant.deletedAt = undefined;
    assistant.originalGroupId = undefined;
    assistant.updatedAt = nowTs();
    this.state.selectedAssistantId = assistant.id;
    void this.persist();
    return cloneAssistant(assistant);
  }

  public hardDeleteAssistant(assistantId: string): boolean {
    const before = this.state.assistants.length;
    this.state.assistants = this.state.assistants.filter((assistant) => assistant.id !== assistantId);
    if (before === this.state.assistants.length) {
      return false;
    }
    if (this.storageReady) {
      this.storage.clearSessionsForAssistant(assistantId, true);
    }
    delete this.state.selectedSessionIdByAssistant[assistantId];
    if (this.state.selectedAssistantId === assistantId) {
      const next = this.state.assistants.find((assistant) => !assistant.isDeleted) ?? this.state.assistants[0];
      this.state.selectedAssistantId = next?.id;
    }
    void this.persist();
    return true;
  }

  public hardDeleteDeletedAssistants(): number {
    const deletedAssistantIds = this.state.assistants.filter((assistant) => assistant.isDeleted).map((assistant) => assistant.id);
    if (deletedAssistantIds.length === 0) {
      return 0;
    }
    const deletedSet = new Set(deletedAssistantIds);
    this.state.assistants = this.state.assistants.filter((assistant) => !deletedSet.has(assistant.id));
    if (this.storageReady) {
      this.storage.clearSessionsForAssistants(deletedAssistantIds, true);
    }
    for (const assistantId of deletedAssistantIds) {
      delete this.state.selectedSessionIdByAssistant[assistantId];
    }
    if (!this.state.selectedAssistantId || deletedSet.has(this.state.selectedAssistantId)) {
      const next = this.state.assistants.find((assistant) => !assistant.isDeleted) ?? this.state.assistants[0];
      this.state.selectedAssistantId = next?.id;
    }
    void this.persist();
    return deletedAssistantIds.length;
  }

  public setAssistantStreaming(assistantId: string, enabled: boolean): void {
    const assistant = this.state.assistants.find((item) => item.id === assistantId);
    if (!assistant) {
      return;
    }
    assistant.streaming = enabled;
    assistant.updatedAt = nowTs();
    void this.persist();
  }

  public markAssistantInteracted(assistantId: string, persist = true): void {
    const assistant = this.state.assistants.find((item) => item.id === assistantId);
    if (!assistant) {
      return;
    }
    assistant.lastInteractedAt = nowTs();
    assistant.updatedAt = nowTs();
    if (persist) {
      void this.persist();
    }
  }

  public getSessionsForAssistant(assistantId: string): ChatSessionSummary[] {
    if (!this.storageReady) {
      return [];
    }
    return this.storage.listSessionsByAssistant(assistantId).map(cloneSessionSummary);
  }

  private getLatestSessionForAssistantRaw(assistantId: string): ChatSessionSummary | undefined {
    if (!this.storageReady) {
      return undefined;
    }
    return this.storage.getLatestSessionSummary(assistantId);
  }

  public getSelectedSession(assistantId?: string): ChatSessionDetail | undefined {
    if (!this.storageReady) {
      return undefined;
    }
    const targetAssistantId = assistantId ?? this.state.selectedAssistantId;
    if (!targetAssistantId) {
      return undefined;
    }
    const selectedSessionId = this.state.selectedSessionIdByAssistant[targetAssistantId];
    if (selectedSessionId) {
      const selected = this.storage.getSessionDetail(targetAssistantId, selectedSessionId);
      if (selected) {
        return cloneSession(selected);
      }
    }
    const latest = this.getLatestSessionForAssistantRaw(targetAssistantId);
    if (!latest) {
      return undefined;
    }
    const detail = this.storage.getSessionDetail(targetAssistantId, latest.id);
    return detail ? cloneSession(detail) : undefined;
  }

  public getSelectedSessionId(assistantId?: string): string | undefined {
    if (!this.storageReady) {
      return undefined;
    }
    const targetAssistantId = assistantId ?? this.getSelectedAssistantId();
    if (!targetAssistantId) {
      return undefined;
    }
    const selectedSessionId = this.state.selectedSessionIdByAssistant[targetAssistantId];
    if (selectedSessionId && this.storage.sessionExists(targetAssistantId, selectedSessionId)) {
      return selectedSessionId;
    }
    return this.getLatestSessionForAssistantRaw(targetAssistantId)?.id;
  }

  public getSessionById(sessionId: string): ChatSessionDetail | undefined {
    if (!this.storageReady) {
      return undefined;
    }
    const session = this.storage.getSessionDetailById(sessionId);
    return session ? cloneSession(session) : undefined;
  }

  public createSession(assistantId: string, title: string): ChatSessionDetail {
    this.ensureStorageReady();
    const assistant = this.state.assistants.find((item) => item.id === assistantId);
    const locale = resolveLocale(this.state.settings.locale, vscode.env.language);
    if (!assistant) {
      throw new Error(resolveLocaleString(locale, '助手不存在', 'Assistant not found'));
    }
    if (assistant.isDeleted) {
      throw new Error(resolveLocaleString(locale, '已删除助手无法创建会话', 'Cannot create session for deleted assistant'));
    }
    const timestamp = nowTs();
    const greeting = assistant.greeting.trim();
    const session: ChatSession = {
      id: createId('session'),
      assistantId,
      title,
      titleSource: 'default',
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: greeting
        ? [
            {
              id: createId('msg'),
              role: 'assistant',
              content: greeting,
              timestamp
            }
          ]
        : []
    };
    this.storage.insertSession(session, true);
    this.state.selectedSessionIdByAssistant[assistantId] = session.id;
    this.state.selectedAssistantId = assistantId;
    assistant.lastInteractedAt = timestamp;
    assistant.updatedAt = timestamp;
    void this.persist();
    return cloneSession(session);
  }

  public selectSession(assistantId: string, sessionId: string): void {
    if (!this.storageReady) {
      return;
    }
    const exists = this.storage.sessionExists(assistantId, sessionId);
    if (!exists) {
      return;
    }
    this.state.selectedAssistantId = assistantId;
    this.state.selectedSessionIdByAssistant[assistantId] = sessionId;
    this.markAssistantInteracted(assistantId, false);
    void this.persist();
  }

  public renameSession(assistantId: string, sessionId: string, title: string): void {
    if (!this.storageReady) {
      return;
    }
    const normalized = title.trim();
    if (!normalized) {
      return;
    }
    const session = this.getSessionById(sessionId);
    if (!session || session.assistantId !== assistantId) {
      return;
    }
    const updatedAt = nowTs();
    const changed = this.storage.renameSession(assistantId, sessionId, normalized, 'custom', updatedAt);
    if (!changed) {
      return;
    }
    this.markAssistantInteracted(assistantId, false);
    void this.persist();
  }

  public generateSessionTitle(assistantId: string, sessionId: string, title: string): void {
    if (!this.storageReady) {
      return;
    }
    const normalized = title.trim();
    if (!normalized) {
      return;
    }
    const session = this.getSessionById(sessionId);
    if (!session || session.assistantId !== assistantId) {
      return;
    }
    if (session.titleSource !== 'default') {
      return;
    }
    const updatedAt = nowTs();
    const changed = this.storage.renameSession(assistantId, sessionId, normalized, 'generated', updatedAt);
    if (!changed) {
      return;
    }
    this.markAssistantInteracted(assistantId, false);
    void this.persist();
  }

  public deleteSession(assistantId: string, sessionId: string): void {
    if (!this.storageReady) {
      return;
    }
    const removed = this.storage.deleteSession(assistantId, sessionId, true);
    if (!removed) {
      return;
    }
    const latest = this.getLatestSessionForAssistantRaw(assistantId);
    if (latest) {
      this.state.selectedSessionIdByAssistant[assistantId] = latest.id;
    } else {
      delete this.state.selectedSessionIdByAssistant[assistantId];
    }
    this.markAssistantInteracted(assistantId, false);
    void this.persist();
  }

  public clearSessionsForAssistant(assistantId: string): number {
    if (!this.storageReady) {
      return 0;
    }
    const removed = this.storage.clearSessionsForAssistant(assistantId, true);
    if (removed <= 0) {
      return 0;
    }
    delete this.state.selectedSessionIdByAssistant[assistantId];
    this.markAssistantInteracted(assistantId, false);
    void this.persist();
    return removed;
  }

  public appendMessage(assistantId: string, sessionId: string, message: ChatMessage): ChatSessionDetail {
    this.ensureStorageReady();
    const updatedAt = nowTs();
    const changed = this.storage.appendMessage(assistantId, sessionId, message, updatedAt, true);
    if (!changed) {
      throw new Error('Session not found');
    }
    this.state.selectedSessionIdByAssistant[assistantId] = sessionId;
    this.state.selectedAssistantId = assistantId;
    this.markAssistantInteracted(assistantId, false);
    void this.persist();
    const next = this.getSelectedSession(assistantId);
    if (!next || next.id !== sessionId) {
      throw new Error('Session not found');
    }
    return cloneSession(next);
  }

  public updateLastAssistantMessage(
    assistantId: string,
    sessionId: string,
    updater: (current: ChatMessage | undefined) => ChatMessage,
    persist = true
  ): ChatSessionDetail {
    this.ensureStorageReady();
    const updatedAt = nowTs();
    const changed = this.storage.updateLastAssistantMessage(assistantId, sessionId, updater, updatedAt, persist);
    if (!changed) {
      throw new Error('Session not found');
    }
    this.state.selectedSessionIdByAssistant[assistantId] = sessionId;
    this.state.selectedAssistantId = assistantId;
    this.markAssistantInteracted(assistantId, false);
    if (persist) {
      void this.persist();
    }
    const next = this.getSelectedSession(assistantId);
    if (!next || next.id !== sessionId) {
      throw new Error('Session not found');
    }
    return cloneSession(next);
  }

  public truncateSessionMessages(assistantId: string, sessionId: string, keepCount: number): ChatSessionDetail | undefined {
    if (!Number.isFinite(keepCount) || keepCount < 0 || !this.storageReady) {
      return undefined;
    }
    const updatedAt = nowTs();
    const changed = this.storage.truncateMessages(assistantId, sessionId, Math.floor(keepCount), updatedAt, true);
    if (!changed) {
      return undefined;
    }
    this.state.selectedSessionIdByAssistant[assistantId] = sessionId;
    this.state.selectedAssistantId = assistantId;
    this.markAssistantInteracted(assistantId, false);
    void this.persist();
    const next = this.getSelectedSession(assistantId);
    return next && next.id === sessionId ? cloneSession(next) : undefined;
  }

  public deleteMessage(assistantId: string, sessionId: string, messageId: string): ChatSessionDetail | undefined {
    if (!this.storageReady) {
      return undefined;
    }
    const updatedAt = nowTs();
    const changed = this.storage.deleteMessage(assistantId, sessionId, messageId, updatedAt, true);
    if (!changed) {
      const current = this.getSelectedSession(assistantId);
      return current && current.id === sessionId ? cloneSession(current) : undefined;
    }
    this.state.selectedSessionIdByAssistant[assistantId] = sessionId;
    this.state.selectedAssistantId = assistantId;
    this.markAssistantInteracted(assistantId, false);
    void this.persist();
    const next = this.getSelectedSession(assistantId);
    return next && next.id === sessionId ? cloneSession(next) : undefined;
  }

  public editMessage(assistantId: string, sessionId: string, messageId: string, newContent: string): ChatSessionDetail | undefined {
    if (!this.storageReady) {
      return undefined;
    }
    const updatedAt = nowTs();
    const changed = this.storage.updateMessage(assistantId, sessionId, messageId, newContent, updatedAt, true);
    if (!changed) {
      return undefined;
    }
    const current = this.getSelectedSession(assistantId);
    if (current && current.id === sessionId) {
      return cloneSession(current);
    }
    return undefined;
  }

  public clearSessionMessages(assistantId: string, sessionId: string): ChatSessionDetail | undefined {
    if (!this.storageReady) {
      return undefined;
    }
    const updatedAt = nowTs();
    const changed = this.storage.clearSessionMessages(assistantId, sessionId, updatedAt, true);
    if (!changed) {
      return undefined;
    }
    const current = this.getSelectedSession(assistantId);
    if (current && current.id === sessionId) {
      return cloneSession(current);
    }
    return undefined;
  }

  public setSessionPanelCollapsed(collapsed: boolean): void {
    this.state.sessionPanelCollapsed = collapsed;
    void this.persist();
  }

  private hydrateStateFromSqlite(): void {
    const stored = parsePersistedStateLiteStore(this.storage.getKv(SQLITE_STATE_KEY));
    if (!stored) {
      return;
    }
    const merged = this.mergeState(stored);
    this.state = merged.state;
  }

  private hydrateProviderApiKeysFromSqlite(): void {
    const stored = parseProviderApiKeysStore(this.storage.getKv(SQLITE_PROVIDER_API_KEYS_KEY));
    this.providerApiKeys = stored;
  }

  private extractProviderApiKeys(providers: ProviderProfile[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const provider of providers) {
      const providerId = provider.id.trim();
      const apiKey = provider.apiKey.trim();
      if (providerId && apiKey) {
        result[providerId] = apiKey;
      }
    }
    return result;
  }

  private applyProviderApiKeys(apiKeys: Record<string, string>, settings: ChatBuddySettings = this.state.settings): void {
    settings.providers = settings.providers.map((provider) => ({
      ...provider,
      apiKey: apiKeys[provider.id] ?? '',
      models: provider.models.map((model) => ({ ...model }))
    }));
  }

  private mergeState(
    saved: import('./types').PersistedState | import('./types').PersistedStateLite | Record<string, unknown> | undefined
  ): { state: import('./types').PersistedStateLite; sessions: ChatSessionDetail[] } {
    if (!saved) {
      return {
        state: createInitialState(),
        sessions: []
      };
    }
    const timestamp = nowTs();
    const source = saved as Partial<import('./types').PersistedState & import('./types').PersistedStateLite>;
    const settings = sanitizeSettings(source.settings);
    const groups = sanitizeGroups(source.groups);
    const groupIds = new Set(groups.map((group) => group.id));
    const assistants = migrateAssistants(source.assistants, settings, groupIds, timestamp);
    const mergedProviders = mergeModelBindingsIntoProviders(
      settings.providers,
      [settings.defaultModels.assistant, settings.defaultModels.titleSummary],
      assistants.map((assistant) => assistant.modelRef)
    );
    settings.providers = mergedProviders;
    const assistantIds = new Set(assistants.map((assistant) => assistant.id));
    const untitledSessionTitle = resolveUntitledSessionTitle(settings.locale);
    const sessions = sanitizeSessions((source as Partial<import('./types').PersistedState>).sessions, assistantIds, untitledSessionTitle);
    const sessionByAssistant = new Map<string, Set<string>>();
    for (const session of sessions) {
      const bucket = sessionByAssistant.get(session.assistantId) ?? new Set<string>();
      bucket.add(session.id);
      sessionByAssistant.set(session.assistantId, bucket);
    }
    const selectedAssistantId =
      typeof source.selectedAssistantId === 'string' && assistantIds.has(source.selectedAssistantId)
        ? source.selectedAssistantId
        : assistants.find((assistant) => !assistant.isDeleted)?.id ?? assistants[0]?.id;
    const selectedSessionIdByAssistant: Record<string, string> = {};
    for (const [assistantId, sessionId] of Object.entries(source.selectedSessionIdByAssistant ?? {})) {
      if (!assistantIds.has(assistantId)) {
        continue;
      }
      if (sessions.length > 0) {
        if (sessionByAssistant.get(assistantId)?.has(sessionId)) {
          selectedSessionIdByAssistant[assistantId] = sessionId;
        }
        continue;
      }
      if (typeof sessionId === 'string' && sessionId.trim()) {
        selectedSessionIdByAssistant[assistantId] = sessionId;
      }
    }
    return {
      state: {
        groups,
        assistants,
        selectedAssistantId,
        selectedSessionIdByAssistant,
        sessionPanelCollapsed: source.sessionPanelCollapsed ?? false,
        settings
      },
      sessions
    };
  }

  private normalizeLocalizedDefaultTitles(localeSetting: ChatBuddyLocaleSetting | undefined): void {
    if (!this.storageReady) {
      return;
    }
    const untitledSessionTitle = resolveUntitledSessionTitle(localeSetting);
    const sessions = this.storage.listAllSessions();
    for (const session of sessions) {
      if (session.titleSource !== 'default') {
        continue;
      }
      const title = session.title.trim();
      if (!title || LEGACY_UNTITLED_SESSION_TITLES.has(title)) {
        if (session.title === untitledSessionTitle) {
          continue;
        }
        this.storage.renameSession(session.assistantId, session.id, untitledSessionTitle, 'default', session.updatedAt);
      }
    }
  }

  /**
   * Fix sessions that have default/untitled titles but titleSource !== 'default'.
   * This handles data inconsistency from version upgrades or imports where old
   * sessions with default-looking titles got titleSource set to 'custom'.
   */
  private normalizeTitleSourceConsistency(localeSetting: ChatBuddyLocaleSetting | undefined): void {
    if (!this.storageReady) {
      return;
    }
    const untitledSessionTitle = resolveUntitledSessionTitle(localeSetting);
    const sessions = this.storage.listAllSessions();
    for (const session of sessions) {
      if (session.titleSource === 'default') {
        continue;
      }
      const title = session.title.trim();
      if (!title || title === untitledSessionTitle || LEGACY_UNTITLED_SESSION_TITLES.has(title)) {
        this.storage.renameSession(
          session.assistantId,
          session.id,
          title || untitledSessionTitle,
          'default',
          session.updatedAt
        );
      }
    }
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
    });
  }
}
