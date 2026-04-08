import { createModelRef, dedupeModels, parseModelRef } from './modelCatalog';
import { cloneProvider } from './stateClone';
import { PersistedStateLiteSchema } from './schemas';
import { warn } from './utils';
import type {
  ChatBuddySettings,
  ModelBinding,
  PersistedState,
  PersistedStateLite,
  ProviderKind,
  ProviderProfile
} from './types';

// ─── Resolve helpers ─────────────────────────────────────────────────────────

export function resolveUntitledSessionTitle(locale: ChatBuddySettings['locale'] | undefined): string {
  return (!locale || locale === 'zh-CN') ? '新会话' : 'New Chat';
}

export function resolveDefaultAssistantName(locale: ChatBuddySettings['locale'] | undefined): string {
  return (!locale || locale === 'zh-CN') ? '新的助手' : 'New Assistant';
}

export function normalizeTitleSource(session: { title: string; titleSource?: string }, untitledTitle: string): 'default' | 'generated' | 'custom' {
  if (session.titleSource === 'generated' || session.titleSource === 'custom') {
    return session.titleSource;
  }
  return session.title === untitledTitle ? 'default' : 'custom';
}

export function getDefaultAssistantModelRef(settings: ChatBuddySettings): string {
  const binding = settings.defaultModels.assistant;
  return binding ? createModelRef(binding.providerId, binding.modelId) : '';
}

export function inferProviderKind(raw: Partial<ProviderProfile> & { defaultModel?: string }, id: string): ProviderKind {
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

// ─── System groups ────────────────────────────────────────────────────────────

export function createSystemGroups(timestamp: number): AssistantGroup[] {
  return [
    { id: DEFAULT_GROUP_ID, name: 'Default', kind: 'default', createdAt: timestamp, updatedAt: timestamp },
    { id: DELETED_GROUP_ID, name: 'Deleted', kind: 'deleted', createdAt: timestamp, updatedAt: timestamp }
  ];
}

import type { AssistantGroup } from './types';
import { DEFAULT_GROUP_ID, DELETED_GROUP_ID } from './constants';

// ─── Provider helpers ────────────────────────────────────────────────────────

export function addModelToProvider(providers: ProviderProfile[], providerId: string, modelId: string): ProviderProfile[] {
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

export function mergeModelBindingsIntoProviders(
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

// ─── Parsing ───────────────────────────────────────────────────────────────────

export function parseProviderApiKeysSecret(raw: string | undefined): Record<string, string> {
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

export function parseProviderApiKeysStore(raw: string | undefined): Record<string, string> {
  return parseProviderApiKeysSecret(raw);
}

export function parsePersistedStateLiteStore(raw: string | undefined): PersistedStateLite | Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }
    const result = PersistedStateLiteSchema.safeParse(parsed);
    if (!result.success) {
      warn('Persisted state validation failed:', result.error.message);
      return parsed as Record<string, unknown>;
    }
    return result.data as unknown as PersistedStateLite;
  } catch {
    return undefined;
  }
}

// ─── Import helpers ──────────────────────────────────────────────────────────

const BACKUP_SCHEMA = 'chatbuddy.backup';
const BACKUP_VERSION = 1;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function looksLikePersistedState(value: unknown): value is PersistedState | Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const keys = ['groups', 'assistants', 'sessions', 'settings', 'selectedAssistantId', 'selectedSessionIdByAssistant'];
  return keys.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function unwrapImportedState(input: unknown): PersistedState | Record<string, unknown> | undefined {
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
