import { cloneProvider } from './stateClone';
import {
  mergeModelBindingsIntoProviders,
  resolveUntitledSessionTitle
} from './stateHelpers';
import {
  createInitialState,
  migrateAssistants,
  sanitizeGroups,
  sanitizeSessions,
  sanitizeSettings
} from './stateSanitizers';
import { ChatStorage } from './chatStorage';
import { nowTs } from './utils';
import {
  ChatBuddyLocaleSetting,
  ChatBuddySettings,
  ChatSessionDetail,
  PersistedState,
  PersistedStateLite,
  ProviderProfile
} from './types';

const LEGACY_UNTITLED_SESSION_TITLES = new Set(['新会话', 'New Chat']);

export function extractProviderApiKeys(providers: ProviderProfile[]): Record<string, string> {
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

export function applyProviderApiKeysToSettings(
  apiKeys: Record<string, string>,
  settings: ChatBuddySettings
): ChatBuddySettings {
  return {
    ...settings,
    providers: settings.providers.map((provider) => ({
      ...cloneProvider(provider),
      apiKey: apiKeys[provider.id] ?? ''
    }))
  };
}

export function mergePersistedState(
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
  const sessions = sanitizeSessions(
    (source as Partial<PersistedState>).sessions,
    assistantIds,
    untitledSessionTitle
  );
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
      collapsedGroupIds: source.collapsedGroupIds ?? [],
      settings
    },
    sessions
  };
}

export function normalizeLocalizedDefaultTitles(
  storage: ChatStorage,
  localeSetting: ChatBuddyLocaleSetting | undefined
): void {
  const untitledSessionTitle = resolveUntitledSessionTitle(localeSetting);
  const sessions = storage.listAllSessions();
  for (const session of sessions) {
    if (session.titleSource !== 'default') {
      continue;
    }
    const title = session.title.trim();
    if (!title || LEGACY_UNTITLED_SESSION_TITLES.has(title)) {
      if (session.title === untitledSessionTitle) {
        continue;
      }
      storage.renameSession(session.assistantId, session.id, untitledSessionTitle, 'default', session.updatedAt);
    }
  }
}

export function normalizeTitleSourceConsistency(
  storage: ChatStorage,
  localeSetting: ChatBuddyLocaleSetting | undefined
): void {
  const untitledSessionTitle = resolveUntitledSessionTitle(localeSetting);
  const sessions = storage.listAllSessions();
  for (const session of sessions) {
    if (session.titleSource === 'default') {
      continue;
    }
    const title = session.title.trim();
    if (!title || title === untitledSessionTitle || LEGACY_UNTITLED_SESSION_TITLES.has(title)) {
      storage.renameSession(
        session.assistantId,
        session.id,
        title || untitledSessionTitle,
        'default',
        session.updatedAt
      );
    }
  }
}
