import { DEFAULT_GROUP_ID, DELETED_GROUP_ID } from './constants';
import {
  createEmptyDefaultModels,
  createModelRef,
  dedupeModels,
  normalizeApiType,
  parseModelRef
} from './modelCatalog';
import { isValidModelName, isValidUrl, sanitizeAssistantName } from './security';
import { clamp, createId, nowTs } from './utils';
import { cloneProvider } from './stateClone';
import {
  getDefaultAssistantModelRef,
  inferProviderKind,
  mergeModelBindingsIntoProviders,
  normalizeTitleSource,
  resolveDefaultAssistantName,
  resolveUntitledSessionTitle,
  createSystemGroups
} from './stateHelpers';
import {
  AssistantGroup,
  AssistantProfile,
  ChatBuddySettings,
  ChatMessage,
  ChatSession,
  DefaultModelSettings,
  McpKeyValueEntry,
  McpServerProfile,
  McpSettings,
  ModelBinding,
  PersistedStateLite,
  ProviderProfile
} from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_CONTEXT_COUNT = Number.MAX_SAFE_INTEGER;
const DEFAULT_ASSISTANT_SYSTEM_PROMPT = '';
const LEGACY_UNTITLED_SESSION_TITLES = new Set(['新会话', 'New Chat']);

export const DEFAULT_SETTINGS: ChatBuddySettings = {
  providers: [],
  defaultModels: createEmptyDefaultModels(),
  mcp: {
    servers: [],
    maxToolRounds: 8
  },
  temperature: 0.7,
  topP: 1,
  maxTokens: 0,
  presencePenalty: 0,
  frequencyPenalty: 0,
  timeoutMs: 60000,
  streamingDefault: true,
  locale: 'auto',
  sendShortcut: 'enter',
  chatTabMode: 'single' as const
};

// ─── Normalize ───────────────────────────────────────────────────────────────

export function normalizeProviderBaseUrl(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  if (!normalized) {
    return fallback;
  }
  return isValidUrl(normalized) ? normalized : fallback;
}

export function normalizeModelId(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  if (!normalized) {
    return fallback;
  }
  return isValidModelName(normalized) ? normalized : fallback;
}

export function normalizeModelBinding(value: unknown): ModelBinding | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const binding = value as Partial<ModelBinding>;
  const providerId = typeof binding.providerId === 'string' ? binding.providerId.trim() : '';
  const modelId = normalizeModelId(binding.modelId);
  if (!providerId || !modelId) {
    return undefined;
  }
  return {
    providerId,
    modelId
  };
}

export function normalizeMcpKeyValueEntries(value: unknown): McpKeyValueEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: McpKeyValueEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const entry = item as Partial<McpKeyValueEntry>;
    const key = typeof entry.key === 'string' ? entry.key.trim() : '';
    if (!key) {
      continue;
    }
    result.push({
      key,
      value: typeof entry.value === 'string' ? entry.value : ''
    });
  }
  return result;
}

// ─── Sanitize ─────────────────────────────────────────────────────────────────

export function sanitizeMcpServer(raw: unknown): McpServerProfile | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const source = raw as Partial<McpServerProfile> & { args?: unknown };
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  if (!id || !name) {
    return undefined;
  }
  const transport =
    source.transport === 'streamableHttp' || source.transport === 'sse' || source.transport === 'stdio'
      ? source.transport
      : 'stdio';
  const args = Array.isArray(source.args)
    ? source.args
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : [];
  return {
    id,
    name,
    enabled: source.enabled !== false,
    transport,
    command: typeof source.command === 'string' ? source.command.trim() : '',
    args,
    cwd: typeof source.cwd === 'string' ? source.cwd.trim() : '',
    env: normalizeMcpKeyValueEntries(source.env),
    url: typeof source.url === 'string' ? source.url.trim() : '',
    headers: normalizeMcpKeyValueEntries(source.headers),
    timeoutMs: clamp(typeof source.timeoutMs === 'number' ? source.timeoutMs : 60000, 1000, 600000, 60000),
    remotePassthroughEnabled: source.remotePassthroughEnabled === true
  };
}

export function sanitizeMcpSettings(raw: unknown): McpSettings {
  const source = raw && typeof raw === 'object' ? (raw as Partial<McpSettings>) : {};
  const byId = new Map<string, McpServerProfile>();
  for (const item of Array.isArray(source.servers) ? source.servers : []) {
    const server = sanitizeMcpServer(item);
    if (!server || byId.has(server.id)) {
      continue;
    }
    byId.set(server.id, server);
  }
  return {
    servers: [...byId.values()],
    maxToolRounds: clamp(
      typeof source.maxToolRounds === 'number' ? source.maxToolRounds : DEFAULT_SETTINGS.mcp.maxToolRounds,
      1,
      20,
      DEFAULT_SETTINGS.mcp.maxToolRounds
    )
  };
}

export function sanitizeProviders(input: unknown): ProviderProfile[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    return [];
  }

  const byId = new Map<string, ProviderProfile>();
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const value = item as Partial<ProviderProfile> & { defaultModel?: string };
    let id = typeof value.id === 'string' ? value.id.trim() : '';
    if (!id) {
      id = createId('provider');
    }
    while (byId.has(id)) {
      id = createId('provider');
    }
    const legacyDefaultModel = normalizeModelId(value.defaultModel);
    const models = dedupeModels([
      ...(Array.isArray(value.models) ? value.models : []),
      ...(legacyDefaultModel ? [legacyDefaultModel] : [])
    ]);
    const kind = inferProviderKind(value, id);
    byId.set(id, {
      id,
      kind,
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Provider',
      apiKey: typeof value.apiKey === 'string' ? value.apiKey.trim() : '',
      baseUrl: normalizeProviderBaseUrl(value.baseUrl),
      apiType: normalizeApiType(value.apiType, kind === 'ollama' ? 'chat_completions' : 'responses'),
      enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
      models,
      modelLastSyncedAt: typeof value.modelLastSyncedAt === 'number' ? value.modelLastSyncedAt : undefined
    });
  }

  return [...byId.values()];
}

export function sanitizeDefaultModels(raw: unknown, legacyAssistantBinding?: ModelBinding): DefaultModelSettings {
  const source = raw && typeof raw === 'object' ? (raw as Partial<DefaultModelSettings>) : {};
  return {
    assistant: normalizeModelBinding(source.assistant) ?? legacyAssistantBinding,
    titleSummary: normalizeModelBinding(source.titleSummary),
    titleSummaryPrompt: typeof source.titleSummaryPrompt === 'string' ? source.titleSummaryPrompt.trim() || undefined : undefined
  };
}

export function sanitizeSettings(raw: unknown): ChatBuddySettings {
  const saved = (raw ?? {}) as Partial<ChatBuddySettings> & { defaultProviderId?: string; defaultModel?: string };
  const providers = sanitizeProviders(saved.providers);
  const legacyAssistantBinding =
    typeof saved.defaultProviderId === 'string' && saved.defaultProviderId.trim() && normalizeModelId(saved.defaultModel)
      ? {
          providerId: saved.defaultProviderId.trim(),
          modelId: normalizeModelId(saved.defaultModel)
        }
      : undefined;
  const defaultModels = sanitizeDefaultModels(saved.defaultModels, legacyAssistantBinding);
  const hydratedProviders = mergeModelBindingsIntoProviders(providers, [defaultModels.assistant, defaultModels.titleSummary]);
  const mcp = sanitizeMcpSettings(saved.mcp);

  return {
    providers: hydratedProviders,
    defaultModels,
    mcp,
    temperature: clamp(saved.temperature ?? DEFAULT_SETTINGS.temperature, 0, 2, DEFAULT_SETTINGS.temperature),
    topP: clamp(saved.topP ?? DEFAULT_SETTINGS.topP, 0, 1, DEFAULT_SETTINGS.topP),
    maxTokens: clamp(saved.maxTokens ?? DEFAULT_SETTINGS.maxTokens, 0, 65535, DEFAULT_SETTINGS.maxTokens),
    presencePenalty: clamp(
      saved.presencePenalty ?? DEFAULT_SETTINGS.presencePenalty,
      -2,
      2,
      DEFAULT_SETTINGS.presencePenalty
    ),
    frequencyPenalty: clamp(
      saved.frequencyPenalty ?? DEFAULT_SETTINGS.frequencyPenalty,
      -2,
      2,
      DEFAULT_SETTINGS.frequencyPenalty
    ),
    timeoutMs: clamp(saved.timeoutMs ?? DEFAULT_SETTINGS.timeoutMs, 5000, 300000, DEFAULT_SETTINGS.timeoutMs),
    streamingDefault:
      typeof saved.streamingDefault === 'boolean' ? saved.streamingDefault : DEFAULT_SETTINGS.streamingDefault,
    locale:
      saved.locale === 'zh-CN' || saved.locale === 'en' || saved.locale === 'auto'
        ? saved.locale
        : DEFAULT_SETTINGS.locale,
    sendShortcut: saved.sendShortcut === 'ctrlEnter' ? 'ctrlEnter' : 'enter',
    chatTabMode: saved.chatTabMode === 'multi' ? 'multi' : 'single'
  };
}

export function sanitizeGroups(rawGroups: unknown): AssistantGroup[] {
  const timestamp = nowTs();
  let defaultGroup: AssistantGroup = {
    id: DEFAULT_GROUP_ID,
    name: 'Default',
    kind: 'default',
    createdAt: timestamp,
    updatedAt: timestamp
  };
  let deletedGroup: AssistantGroup = {
    id: DELETED_GROUP_ID,
    name: 'Deleted',
    kind: 'deleted',
    createdAt: timestamp,
    updatedAt: timestamp
  };
  if (!Array.isArray(rawGroups)) {
    return [defaultGroup, deletedGroup];
  }

  const customGroups: AssistantGroup[] = [];
  for (const item of rawGroups) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const value = item as Partial<AssistantGroup>;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!id || !name) {
      continue;
    }
    if (id === DEFAULT_GROUP_ID) {
      defaultGroup = {
        id: DEFAULT_GROUP_ID,
        name,
        kind: 'default',
        createdAt: typeof value.createdAt === 'number' ? value.createdAt : timestamp,
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : timestamp
      };
      continue;
    }
    if (id === DELETED_GROUP_ID) {
      deletedGroup = {
        id: DELETED_GROUP_ID,
        name,
        kind: 'deleted',
        createdAt: typeof value.createdAt === 'number' ? value.createdAt : timestamp,
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : timestamp
      };
      continue;
    }
    customGroups.push({
      id,
      name,
      kind: 'custom',
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : timestamp,
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : timestamp
    });
  }

  return [defaultGroup, ...customGroups, deletedGroup];
}

export function sanitizeAssistant(
  raw: unknown,
  settings: ChatBuddySettings,
  groupIds: Set<string>,
  timestamp: number
): AssistantProfile | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const source = raw as Partial<AssistantProfile> & { defaultModel?: string; bindProvider?: boolean; providerId?: string };
  const id = typeof source.id === 'string' && source.id.trim() ? source.id.trim() : createId('assistant');
  const isDeleted = source.isDeleted === true;
  const defaultGroupId = groupIds.has(DEFAULT_GROUP_ID) ? DEFAULT_GROUP_ID : [...groupIds][0] ?? DEFAULT_GROUP_ID;
  const normalizedGroupId = isDeleted
    ? DELETED_GROUP_ID
    : typeof source.groupId === 'string' && groupIds.has(source.groupId)
      ? source.groupId
      : defaultGroupId;
  const legacyModelId = normalizeModelId(source.defaultModel);
  const legacyProviderId =
    typeof source.providerId === 'string' && source.providerId.trim()
      ? source.providerId.trim()
      : settings.defaultModels.assistant?.providerId ?? settings.providers[0]?.id ?? '';
  const currentModelRef =
    typeof source.modelRef === 'string' && parseModelRef(source.modelRef)
      ? source.modelRef.trim()
      : legacyModelId && legacyProviderId
        ? createModelRef(legacyProviderId, legacyModelId)
        : getDefaultAssistantModelRef(settings);
  const enabledMcpServerIds = Array.isArray(source.enabledMcpServerIds)
    ? source.enabledMcpServerIds
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index)
        .filter((item) => settings.mcp.servers.some((server) => server.id === item))
    : [];
  const defaultAssistantName = resolveDefaultAssistantName(settings.locale);

  return {
    id,
    name: sanitizeAssistantName(typeof source.name === 'string' ? source.name : '') || defaultAssistantName,
    note: sanitizeAssistantName(typeof source.note === 'string' ? source.note : ''),
    avatar:
      typeof source.avatar === 'string' && /^[a-z0-9-]+$/i.test(source.avatar.trim())
        ? source.avatar.trim()
        : undefined,
    groupId: normalizedGroupId,
    systemPrompt:
      typeof source.systemPrompt === 'string' && source.systemPrompt.trim()
        ? source.systemPrompt
        : DEFAULT_ASSISTANT_SYSTEM_PROMPT,
    greeting: typeof source.greeting === 'string' ? source.greeting : '',
    questionPrefix: typeof source.questionPrefix === 'string' ? source.questionPrefix : '',
    modelRef: currentModelRef,
    temperature: clamp(source.temperature ?? settings.temperature, 0, 2, settings.temperature),
    topP: clamp(source.topP ?? settings.topP, 0, 1, settings.topP),
    maxTokens: clamp(source.maxTokens ?? 0, 0, 65535, 0),
    contextCount: clamp(source.contextCount ?? 16, 0, MAX_CONTEXT_COUNT, 16),
    presencePenalty: clamp(source.presencePenalty ?? settings.presencePenalty, -2, 2, settings.presencePenalty),
    frequencyPenalty: clamp(source.frequencyPenalty ?? settings.frequencyPenalty, -2, 2, settings.frequencyPenalty),
    streaming: typeof source.streaming === 'boolean' ? source.streaming : settings.streamingDefault,
    enabledMcpServerIds,
    pinned: isDeleted ? false : source.pinned === true,
    isDeleted,
    deletedAt: typeof source.deletedAt === 'number' ? source.deletedAt : undefined,
    originalGroupId:
      typeof source.originalGroupId === 'string' && groupIds.has(source.originalGroupId)
        ? source.originalGroupId
        : undefined,
    createdAt: typeof source.createdAt === 'number' ? source.createdAt : timestamp,
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : timestamp,
    lastInteractedAt:
      typeof source.lastInteractedAt === 'number'
        ? source.lastInteractedAt
        : typeof source.updatedAt === 'number'
          ? source.updatedAt
          : timestamp,
    overrides: source.overrides
  };
}

export function sanitizeSessions(rawSessions: unknown, assistantIds: Set<string>, untitledSessionTitle: string): ChatSession[] {
  if (!Array.isArray(rawSessions)) {
    return [];
  }

  const sessions: ChatSession[] = [];
  for (const item of rawSessions) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const session = item as Partial<ChatSession>;
    if (
      typeof session.id !== 'string' ||
      typeof session.assistantId !== 'string' ||
      !assistantIds.has(session.assistantId)
    ) {
      continue;
    }
    const rawTitle = typeof session.title === 'string' && session.title.trim() ? session.title : untitledSessionTitle;
    const normalizedTitleSource = normalizeTitleSource({
      title: rawTitle,
      titleSource: session.titleSource ?? 'default'
    }, untitledSessionTitle);
    const normalizedTitle =
      normalizedTitleSource === 'default' && LEGACY_UNTITLED_SESSION_TITLES.has(rawTitle)
        ? untitledSessionTitle
        : rawTitle;

    sessions.push({
      id: session.id,
      assistantId: session.assistantId,
      title: normalizedTitle,
      titleSource: normalizedTitleSource,
      createdAt: typeof session.createdAt === 'number' ? session.createdAt : nowTs(),
      updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : nowTs(),
      messages: Array.isArray(session.messages) ? [...(session.messages as ChatMessage[])] : []
    });
  }

  return sessions;
}

export function migrateAssistants(
  rawAssistants: unknown,
  settings: ChatBuddySettings,
  groupIds: Set<string>,
  timestamp: number
): AssistantProfile[] {
  if (!Array.isArray(rawAssistants)) {
    return [];
  }
  const assistants: AssistantProfile[] = [];
  for (const raw of rawAssistants) {
    const normalized = sanitizeAssistant(raw, settings, groupIds, timestamp);
    if (normalized) {
      assistants.push(normalized);
    }
  }
  const seen = new Set<string>();
  const deduped: AssistantProfile[] = [];
  for (const assistant of assistants) {
    if (seen.has(assistant.id)) {
      continue;
    }
    seen.add(assistant.id);
    deduped.push(assistant);
  }
  return deduped;
}

// ─── Initial state ────────────────────────────────────────────────────────────

export function createInitialState(): PersistedStateLite {
  const timestamp = nowTs();
  const groups = createSystemGroups(timestamp);
  const settings = sanitizeSettings(undefined);
  return {
    groups,
    assistants: [],
    selectedAssistantId: undefined,
    selectedSessionIdByAssistant: {},
    sessionPanelCollapsed: false,
    settings
  };
}
