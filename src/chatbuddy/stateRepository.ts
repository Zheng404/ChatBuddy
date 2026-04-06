import * as vscode from 'vscode';

import { DEFAULT_GROUP_ID, DELETED_GROUP_ID } from './constants';
import { getDefaultSessionTitle, getStrings, resolveLocale } from './i18n';
import {
  cloneDefaultModels,
  createEmptyDefaultModels,
  createModelRef,
  dedupeModels,
  getProviderModelOptions,
  normalizeApiType,
  parseModelRef,
  resolveModelOption
} from './modelCatalog';
import { isValidModelName, isValidUrl, sanitizeAssistantName, sanitizeGroupName } from './security';
import { createId, nowTs } from './utils';
import {
  AssistantGroup,
  AssistantProfile,
  ChatBuddyLocaleSetting,
  ChatBuddySettings,
  ChatMessage,
  ChatSession,
  ChatSessionDetail,
  ChatSessionSummary,
  DefaultModelSettings,
  ModelBinding,
  McpKeyValueEntry,
  McpServerProfile,
  McpSettings,
  PersistedState,
  PersistedStateLite,
  ProviderKind,
  ProviderModelOption,
  ProviderProfile
} from './types';
import { ChatStorage } from './chatStorage';

const SQLITE_STATE_KEY = 'chatbuddy.sqlite.state.v1';
const SQLITE_PROVIDER_API_KEYS_KEY = 'chatbuddy.sqlite.providerApiKeys.v1';
const BACKUP_SCHEMA = 'chatbuddy.backup';
const BACKUP_VERSION = 1;
const MAX_CONTEXT_COUNT = Number.MAX_SAFE_INTEGER;
const LEGACY_UNTITLED_SESSION_TITLES = new Set(['新会话', 'New Chat']);

const DEFAULT_SETTINGS: ChatBuddySettings = {
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

const DEFAULT_ASSISTANT_SYSTEM_PROMPT = '';

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function resolveUntitledSessionTitle(localeSetting: ChatBuddyLocaleSetting | undefined): string {
  const locale = resolveLocale(localeSetting, vscode.env.language);
  return getDefaultSessionTitle(locale);
}

function resolveDefaultAssistantName(localeSetting: ChatBuddyLocaleSetting | undefined): string {
  const locale = resolveLocale(localeSetting, vscode.env.language);
  const roleName = getStrings(locale).assistantRole;
  if (typeof roleName === 'string' && roleName.trim()) {
    return roleName.trim();
  }
  return locale === 'zh-CN' ? '助手' : 'Assistant';
}

function normalizeTitleSource(session: ChatSession, untitledSessionTitle: string): ChatSession['titleSource'] {
  if (session.titleSource === 'default' || session.titleSource === 'generated' || session.titleSource === 'custom') {
    return session.titleSource;
  }
  if (
    session.messages.length === 0 &&
    (session.title === untitledSessionTitle || LEGACY_UNTITLED_SESSION_TITLES.has(session.title))
  ) {
    return 'default';
  }
  return 'custom';
}

function createSystemGroups(timestamp: number): AssistantGroup[] {
  return [
    {
      id: DEFAULT_GROUP_ID,
      name: 'Default',
      kind: 'default',
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: DELETED_GROUP_ID,
      name: 'Deleted',
      kind: 'deleted',
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
}

function cloneProvider(provider: ProviderProfile): ProviderProfile {
  return {
    ...provider,
    models: provider.models.map((model) => ({ ...model }))
  };
}

function cloneGroup(group: AssistantGroup): AssistantGroup {
  return {
    ...group
  };
}

function cloneAssistant(assistant: AssistantProfile): AssistantProfile {
  return {
    ...assistant,
    enabledMcpServerIds: [...assistant.enabledMcpServerIds],
    overrides: assistant.overrides ? { ...assistant.overrides } : undefined
  };
}

function cloneMcpKeyValueEntries(entries: McpKeyValueEntry[]): McpKeyValueEntry[] {
  return entries.map((entry) => ({
    key: entry.key,
    value: entry.value
  }));
}

function cloneMcpServer(server: McpServerProfile): McpServerProfile {
  return {
    ...server,
    args: [...server.args],
    env: cloneMcpKeyValueEntries(server.env),
    headers: cloneMcpKeyValueEntries(server.headers)
  };
}

function cloneMcpSettings(settings: McpSettings): McpSettings {
  return {
    maxToolRounds: settings.maxToolRounds,
    servers: settings.servers.map(cloneMcpServer)
  };
}

function cloneSession(session: ChatSession): ChatSession {
  return {
    ...session,
    messages: [...session.messages]
  };
}

function cloneSessionSummary(session: ChatSessionSummary): ChatSessionSummary {
  return {
    ...session
  };
}

function normalizeProviderBaseUrl(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  if (!normalized) {
    return fallback;
  }
  return isValidUrl(normalized) ? normalized : fallback;
}

function normalizeModelId(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  if (!normalized) {
    return fallback;
  }
  return isValidModelName(normalized) ? normalized : fallback;
}

function normalizeModelBinding(value: unknown): ModelBinding | undefined {
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

function normalizeMcpKeyValueEntries(value: unknown): McpKeyValueEntry[] {
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

function sanitizeMcpServer(raw: unknown): McpServerProfile | undefined {
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

function sanitizeMcpSettings(raw: unknown): McpSettings {
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

function addModelToProvider(providers: ProviderProfile[], providerId: string, modelId: string): ProviderProfile[] {
  if (!providerId || !modelId) {
    return providers;
  }
  return providers.map((provider) => {
    if (provider.id !== providerId) {
      return provider;
    }
    return {
      ...provider,
      models: dedupeModels([...provider.models, { id: modelId, name: modelId }])
    };
  });
}

function mergeModelBindingsIntoProviders(
  providers: ProviderProfile[],
  bindings: Array<ModelBinding | undefined>,
  refs: string[] = []
): ProviderProfile[] {
  let next = providers.map(cloneProvider);
  for (const binding of bindings) {
    if (!binding) {
      continue;
    }
    next = addModelToProvider(next, binding.providerId, binding.modelId);
  }
  for (const ref of refs) {
    const parsed = parseModelRef(ref);
    if (!parsed) {
      continue;
    }
    next = addModelToProvider(next, parsed.providerId, parsed.modelId);
  }
  return next;
}

function parseProviderApiKeysSecret(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        continue;
      }
      const providerId = key.trim();
      const apiKey = value.trim();
      if (providerId && apiKey) {
        result[providerId] = apiKey;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function parseProviderApiKeysStore(raw: string | undefined): Record<string, string> {
  return parseProviderApiKeysSecret(raw);
}

function parsePersistedStateLiteStore(raw: string | undefined): PersistedStateLite | Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }
    return parsed as PersistedStateLite | Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function inferProviderKind(raw: Partial<ProviderProfile> & { defaultModel?: string }, id: string): ProviderKind {
  if (raw.kind === 'openai' || raw.kind === 'gemini' || raw.kind === 'openrouter' || raw.kind === 'ollama') {
    return raw.kind;
  }
  const normalizedId = id.toLowerCase();
  const normalizedName = typeof raw.name === 'string' ? raw.name.toLowerCase() : '';
  const normalizedBaseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.toLowerCase() : '';
  if (normalizedId === 'openai' || normalizedName.includes('openai') || normalizedBaseUrl.includes('api.openai.com')) {
    return 'openai';
  }
  if (
    normalizedId === 'gemini' ||
    normalizedName.includes('gemini') ||
    normalizedBaseUrl.includes('generativelanguage.googleapis.com')
  ) {
    return 'gemini';
  }
  if (
    normalizedId === 'openrouter' ||
    normalizedName.includes('openrouter') ||
    normalizedBaseUrl.includes('openrouter.ai')
  ) {
    return 'openrouter';
  }
  if (
    normalizedId === 'ollama' ||
    normalizedName.includes('ollama') ||
    normalizedBaseUrl.includes('127.0.0.1:11434') ||
    normalizedBaseUrl.includes('/api/tags')
  ) {
    return 'ollama';
  }
  return 'custom';
}

function sanitizeProviders(input: unknown): ProviderProfile[] {
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

function sanitizeDefaultModels(raw: unknown, legacyAssistantBinding?: ModelBinding): DefaultModelSettings {
  const source = raw && typeof raw === 'object' ? (raw as Partial<DefaultModelSettings>) : {};
  return {
    assistant: normalizeModelBinding(source.assistant) ?? legacyAssistantBinding,
    titleSummary: normalizeModelBinding(source.titleSummary),
    titleSummaryPrompt: typeof source.titleSummaryPrompt === 'string' ? source.titleSummaryPrompt.trim() || undefined : undefined
  };
}

function sanitizeSettings(raw: unknown): ChatBuddySettings {
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

function sanitizeGroups(rawGroups: unknown): AssistantGroup[] {
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

function getDefaultAssistantModelRef(settings: ChatBuddySettings): string {
  const binding = settings.defaultModels.assistant;
  return binding ? createModelRef(binding.providerId, binding.modelId) : '';
}

function sanitizeAssistant(
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

function migrateAssistants(
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

function sanitizeSessions(rawSessions: unknown, assistantIds: Set<string>, untitledSessionTitle: string): ChatSession[] {
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
      id: session.id,
      assistantId: session.assistantId,
      title: rawTitle,
      titleSource: session.titleSource ?? 'default',
      createdAt: typeof session.createdAt === 'number' ? session.createdAt : nowTs(),
      updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : nowTs(),
      messages: Array.isArray(session.messages) ? (session.messages as ChatMessage[]) : []
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

function createInitialState(): PersistedStateLite {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function looksLikePersistedState(value: unknown): value is PersistedState | Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const keys = ['groups', 'assistants', 'sessions', 'settings', 'selectedAssistantId', 'selectedSessionIdByAssistant'];
  return keys.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function unwrapImportedState(input: unknown): PersistedState | Record<string, unknown> | undefined {
  if (looksLikePersistedState(input)) {
    return input;
  }
  if (!isRecord(input)) {
    return undefined;
  }
  if (looksLikePersistedState(input.state)) {
    return input.state;
  }
  if (looksLikePersistedState(input.data)) {
    return input.data;
  }
  if (input.schema !== BACKUP_SCHEMA) {
    return undefined;
  }
  const version = Number(input.version);
  if (!Number.isFinite(version) || version > BACKUP_VERSION) {
    return undefined;
  }
  return undefined;
}

export interface ChatBuddyBackupData {
  schema: typeof BACKUP_SCHEMA;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  state: PersistedState;
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
  private state: PersistedStateLite;
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
    await this.persistSecrets();
    await this.persist();
  }

  public getState(): PersistedStateLite {
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

  public getMcpServers(): McpServerProfile[] {
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
      throw new Error(locale === 'zh-CN' ? '助手不存在' : 'Assistant not found');
    }
    if (assistant.isDeleted) {
      throw new Error(locale === 'zh-CN' ? '已删除助手无法创建会话' : 'Cannot create session for deleted assistant');
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
    saved: PersistedState | PersistedStateLite | Record<string, unknown> | undefined
  ): { state: PersistedStateLite; sessions: ChatSessionDetail[] } {
    if (!saved) {
      return {
        state: createInitialState(),
        sessions: []
      };
    }
    const timestamp = nowTs();
    const source = saved as Partial<PersistedState & PersistedStateLite>;
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
    const sessions = sanitizeSessions((source as Partial<PersistedState>).sessions, assistantIds, untitledSessionTitle);
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

  private queuePersist(task: () => Promise<void>): Promise<void> {
    const run = this.persistQueue.then(task, task);
    this.persistQueue = run.catch((error) => {
      console.error('[ChatBuddy] Persist queue error:', error);
    });
    return run;
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
      const persistedState: PersistedStateLite = {
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
