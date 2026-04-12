import { DEFAULT_GROUP_ID, DELETED_GROUP_ID } from './constants';
import { getDefaultAssistantModelRef, resolveDefaultAssistantName } from './stateHelpers';
import { cloneAssistant, cloneGroup } from './stateClone';
import { sanitizeAssistantName, sanitizeGroupName } from './security';
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
  isWritableGroup: (groupId: string) => boolean;
  defaultAssistantSystemPrompt: string;
};

export class AssistantStateService {
  constructor(private readonly context: AssistantServiceContext) {}

  public setSelectedAssistant(assistantId: string): void {
    const state = this.context.getState();
    const assistant = state.assistants.find((item) => item.id === assistantId);
    if (!assistant) {
      return;
    }
    state.selectedAssistantId = assistant.id;
    assistant.lastInteractedAt = nowTs();
    assistant.updatedAt = nowTs();
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
    const sanitizedNote = input.note ? sanitizeAssistantName(input.note) : '';
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
    state.selectedAssistantId = assistant.id;
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
      assistant.note = sanitizeAssistantName(patch.note);
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
    assistant.updatedAt = nowTs();
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
    if (state.selectedAssistantId === assistant.id) {
      state.selectedAssistantId = assistant.id;
    }
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
    state.selectedAssistantId = assistant.id;
    this.context.persistLater();
    return cloneAssistant(assistant);
  }

  public hardDeleteAssistant(assistantId: string): boolean {
    const state = this.context.getState();
    const before = state.assistants.length;
    state.assistants = state.assistants.filter((assistant) => assistant.id !== assistantId);
    if (before === state.assistants.length) {
      return false;
    }
    if (this.context.storageReady()) {
      this.context.storage.clearSessionsForAssistant(assistantId, true);
    }
    delete state.selectedSessionIdByAssistant[assistantId];
    if (state.selectedAssistantId === assistantId) {
      const next = state.assistants.find((assistant) => !assistant.isDeleted) ?? state.assistants[0];
      state.selectedAssistantId = next?.id;
    }
    this.context.persistLater();
    return true;
  }

  public hardDeleteDeletedAssistants(): number {
    const state = this.context.getState();
    const deletedAssistantIds = state.assistants.filter((assistant) => assistant.isDeleted).map((assistant) => assistant.id);
    if (deletedAssistantIds.length === 0) {
      return 0;
    }
    const deletedSet = new Set(deletedAssistantIds);
    state.assistants = state.assistants.filter((assistant) => !deletedSet.has(assistant.id));
    if (this.context.storageReady()) {
      this.context.storage.clearSessionsForAssistants(deletedAssistantIds, true);
    }
    for (const assistantId of deletedAssistantIds) {
      delete state.selectedSessionIdByAssistant[assistantId];
    }
    if (!state.selectedAssistantId || deletedSet.has(state.selectedAssistantId)) {
      const next = state.assistants.find((assistant) => !assistant.isDeleted) ?? state.assistants[0];
      state.selectedAssistantId = next?.id;
    }
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
    if (persist) {
      this.context.persistLater();
    }
  }
}
