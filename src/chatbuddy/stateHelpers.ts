/**
 * 状态辅助工具模块。
 *
 * 提供状态转换、默认值解析、模型引用处理等辅助函数，
 * 以及备份数据解包和会话标题生成工具。
 */
import { createModelRef, dedupeModels, parseModelRef } from './modelCatalog';
import type { StructuredStateDocument } from './compassStorage';
import { COMPASS_LAYOUT_VERSION } from './compassStorage';
import { cloneProvider } from './stateClone';
import { warn } from './utils';
import type {
  ChatBuddySettings,
  ModelBinding,
  PersistedState,
  ProviderKind,
  ProviderProfile
} from './types';

// ─── Resolve helpers ─────────────────────────────────────────────────────────

export function resolveUntitledSessionTitle(locale: ChatBuddySettings['locale'] | undefined): string {
  return (!locale || locale === 'zh-CN') ? '新会话' : 'New Session';
}

export function resolveDefaultAssistantName(locale: ChatBuddySettings['locale'] | undefined): string {
  return (!locale || locale === 'zh-CN') ? '新建助手' : 'New Assistant';
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
  } catch (err) {
    warn('Error parsing provider API keys:', err);
    return {};
  }
}

// ─── Import helpers ──────────────────────────────────────────────────────────

const LEGACY_BACKUP_SCHEMA = 'chatbuddy.backup';
const COMPASS_BACKUP_SCHEMA = 'chatbuddy.backup.compass';
const BACKUP_VERSION = 2;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizePreservedStringMap(input: unknown): Record<string, string> {
  if (!isRecord(input)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string') {
      continue;
    }
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      continue;
    }
    result[normalizedKey] = value;
  }
  return result;
}

export function normalizeTrimmedStringMap(input: unknown): Record<string, string> {
  const result = normalizePreservedStringMap(input);
  for (const [key, value] of Object.entries(result)) {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      delete result[key];
      continue;
    }
    result[key] = normalizedValue;
  }
  return result;
}

export function looksLikePersistedState(value: unknown): value is PersistedState | Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const keys = ['groups', 'assistants', 'sessions', 'settings', 'selectedAssistantId', 'selectedSessionIdByAssistant'];
  return keys.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function looksLikeStructuredStateDocument(value: unknown): value is StructuredStateDocument {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isRecord(value.core) &&
    isRecord(value.ui) &&
    isRecord(value.settingsGeneral) &&
    isRecord(value.settingsModelConfig) &&
    isRecord(value.settingsDefaultModels) &&
    isRecord(value.settingsMcp)
  );
}

/**
 * 对 `StructuredStateDocument` 进行深度 shape 校验。
 *
 * `looksLikeStructuredStateDocument` 仅校验顶层字段是否为对象，
 * 无法发现「字段存在但类型错误」的损坏情况——后续 `.map()` 会在运行时抛出
 * 难以追踪的异常。此函数在解包层补齐关键嵌套字段（数组/对象）的校验，
 * 失败时抛出包含具体字段路径的清晰错误，便于上层定位损坏来源。
 */
function assertStructuredStateDocumentShape(document: unknown): void {
  if (!isRecord(document)) {
    throw new Error('structuredState is not an object');
  }
  const core = document.core;
  if (!isRecord(core)) {
    throw new Error('structuredState.core is missing or not an object');
  }
  if (!Array.isArray(core.groups)) {
    throw new Error('structuredState.core.groups is missing or not an array');
  }
  if (!Array.isArray(core.assistants)) {
    throw new Error('structuredState.core.assistants is missing or not an array');
  }
  if (core.templates !== undefined && !Array.isArray(core.templates)) {
    throw new Error('structuredState.core.templates must be an array when present');
  }

  const ui = document.ui;
  if (!isRecord(ui)) {
    throw new Error('structuredState.ui is missing or not an object');
  }
  if (!isRecord(ui.selectedSessionIdByAssistant)) {
    throw new Error('structuredState.ui.selectedSessionIdByAssistant is missing or not an object');
  }
  if (!Array.isArray(ui.collapsedGroupIds)) {
    throw new Error('structuredState.ui.collapsedGroupIds is missing or not an array');
  }

  if (!isRecord(document.settingsGeneral)) {
    throw new Error('structuredState.settingsGeneral is missing or not an object');
  }

  const modelConfig = document.settingsModelConfig;
  if (!isRecord(modelConfig)) {
    throw new Error('structuredState.settingsModelConfig is missing or not an object');
  }
  if (!Array.isArray(modelConfig.providers)) {
    throw new Error('structuredState.settingsModelConfig.providers is missing or not an array');
  }

  const defaultModels = document.settingsDefaultModels;
  if (!isRecord(defaultModels)) {
    throw new Error('structuredState.settingsDefaultModels is missing or not an object');
  }
  if (!isRecord(defaultModels.defaultModels)) {
    throw new Error('structuredState.settingsDefaultModels.defaultModels is missing or not an object');
  }

  const settingsMcp = document.settingsMcp;
  if (!isRecord(settingsMcp)) {
    throw new Error('structuredState.settingsMcp is missing or not an object');
  }
  if (!isRecord(settingsMcp.mcp)) {
    throw new Error('structuredState.settingsMcp.mcp is missing or not an object');
  }
}

export type ImportedCompassStorageBackup = {
  structuredState: StructuredStateDocument;
  providerApiKeys: Record<string, string>;
  sessions: PersistedState['sessions'];
  kv: Record<string, string>;
};

export function unwrapImportedStorageBackup(input: unknown): ImportedCompassStorageBackup | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const schema = typeof input.schema === 'string' ? input.schema : '';
  if (schema !== COMPASS_BACKUP_SCHEMA) {
    return undefined;
  }
  const version = Number(input.version);
  if (!Number.isFinite(version) || version < 2 || version > BACKUP_VERSION) {
    return undefined;
  }
  if (!isRecord(input.storage)) {
    return undefined;
  }
  const storage = input.storage;
  if (
    storage.layout !== 'compass' ||
    Number(storage.layoutVersion) > COMPASS_LAYOUT_VERSION ||
    !looksLikeStructuredStateDocument(storage.structuredState) ||
    !Array.isArray(storage.sessions)
  ) {
    return undefined;
  }
  // structuredState 已通过顶层 shape 检查，此处对关键字段进行深度校验。
  // 若结构损坏，抛出包含具体字段路径的错误，避免后续 `.map()` 抛出难追踪的异常；
  // 上层 import 流程应捕获并将失败原因反馈给用户。
  assertStructuredStateDocumentShape(storage.structuredState);
  return {
    structuredState: storage.structuredState,
    providerApiKeys: normalizeTrimmedStringMap(storage.providerApiKeys),
    sessions: storage.sessions as PersistedState['sessions'],
    kv: normalizePreservedStringMap(storage.kv)
  };
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
  const schema = typeof input.schema === 'string' ? input.schema : '';
  if (schema !== LEGACY_BACKUP_SCHEMA && schema !== COMPASS_BACKUP_SCHEMA) {
    return undefined;
  }
  const version = Number(input.version);
  if (!Number.isFinite(version) || version > BACKUP_VERSION) {
    return undefined;
  }
  if (looksLikePersistedState(input.state)) {
    return input.state;
  }
  if (looksLikePersistedState(input.data)) {
    return input.data;
  }
  return undefined;
}
