/**
 * 助手状态服务模块。
 *
 * 封装助手和分组的 CRUD 操作，包括创建、更新、软删除/恢复、置顶、
 * 分组管理等功能。所有操作直接修改 `PersistedStateLite` 并通过回调触发持久化。
 */
import { DEFAULT_GROUP_ID, DELETED_GROUP_ID } from './constants';
import { getDefaultAssistantModelRef, resolveDefaultAssistantName } from './stateHelpers';
import { cloneAssistant, cloneGroup } from './stateClone';
import { sanitizeAssistantName, sanitizeAssistantNote, sanitizeGroupName } from './security';
import { clamp, createId, nowTs } from './utils';
import {
  AssistantGroup,
  AssistantProfile,
  PersistedStateLite
} from './types';
import type { CreateAssistantInput, UpdateAssistantInput } from './stateRepository';
import { MAX_CONTEXT_COUNT } from './stateSanitizers';
import { ChatStorage } from './chatStorage';

type AssistantServiceContext = {
  getState: () => PersistedStateLite;
  setState: (state: PersistedStateLite) => void;
  storage: ChatStorage;
  storageReady: () => boolean;
  persistLater: () => void;
  /** 同步递增版本号，立即失效 getState() 缓存，避免返回旧数据 */
  bumpVersion: () => void;
  isWritableGroup: (groupId: string) => boolean;
  defaultAssistantSystemPrompt: string;
  getSelectedAssistantId: () => string | undefined;
  setSelectedAssistantId: (id: string | undefined) => void;
  getSelectedSessionIds: () => Record<string, string>;
  setSelectedSessionIds: (ids: Record<string, string>) => void;
  /** 记录已删除的实体 ID，防止 persist/reload 合并时从磁盘复活 */
  trackDeletedAssistant?: (id: string) => void;
  trackDeletedGroup?: (id: string) => void;
};

export class AssistantStateService {
  constructor(private readonly context: AssistantServiceContext) {}

  public setSelectedAssistant(assistantId: string): void {
    const state = this.context.getState();
    const assistant = state.assistants.find((item) => item.id === assistantId);
    if (!assistant) {
      return;
    }
    this.context.setSelectedAssistantId(assistant.id);
    assistant.lastInteractedAt = nowTs();
    assistant.updatedAt = nowTs();
    this.context.bumpVersion();
    this.context.persistLater();
  }

  public createGroup(name: string): AssistantGroup | undefined {
    const normalized = sanitizeGroupName(name);
    if (!normalized) {
      return undefined;
    }
    const state = this.context.getState();
    const timestamp = nowTs();
    const group: AssistantGroup = {
      id: createId('group'),
      name: normalized,
      kind: 'custom',
      createdAt: timestamp,
      updatedAt: timestamp
    };
    state.groups.push(group);
    this.context.bumpVersion();
    this.context.persistLater();
    return cloneGroup(group);
  }

  public renameGroup(groupId: string, name: string): boolean {
    const normalized = sanitizeGroupName(name);
    if (!normalized) {
      return false;
    }
    const state = this.context.getState();
    const group = state.groups.find((item) => item.id === groupId);
    if (!group || group.kind === 'deleted') {
      return false;
    }
    group.name = normalized;
    group.updatedAt = nowTs();
    this.context.bumpVersion();
    this.context.persistLater();
    return true;
  }

  public deleteGroup(groupId: string): boolean {
    const state = this.context.getState();
    const group = state.groups.find((item) => item.id === groupId);
    if (!group || group.kind !== 'custom') {
      return false;
    }
    state.groups = state.groups.filter((item) => item.id !== groupId);
    for (const assistant of state.assistants) {
      if (!assistant.isDeleted && assistant.groupId === groupId) {
        assistant.groupId = DEFAULT_GROUP_ID;
        assistant.updatedAt = nowTs();
      }
      if (assistant.originalGroupId === groupId) {
        assistant.originalGroupId = DEFAULT_GROUP_ID;
      }
    }
    this.context.trackDeletedGroup?.(groupId);
    this.context.bumpVersion();
    this.context.persistLater();
    return true;
  }

  public createAssistant(input: CreateAssistantInput): AssistantProfile {
    const state = this.context.getState();
    const settings = state.settings;
    const timestamp = nowTs();
    const groupId =
      typeof input.groupId === 'string' && this.context.isWritableGroup(input.groupId) ? input.groupId : DEFAULT_GROUP_ID;
    const defaultAssistantName = resolveDefaultAssistantName(settings.locale);
    const sanitizedName = sanitizeAssistantName(input.name) || defaultAssistantName;
    // note 是描述性文本，使用更宽松的 sanitizer（更长字符上限），避免与 name 共用同一限制
    const sanitizedNote = input.note ? sanitizeAssistantNote(input.note) : '';
    const assistant: AssistantProfile = {
      id: createId('assistant'),
      name: sanitizedName,
      note: sanitizedNote,
      avatar: undefined,
      groupId,
      systemPrompt: this.context.defaultAssistantSystemPrompt,
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
    state.assistants.push(assistant);
    this.context.setSelectedAssistantId(assistant.id);
    this.context.bumpVersion();
    this.context.persistLater();
    return cloneAssistant(assistant);
  }

  public updateAssistant(assistantId: string, patch: UpdateAssistantInput): AssistantProfile | undefined {
    const state = this.context.getState();
    const assistant = state.assistants.find((item) => item.id === assistantId);
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
      assistant.note = sanitizeAssistantNote(patch.note);
    }
    if (typeof patch.avatar === 'string') {
      const normalizedAvatar = patch.avatar.trim();
      assistant.avatar = normalizedAvatar && /^[a-z0-9-]+$/i.test(normalizedAvatar) ? normalizedAvatar : undefined;
    }
    if (typeof patch.groupId === 'string' && this.context.isWritableGroup(patch.groupId) && !assistant.isDeleted) {
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
      const validIds = new Set(state.settings.mcp.servers.map((server) => server.id));
      assistant.enabledMcpServerIds = patch.enabledMcpServerIds
        .map((item) => item.trim())
        .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index && validIds.has(item));
    }
    if (patch.overrides !== undefined) {
      assistant.overrides = patch.overrides;
    }
    if (patch.stopSequences !== undefined) {
      assistant.stopSequences = patch.stopSequences.length > 0 ? patch.stopSequences : undefined;
    }
    if (patch.seed !== undefined) {
      assistant.seed = patch.seed;
    }
    if (patch.responseFormat !== undefined) {
      assistant.responseFormat = patch.responseFormat;
    }
    if (patch.toolChoice !== undefined) {
      assistant.toolChoice = patch.toolChoice;
    }
    if (patch.geminiSafetyLevel !== undefined) {
      assistant.geminiSafetyLevel = patch.geminiSafetyLevel;
    }
    if (typeof patch.topK === 'number') {
      assistant.topK = clamp(patch.topK, 0, 1000, assistant.topK ?? 0);
    }
    if (patch.failoverModelRefs !== undefined) {
      assistant.failoverModelRefs = patch.failoverModelRefs.length > 0 ? [...patch.failoverModelRefs] : undefined;
    }
    assistant.updatedAt = nowTs();
    this.context.bumpVersion();
    this.context.persistLater();
    return cloneAssistant(assistant);
  }

  public toggleAssistantPinned(assistantId: string): AssistantProfile | undefined {
    const state = this.context.getState();
    const assistant = state.assistants.find((item) => item.id === assistantId);
    if (!assistant || assistant.isDeleted) {
      return undefined;
    }
    assistant.pinned = !assistant.pinned;
    assistant.updatedAt = nowTs();
    this.context.bumpVersion();
    this.context.persistLater();
    return cloneAssistant(assistant);
  }

  public softDeleteAssistant(assistantId: string): AssistantProfile | undefined {
    const state = this.context.getState();
    const assistant = state.assistants.find((item) => item.id === assistantId);
    if (!assistant || assistant.isDeleted) {
      return undefined;
    }
    assistant.originalGroupId = assistant.groupId === DELETED_GROUP_ID ? DEFAULT_GROUP_ID : assistant.groupId;
    assistant.groupId = DELETED_GROUP_ID;
    assistant.isDeleted = true;
    assistant.deletedAt = nowTs();
    assistant.pinned = false;
    assistant.updatedAt = nowTs();
    // 软删除后保持选中状态（由调用方决定是否切换）
    // selectedAssistantId 保持不变
    this.context.bumpVersion();
    this.context.persistLater();
    return cloneAssistant(assistant);
  }

  public restoreAssistant(assistantId: string): AssistantProfile | undefined {
    const state = this.context.getState();
    const assistant = state.assistants.find((item) => item.id === assistantId);
    if (!assistant || !assistant.isDeleted) {
      return undefined;
    }
    const targetGroupId =
      assistant.originalGroupId && this.context.isWritableGroup(assistant.originalGroupId)
        ? assistant.originalGroupId
        : DEFAULT_GROUP_ID;
    assistant.groupId = targetGroupId;
    assistant.isDeleted = false;
    assistant.deletedAt = undefined;
    assistant.originalGroupId = undefined;
    assistant.updatedAt = nowTs();
    this.context.setSelectedAssistantId(assistant.id);
    this.context.bumpVersion();
    this.context.persistLater();
    return cloneAssistant(assistant);
  }

  public async hardDeleteAssistant(assistantId: string): Promise<boolean> {
    const state = this.context.getState();
    const before = state.assistants.length;
    state.assistants = state.assistants.filter((assistant) => assistant.id !== assistantId);
    if (before === state.assistants.length) {
      return false;
    }
    if (this.context.storageReady()) {
      await this.context.storage.clearSessionsForAssistant(assistantId, true);
    }
    const selectedSessionIds = this.context.getSelectedSessionIds();
    delete selectedSessionIds[assistantId];
    this.context.setSelectedSessionIds(selectedSessionIds);
    if (this.context.getSelectedAssistantId() === assistantId) {
      const next = state.assistants.find((assistant) => !assistant.isDeleted) ?? state.assistants[0];
      this.context.setSelectedAssistantId(next?.id);
    }
    this.context.trackDeletedAssistant?.(assistantId);
    this.context.bumpVersion();
    this.context.persistLater();
    return true;
  }

  public async hardDeleteDeletedAssistants(): Promise<number> {
    const state = this.context.getState();
    const deletedAssistantIds = state.assistants.filter((assistant) => assistant.isDeleted).map((assistant) => assistant.id);
    if (deletedAssistantIds.length === 0) {
      return 0;
    }
    const deletedSet = new Set(deletedAssistantIds);
    state.assistants = state.assistants.filter((assistant) => !deletedSet.has(assistant.id));
    if (this.context.storageReady()) {
      await this.context.storage.clearSessionsForAssistants(deletedAssistantIds, true);
    }
    const selectedSessionIds = this.context.getSelectedSessionIds();
    for (const assistantId of deletedAssistantIds) {
      delete selectedSessionIds[assistantId];
    }
    this.context.setSelectedSessionIds(selectedSessionIds);
    const currentSelectedId = this.context.getSelectedAssistantId();
    if (!currentSelectedId || deletedSet.has(currentSelectedId)) {
      const next = state.assistants.find((assistant) => !assistant.isDeleted) ?? state.assistants[0];
      this.context.setSelectedAssistantId(next?.id);
    }
    for (const assistantId of deletedAssistantIds) {
      this.context.trackDeletedAssistant?.(assistantId);
    }
    this.context.bumpVersion();
    this.context.persistLater();
    return deletedAssistantIds.length;
  }

  public setAssistantStreaming(assistantId: string, enabled: boolean): void {
    const state = this.context.getState();
    const assistant = state.assistants.find((item) => item.id === assistantId);
    if (!assistant) {
      return;
    }
    assistant.streaming = enabled;
    assistant.updatedAt = nowTs();
    this.context.bumpVersion();
    this.context.persistLater();
  }

  public markAssistantInteracted(assistantId: string, persist = true): void {
    const state = this.context.getState();
    const assistant = state.assistants.find((item) => item.id === assistantId);
    if (!assistant) {
      return;
    }
    assistant.lastInteractedAt = nowTs();
    assistant.updatedAt = nowTs();
    // 即使 persist=false，状态已修改，必须同步 bump 以失效 getState() 缓存
    this.context.bumpVersion();
    if (persist) {
      this.context.persistLater();
    }
  }
}
