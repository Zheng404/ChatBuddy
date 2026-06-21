/**
 * Compass 结构化设置存储模块。
 *
 * 管理 6 个独立的结构化状态 JSON 文件的读写、
 * `PersistedStateLite` 与 `StructuredStateDocument` 的双向转换、
 * 以及 API Key 的隔离存储。
 *
 * 支持从旧版单文件 Compass payload 和 VS Code globalState 的向后兼容。
 */
import { ChatBuddySettings, PersistedStateLite, ProviderModelProfile, ProviderProfile } from '../types';
import { createInitialState } from '../stateSanitizers';
import { warn, error } from '../utils';
import { readJsonFileSafe, readTextFile, removeFileIfExists, writeJsonAtomic, writeTextAtomic, createPrePersistSnapshot, restoreFromSnapshot } from './io';
import { COMPASS_LAYOUT_VERSION, CompassPaths } from './paths';
import {
  StructuredSettingsDefaultModelsFile,
  StructuredSettingsGeneralFile,
  StructuredSettingsMcpFile,
  StructuredSettingsModelConfigFile,
  StructuredStateCommitFile,
  StructuredStateCoreFile,
  StructuredStateDocument,
  StructuredUiSelectionFile
} from './types';

type SettingsSnapshotMode = 'empty' | 'legacy' | 'structured';

type SettingsSnapshotValidationResult = {
  valid: boolean;
  reason?: string;
  mode: SettingsSnapshotMode;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw || !raw.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch (err) {
    warn('Error parsing settings JSON:', err);
    return undefined;
  }
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function normalizeProviderApiKeys(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [providerId, apiKey] of Object.entries(raw)) {
    if (typeof apiKey !== 'string') {
      continue;
    }
    const normalizedProviderId = providerId.trim();
    const normalizedApiKey = apiKey.trim();
    if (!normalizedProviderId || !normalizedApiKey) {
      continue;
    }
    result[normalizedProviderId] = normalizedApiKey;
  }
  return result;
}

/**
 * 比较两个 `Record<string, string>` 是否在键集合与对应值上等价（与键顺序无关）。
 *
 * 不能用 `JSON.stringify(a) !== JSON.stringify(b)` 直接比较——对象键的枚举顺序
 * 不同会导致无意义的 dirty 判定，触发不必要的持久化写入。
 */
function providerApiKeysEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

function cloneProviderModel(model: ProviderModelProfile): ProviderModelProfile {
  return {
    ...model,
    capabilities: model.capabilities ? { ...model.capabilities } : undefined,
    userCapabilitiesOverride: model.userCapabilitiesOverride ? { ...model.userCapabilitiesOverride } : undefined
  };
}

function cloneProvider(provider: ProviderProfile): ProviderProfile {
  return {
    ...provider,
    models: provider.models.map(cloneProviderModel)
  };
}

function stripProviderSecret(provider: ProviderProfile): ProviderProfile {
  return {
    ...cloneProvider(provider),
    apiKey: ''
  };
}

function cloneStateCore(core: StructuredStateCoreFile): StructuredStateCoreFile {
  return {
    groups: core.groups.map((group) => ({ ...group })),
    assistants: core.assistants.map((assistant) => ({
      ...assistant,
      enabledMcpServerIds: [...assistant.enabledMcpServerIds],
      overrides: assistant.overrides ? { ...assistant.overrides } : undefined
    })),
    templates: core.templates ? core.templates.map((t) => ({ ...t })) : undefined
  };
}

function cloneUiSelection(ui: StructuredUiSelectionFile): StructuredUiSelectionFile {
  return {
    selectedAssistantId: ui.selectedAssistantId,
    selectedSessionIdByAssistant: { ...ui.selectedSessionIdByAssistant },
    sessionPanelCollapsed: ui.sessionPanelCollapsed,
    collapsedGroupIds: [...ui.collapsedGroupIds]
  };
}

function cloneSettingsGeneral(general: StructuredSettingsGeneralFile): StructuredSettingsGeneralFile {
  return { ...general };
}

function cloneSettingsModelConfig(config: StructuredSettingsModelConfigFile): StructuredSettingsModelConfigFile {
  return {
    providers: config.providers.map(cloneProvider)
  };
}

function cloneSettingsDefaultModels(defaultModels: StructuredSettingsDefaultModelsFile): StructuredSettingsDefaultModelsFile {
  return {
    defaultModels: {
      assistant: defaultModels.defaultModels.assistant ? { ...defaultModels.defaultModels.assistant } : undefined,
      titleSummary: defaultModels.defaultModels.titleSummary ? { ...defaultModels.defaultModels.titleSummary } : undefined,
      titleSummaryPrompt: defaultModels.defaultModels.titleSummaryPrompt
    }
  };
}

function cloneSettingsMcp(mcp: StructuredSettingsMcpFile): StructuredSettingsMcpFile {
  return {
    mcp: {
      ...mcp.mcp,
      servers: mcp.mcp.servers.map((server) => ({
        ...server,
        args: [...server.args],
        env: server.env.map((entry) => ({ ...entry })),
        headers: server.headers.map((entry) => ({ ...entry }))
      })),
      groups: (mcp.mcp.groups || []).map((group) => ({ ...group }))
    }
  };
}

function cloneStructuredStateCommit(commit: StructuredStateCommitFile): StructuredStateCommitFile {
  return { ...commit };
}

function isStructuredStateCommitFile(value: unknown): value is StructuredStateCommitFile {
  return (
    isRecord(value) &&
    value.name === 'compass-structured-state' &&
    typeof value.writtenAt === 'string' &&
    value.writtenAt.trim().length > 0 &&
    typeof value.layoutVersion === 'number' &&
    Number.isFinite(value.layoutVersion) &&
    typeof value.generation === 'number' &&
    Number.isInteger(value.generation) &&
    value.generation >= 1
  );
}

function isStructuredStateCoreFile(value: unknown): value is StructuredStateCoreFile {
  return isRecord(value) && Array.isArray(value.groups) && Array.isArray(value.assistants);
}

function isStructuredUiSelectionFile(value: unknown): value is StructuredUiSelectionFile {
  return (
    isRecord(value) &&
    isRecord(value.selectedSessionIdByAssistant) &&
    Array.isArray(value.collapsedGroupIds) &&
    typeof value.sessionPanelCollapsed === 'boolean'
  );
}

function isStructuredSettingsGeneralFile(value: unknown): value is StructuredSettingsGeneralFile {
  return isRecord(value);
}

function isStructuredSettingsModelConfigFile(value: unknown): value is StructuredSettingsModelConfigFile {
  return isRecord(value) && Array.isArray(value.providers);
}

function isStructuredSettingsDefaultModelsFile(value: unknown): value is StructuredSettingsDefaultModelsFile {
  return isRecord(value) && isRecord(value.defaultModels);
}

function isStructuredSettingsMcpFile(value: unknown): value is StructuredSettingsMcpFile {
  return isRecord(value) && isRecord(value.mcp);
}

function looksLikePersistedStateLite(value: unknown): value is PersistedStateLite {
  if (!isRecord(value)) {
    return false;
  }
  return Array.isArray(value.groups) && Array.isArray(value.assistants) && isRecord(value.settings);
}

function clonePersistedStateLite(state: PersistedStateLite): PersistedStateLite {
  return structuredStateDocumentToPersistedStateLite(persistedStateLiteToStructuredStateDocument(state));
}

function toPersistedStateLiteForStorage(
  raw: Record<string, unknown>,
  fallbackState?: PersistedStateLite
): PersistedStateLite {
  const base = fallbackState ? clonePersistedStateLite(fallbackState) : createInitialState();
  const source = raw as Partial<PersistedStateLite> & { settings?: Partial<ChatBuddySettings> };
  const settings: Partial<ChatBuddySettings> = isRecord(source.settings)
    ? (source.settings as Partial<ChatBuddySettings>)
    : {};
  return {
    groups: Array.isArray(source.groups) ? (source.groups as PersistedStateLite['groups']) : base.groups,
    assistants: Array.isArray(source.assistants) ? (source.assistants as PersistedStateLite['assistants']) : base.assistants,
    selectedAssistantId: typeof source.selectedAssistantId === 'string' ? source.selectedAssistantId : base.selectedAssistantId,
    selectedSessionIdByAssistant: isRecord(source.selectedSessionIdByAssistant)
      ? Object.fromEntries(
          Object.entries(source.selectedSessionIdByAssistant)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            .map(([assistantId, sessionId]) => [assistantId, sessionId])
        )
      : base.selectedSessionIdByAssistant,
    sessionPanelCollapsed:
      typeof source.sessionPanelCollapsed === 'boolean' ? source.sessionPanelCollapsed : base.sessionPanelCollapsed,
    collapsedGroupIds: Array.isArray(source.collapsedGroupIds)
      ? source.collapsedGroupIds.filter((groupId): groupId is string => typeof groupId === 'string')
      : base.collapsedGroupIds,
    templates: Array.isArray(source.templates)
      ? source.templates
      : base.templates,
    settings: {
      ...base.settings,
      providers: Array.isArray(settings.providers)
        ? (settings.providers as PersistedStateLite['settings']['providers'])
        : base.settings.providers,
      defaultModels: isRecord(settings.defaultModels)
        ? (settings.defaultModels as PersistedStateLite['settings']['defaultModels'])
        : base.settings.defaultModels,
      mcp: isRecord(settings.mcp) ? (settings.mcp as PersistedStateLite['settings']['mcp']) : base.settings.mcp,
      temperature: typeof settings.temperature === 'number' ? settings.temperature : base.settings.temperature,
      topP: typeof settings.topP === 'number' ? settings.topP : base.settings.topP,
      maxTokens: typeof settings.maxTokens === 'number' ? settings.maxTokens : base.settings.maxTokens,
      presencePenalty:
        typeof settings.presencePenalty === 'number' ? settings.presencePenalty : base.settings.presencePenalty,
      frequencyPenalty:
        typeof settings.frequencyPenalty === 'number' ? settings.frequencyPenalty : base.settings.frequencyPenalty,
      timeoutMs: typeof settings.timeoutMs === 'number' ? settings.timeoutMs : base.settings.timeoutMs,
      streamingDefault:
        typeof settings.streamingDefault === 'boolean' ? settings.streamingDefault : base.settings.streamingDefault,
      locale:
        settings.locale === 'auto' || settings.locale === 'zh-CN' || settings.locale === 'en'
          ? settings.locale
          : base.settings.locale,
      sendShortcut: settings.sendShortcut === 'ctrlEnter' ? 'ctrlEnter' : 'enter',
      chatTabMode: settings.chatTabMode === 'multi' ? 'multi' : 'single',
      localBackup: settings.localBackup ?? base.settings.localBackup
    }
  };
}

export function persistedStateLiteToStructuredStateDocument(state: PersistedStateLite): StructuredStateDocument {
  return {
    core: {
      groups: state.groups.map((group) => ({ ...group })),
      assistants: state.assistants.map((assistant) => ({
        ...assistant,
        enabledMcpServerIds: [...assistant.enabledMcpServerIds],
        overrides: assistant.overrides ? { ...assistant.overrides } : undefined
      })),
      templates: state.templates?.map((t) => ({ ...t }))
    },
    ui: {
      selectedAssistantId: state.selectedAssistantId,
      selectedSessionIdByAssistant: { ...state.selectedSessionIdByAssistant },
      sessionPanelCollapsed: state.sessionPanelCollapsed,
      collapsedGroupIds: [...state.collapsedGroupIds]
    },
    settingsGeneral: {
      temperature: state.settings.temperature,
      topP: state.settings.topP,
      maxTokens: state.settings.maxTokens,
      presencePenalty: state.settings.presencePenalty,
      frequencyPenalty: state.settings.frequencyPenalty,
      timeoutMs: state.settings.timeoutMs,
      streamingDefault: state.settings.streamingDefault,
      locale: state.settings.locale,
      sendShortcut: state.settings.sendShortcut,
      chatTabMode: state.settings.chatTabMode,
      localBackup: state.settings.localBackup
    },
    settingsModelConfig: {
      providers: state.settings.providers.map(stripProviderSecret)
    },
    settingsDefaultModels: {
      defaultModels: {
        assistant: state.settings.defaultModels.assistant ? { ...state.settings.defaultModels.assistant } : undefined,
        titleSummary: state.settings.defaultModels.titleSummary
          ? { ...state.settings.defaultModels.titleSummary }
          : undefined,
        titleSummaryPrompt: state.settings.defaultModels.titleSummaryPrompt
      }
    },
    settingsMcp: {
      mcp: {
        ...state.settings.mcp,
        servers: state.settings.mcp.servers.map((server) => ({
          ...server,
          args: [...server.args],
          env: server.env.map((entry) => ({ ...entry })),
          headers: server.headers.map((entry) => ({ ...entry }))
        })),
        groups: (state.settings.mcp.groups || []).map((group) => ({ ...group }))
      }
    }
  };
}

export function structuredStateDocumentToPersistedStateLite(document: StructuredStateDocument): PersistedStateLite {
  return {
    groups: document.core.groups.map((group) => ({ ...group })),
    assistants: document.core.assistants.map((assistant) => ({
      ...assistant,
      enabledMcpServerIds: [...assistant.enabledMcpServerIds],
      overrides: assistant.overrides ? { ...assistant.overrides } : undefined
    })),
    selectedAssistantId: document.ui.selectedAssistantId,
    selectedSessionIdByAssistant: { ...document.ui.selectedSessionIdByAssistant },
    sessionPanelCollapsed: document.ui.sessionPanelCollapsed,
    collapsedGroupIds: [...document.ui.collapsedGroupIds],
    templates: document.core.templates?.map((t) => ({ ...t })) ?? [],
    settings: {
      providers: document.settingsModelConfig.providers.map(cloneProvider),
      defaultModels: {
        assistant: document.settingsDefaultModels.defaultModels.assistant
          ? { ...document.settingsDefaultModels.defaultModels.assistant }
          : undefined,
        titleSummary: document.settingsDefaultModels.defaultModels.titleSummary
          ? { ...document.settingsDefaultModels.defaultModels.titleSummary }
          : undefined,
        titleSummaryPrompt: document.settingsDefaultModels.defaultModels.titleSummaryPrompt
      },
      mcp: {
        ...document.settingsMcp.mcp,
        servers: document.settingsMcp.mcp.servers.map((server) => ({
          ...server,
          args: [...server.args],
          env: server.env.map((entry) => ({ ...entry })),
          headers: server.headers.map((entry) => ({ ...entry }))
        })),
        groups: (document.settingsMcp.mcp.groups || []).map((group) => ({ ...group }))
      },
      ...document.settingsGeneral
    }
  };
}

export class CompassSettingsStore {
  private core: StructuredStateCoreFile | undefined;
  private ui: StructuredUiSelectionFile | undefined;
  private settingsGeneral: StructuredSettingsGeneralFile | undefined;
  private settingsModelConfig: StructuredSettingsModelConfigFile | undefined;
  private settingsDefaultModels: StructuredSettingsDefaultModelsFile | undefined;
  private settingsMcp: StructuredSettingsMcpFile | undefined;
  private structuredCommit: StructuredStateCommitFile | undefined;

  private providerApiKeys: Record<string, string> = {};

  private legacyStatePayload: string | undefined;
  private legacyProviderApiKeysPayload: string | undefined;

  private dirty = false;

  public async load(paths: CompassPaths): Promise<void> {
    const [core, ui, settingsGeneral, settingsModelConfig, settingsDefaultModels, settingsMcp, structuredCommit] =
      await Promise.all([
      readJsonFileSafe<StructuredStateCoreFile>(paths.stateCorePath),
      readJsonFileSafe<StructuredUiSelectionFile>(paths.uiSelectionPath),
      readJsonFileSafe<StructuredSettingsGeneralFile>(paths.settingsGeneralPath),
      readJsonFileSafe<StructuredSettingsModelConfigFile>(paths.settingsModelConfigPath),
      readJsonFileSafe<StructuredSettingsDefaultModelsFile>(paths.settingsDefaultModelsPath),
      readJsonFileSafe<StructuredSettingsMcpFile>(paths.settingsMcpPath),
      readJsonFileSafe<StructuredStateCommitFile>(paths.structuredStateCommitPath)
    ]);

    this.core = isStructuredStateCoreFile(core) ? core : undefined;
    this.ui = isStructuredUiSelectionFile(ui) ? ui : undefined;
    this.settingsGeneral = isStructuredSettingsGeneralFile(settingsGeneral) ? settingsGeneral : undefined;
    this.settingsModelConfig = isStructuredSettingsModelConfigFile(settingsModelConfig) ? settingsModelConfig : undefined;
    this.settingsDefaultModels = isStructuredSettingsDefaultModelsFile(settingsDefaultModels)
      ? settingsDefaultModels
      : undefined;
    this.settingsMcp = isStructuredSettingsMcpFile(settingsMcp) ? settingsMcp : undefined;
    this.structuredCommit = isStructuredStateCommitFile(structuredCommit)
      ? cloneStructuredStateCommit(structuredCommit)
      : undefined;

    // 并行执行：一致性校验 + 非结构化文件读取（互不依赖）
    const nonStructuredPromise = Promise.all([
      readJsonFileSafe<Record<string, unknown>>(paths.providerApiKeysPath),
      readTextFile(paths.legacyStatePath),
      readTextFile(paths.legacyProviderApiKeysPath)
    ]);

    // 启动一致性校验：检测并修复崩溃导致的结构化文件不完整
    await this.validateAndRepairConsistency(paths);

    const [providerApiKeysPayload, legacyStatePayload, legacyProviderApiKeysPayload] = await nonStructuredPromise;
    this.providerApiKeys = normalizeProviderApiKeys(providerApiKeysPayload);
    this.legacyStatePayload = legacyStatePayload?.trim() ? legacyStatePayload : undefined;
    this.legacyProviderApiKeysPayload = legacyProviderApiKeysPayload?.trim() ? legacyProviderApiKeysPayload : undefined;

    if (!Object.keys(this.providerApiKeys).length && this.legacyProviderApiKeysPayload) {
      this.providerApiKeys = normalizeProviderApiKeys(parseJsonObject(this.legacyProviderApiKeysPayload));
    }
    this.dirty = false;
  }

  public async persist(paths: CompassPaths): Promise<void> {
    // 跟踪各阶段写入结果，只有全部成功才清除 dirty 标志
    // 任何阶段失败都保留 dirty，让下次 enqueuePersist 自动重试，避免数据丢失
    let structuredWriteOk = false;
    const document = this.getStructuredStateDocument();
    if (document) {
      const commit: StructuredStateCommitFile = {
        name: 'compass-structured-state',
        layoutVersion: COMPASS_LAYOUT_VERSION,
        generation: (this.structuredCommit?.generation ?? 0) + 1,
        writtenAt: new Date().toISOString()
      };

      // 结构化文件写入列表（按顺序写入，崩溃时可恢复）
      const structuredWrites: Array<{ filePath: string; data: unknown }> = [
        { filePath: paths.stateCorePath, data: document.core },
        { filePath: paths.uiSelectionPath, data: document.ui },
        { filePath: paths.settingsGeneralPath, data: document.settingsGeneral },
        { filePath: paths.settingsModelConfigPath, data: document.settingsModelConfig },
        { filePath: paths.settingsDefaultModelsPath, data: document.settingsDefaultModels },
        { filePath: paths.settingsMcpPath, data: document.settingsMcp }
      ];

      try {
        // 写入前快照：备份当前 state.core.json，用于崩溃恢复
        await createPrePersistSnapshot(paths.metaPath, paths.stateCorePath, commit.generation);

        // 写入前标记：标识正在写入中（崩溃恢复信号）
        await writeJsonAtomic(paths.structuredStateWritingMarkerPath, {
          generation: commit.generation,
          startedAt: commit.writtenAt
        });

        // 顺序写入所有结构化文件（而非 Promise.all 并行）
        // 崩溃时至少保证前面的文件已完整写入，配合启动一致性校验可恢复
        for (const { filePath, data } of structuredWrites) {
          await writeJsonAtomic(filePath, data);
        }
        structuredWriteOk = true;
      } catch (writeError) {
        // 写入失败：保留 dirty 标志（structuredWriteOk 保持 false），让下次 persist 重试
        // 不 return — 继续写入 API keys，避免结构化文件写入失败导致 API keys 丢失
        error('[Compass] One or more structured state files failed to write, skipping commit file:', writeError);
      }
      // 仅在结构化文件全部写入成功时写 commit 标记
      if (structuredWriteOk) {
        await writeJsonAtomic(paths.structuredStateCommitPath, commit);
        this.structuredCommit = cloneStructuredStateCommit(commit);
      }
      // 无论成功失败，都尝试清除写入标记（成功时不影响，失败时允许下次重试）
      await removeFileIfExists(paths.structuredStateWritingMarkerPath).catch((err) => warn('Failed to remove writing marker:', err));
      await removeFileIfExists(paths.legacyStatePath);
      this.legacyStatePayload = undefined;
      // 注意：不在此处清除 dirty，统一在函数末尾根据全部写入结果决定
    } else {
      await Promise.all([
        removeFileIfExists(paths.stateCorePath),
        removeFileIfExists(paths.uiSelectionPath),
        removeFileIfExists(paths.settingsGeneralPath),
        removeFileIfExists(paths.settingsModelConfigPath),
        removeFileIfExists(paths.settingsDefaultModelsPath),
        removeFileIfExists(paths.settingsMcpPath),
        removeFileIfExists(paths.structuredStateCommitPath)
      ]);
      this.structuredCommit = undefined;
      if (this.legacyStatePayload && this.legacyStatePayload.trim()) {
        await writeTextAtomic(paths.legacyStatePath, this.legacyStatePayload);
      } else {
        await removeFileIfExists(paths.legacyStatePath);
      }
      structuredWriteOk = true;
      // 注意：不在此处清除 dirty，统一在函数末尾根据全部写入结果决定
      // 上述任意 await 抛错都会跳出函数，dirty 保持 true，下次 persist 会重试
    }

    // API keys 独立写入，不受结构化文件写入结果影响
    let apiKeyWriteOk = false;
    try {
      if (Object.keys(this.providerApiKeys).length) {
        await writeJsonAtomic(paths.providerApiKeysPath, this.providerApiKeys);
        await removeFileIfExists(paths.legacyProviderApiKeysPath);
        this.legacyProviderApiKeysPayload = undefined;
      } else {
        await removeFileIfExists(paths.providerApiKeysPath);
        if (this.legacyProviderApiKeysPayload && this.legacyProviderApiKeysPayload.trim()) {
          await writeTextAtomic(paths.legacyProviderApiKeysPath, this.legacyProviderApiKeysPayload);
        } else {
          await removeFileIfExists(paths.legacyProviderApiKeysPath);
        }
      }
      apiKeyWriteOk = true;
    } catch (apiKeyError) {
      // API keys 写入失败：保留 dirty 标志，下次 persist 会重试
      error('[Compass] Failed to write API keys file:', apiKeyError);
    }

    // 只有结构化文件和 API keys 都写入成功，才清除 dirty 标志
    // 任一阶段失败都保留 dirty，让下次 enqueuePersist 自动重试，避免静默数据丢失
    if (structuredWriteOk && apiKeyWriteOk) {
      this.dirty = false;
    }
  }

  public isDirty(): boolean {
    return this.dirty;
  }

  /**
   * 启动时一致性校验：检测并修复崩溃导致的结构化文件不完整。
   *
   * 仅在检测到 .writing.json 标记时修复（证明是崩溃导致的写入中断）。
   * 无标记时不自动修复，让现有的迁移/校验流程（如 SQLite 回退）处理。
   */
  private async validateAndRepairConsistency(paths: CompassPaths): Promise<void> {
    // 全部完整，无需修复
    if (this.hasStructuredState()) {
      return;
    }

    // 检查写入标记 — 崩溃导致 persist 中断的确凿证据
    // writing marker 损坏时视为无标记（让 migrator 校验流程处理），但记录 error 日志
    const writingMarker = await readJsonFileSafe<{ generation?: number; startedAt?: string }>(paths.structuredStateWritingMarkerPath);
    if (!writingMarker) {
      // 无写入标记：不修复，可能是首次迁移中断或外部损坏，
      // 让 CompassMigrator 的现有校验流程（如 SQLite 回退）处理
      return;
    }

    // 有写入标记：崩溃发生在 persist() 执行期间
    // 先尝试从快照恢复 state.core.json（包含助手、分组、模板等重要数据）
    if (this.core === undefined) {
      const snapshotCore = await restoreFromSnapshot<StructuredStateCoreFile>(paths.metaPath);
      if (snapshotCore && snapshotCore.groups && snapshotCore.assistants) {
        this.core = snapshotCore;
        console.warn('[Compass] Recovered state.core from pre-persist snapshot.');
      }
    }

    // 统计有多少个结构化文件存在
    const fields: Array<{ value: unknown; defaultFactory: () => unknown; setter: (v: unknown) => void; path: string }> = [
      { value: this.core, defaultFactory: () => ({ groups: [], assistants: [], templates: [] }), setter: (v) => { this.core = v as StructuredStateCoreFile; }, path: paths.stateCorePath },
      { value: this.ui, defaultFactory: () => ({ selectedAssistantId: '', selectedSessionIdByAssistant: {}, sessionPanelCollapsed: false, collapsedGroupIds: [] }), setter: (v) => { this.ui = v as StructuredUiSelectionFile; }, path: paths.uiSelectionPath },
      { value: this.settingsGeneral, defaultFactory: () => ({}), setter: (v) => { this.settingsGeneral = v as StructuredSettingsGeneralFile; }, path: paths.settingsGeneralPath },
      { value: this.settingsModelConfig, defaultFactory: () => ({ providers: [] }), setter: (v) => { this.settingsModelConfig = v as StructuredSettingsModelConfigFile; }, path: paths.settingsModelConfigPath },
      { value: this.settingsDefaultModels, defaultFactory: () => ({ defaultModels: {} }), setter: (v) => { this.settingsDefaultModels = v as StructuredSettingsDefaultModelsFile; }, path: paths.settingsDefaultModelsPath },
      { value: this.settingsMcp, defaultFactory: () => ({ mcp: { servers: [], groups: [] } }), setter: (v) => { this.settingsMcp = v as StructuredSettingsMcpFile; }, path: paths.settingsMcpPath }
    ];

    const existingCount = fields.filter((f) => f.value !== undefined).length;

    console.warn(
      `[Compass] Crash recovery: .writing.json marker found (generation ${writingMarker.generation}).` +
      ` Incomplete structured state (${existingCount}/6 files). Filling missing files with defaults.`
    );

    for (const field of fields) {
      if (field.value === undefined) {
        const defaultValue = field.defaultFactory();
        field.setter(defaultValue);
        try {
          await writeJsonAtomic(field.path, defaultValue);
        } catch (repairError) {
          console.warn(`[Compass] Failed to repair missing file ${field.path}:`, repairError);
        }
      }
    }

    // 清理写入标记
    await removeFileIfExists(paths.structuredStateWritingMarkerPath).catch((err) => warn('Failed to remove writing marker:', err));
  }

  public hasStructuredState(): boolean {
    return !!(
      this.core &&
      this.ui &&
      this.settingsGeneral &&
      this.settingsModelConfig &&
      this.settingsDefaultModels &&
      this.settingsMcp
    );
  }

  public hasAnyData(): boolean {
    return (
      this.hasStructuredState() ||
      !!this.legacyStatePayload ||
      !!this.legacyProviderApiKeysPayload ||
      Object.keys(this.providerApiKeys).length > 0
    );
  }

  public getStructuredStateDocument(): StructuredStateDocument | undefined {
    if (!this.hasStructuredState()) {
      return undefined;
    }
    return {
      core: cloneStateCore(this.core as StructuredStateCoreFile),
      ui: cloneUiSelection(this.ui as StructuredUiSelectionFile),
      settingsGeneral: cloneSettingsGeneral(this.settingsGeneral as StructuredSettingsGeneralFile),
      settingsModelConfig: cloneSettingsModelConfig(this.settingsModelConfig as StructuredSettingsModelConfigFile),
      settingsDefaultModels: cloneSettingsDefaultModels(
        this.settingsDefaultModels as StructuredSettingsDefaultModelsFile
      ),
      settingsMcp: cloneSettingsMcp(this.settingsMcp as StructuredSettingsMcpFile)
    };
  }

  public setStructuredStateDocument(document: StructuredStateDocument): void {
    this.core = cloneStateCore(document.core);
    this.ui = cloneUiSelection(document.ui);
    this.settingsGeneral = cloneSettingsGeneral(document.settingsGeneral);
    this.settingsModelConfig = cloneSettingsModelConfig(document.settingsModelConfig);
    this.settingsDefaultModels = cloneSettingsDefaultModels(document.settingsDefaultModels);
    this.settingsMcp = cloneSettingsMcp(document.settingsMcp);
    this.legacyStatePayload = undefined;
    this.dirty = true;
  }

  public readStateLite(): PersistedStateLite | Record<string, unknown> | undefined {
    const document = this.getStructuredStateDocument();
    if (document) {
      return structuredStateDocumentToPersistedStateLite(document);
    }
    if (!this.legacyStatePayload) {
      return undefined;
    }
    return parseJsonObject(this.legacyStatePayload);
  }

  public writeStateLite(state: PersistedStateLite): void {
    this.setStructuredStateDocument(persistedStateLiteToStructuredStateDocument(state));
  }

  public getProviderApiKeys(): Record<string, string> {
    return { ...this.providerApiKeys };
  }

  public setProviderApiKeys(providerApiKeys: Record<string, string>): void {
    const normalized = normalizeProviderApiKeys(providerApiKeys);
    // 仅在 keys 实际变更时标记脏，避免 session-only persist 不必要地写入 settings。
    // 比较与键顺序无关（见 providerApiKeysEqual）。
    if (!providerApiKeysEqual(this.providerApiKeys, normalized)) {
      this.providerApiKeys = normalized;
      this.legacyProviderApiKeysPayload = undefined;
      this.dirty = true;
    }
  }

  public clearAllData(): void {
    this.core = undefined;
    this.ui = undefined;
    this.settingsGeneral = undefined;
    this.settingsModelConfig = undefined;
    this.settingsDefaultModels = undefined;
    this.settingsMcp = undefined;
    this.structuredCommit = undefined;
    this.providerApiKeys = {};
    this.legacyStatePayload = undefined;
    this.legacyProviderApiKeysPayload = undefined;
    this.dirty = true;
  }

  public setLegacyStatePayload(payload: string | undefined): void {
    this.legacyStatePayload = payload?.trim() ? payload : undefined;
  }

  public setLegacyProviderApiKeysPayload(payload: string | undefined): void {
    this.legacyProviderApiKeysPayload = payload?.trim() ? payload : undefined;
  }

  public migrateLegacyPayloadToStructured(): boolean {
    if (this.hasStructuredState()) {
      return false;
    }

    let changed = false;
    const legacyStateObject = parseJsonObject(this.legacyStatePayload);
    if (legacyStateObject) {
      const persistedState = looksLikePersistedStateLite(legacyStateObject)
        ? legacyStateObject
        : toPersistedStateLiteForStorage(legacyStateObject);
      this.writeStateLite(persistedState);
      changed = true;
    }

    if (!Object.keys(this.providerApiKeys).length && this.legacyProviderApiKeysPayload) {
      this.providerApiKeys = normalizeProviderApiKeys(parseJsonObject(this.legacyProviderApiKeysPayload));
      if (Object.keys(this.providerApiKeys).length) {
        this.legacyProviderApiKeysPayload = undefined;
        changed = true;
      }
    }

    return changed;
  }

  public async validateSnapshot(
    paths: CompassPaths,
    requireStructuredCommit = false
  ): Promise<SettingsSnapshotValidationResult> {
    const [
      coreText,
      uiText,
      settingsGeneralText,
      settingsModelConfigText,
      settingsDefaultModelsText,
      settingsMcpText,
      structuredCommitText,
      legacyStateText,
      providerApiKeysText,
      legacyProviderApiKeysText
    ] = await Promise.all([
      readTextFile(paths.stateCorePath),
      readTextFile(paths.uiSelectionPath),
      readTextFile(paths.settingsGeneralPath),
      readTextFile(paths.settingsModelConfigPath),
      readTextFile(paths.settingsDefaultModelsPath),
      readTextFile(paths.settingsMcpPath),
      readTextFile(paths.structuredStateCommitPath),
      readTextFile(paths.legacyStatePath),
      readTextFile(paths.providerApiKeysPath),
      readTextFile(paths.legacyProviderApiKeysPath)
    ]);

    const structuredTexts = [
      coreText,
      uiText,
      settingsGeneralText,
      settingsModelConfigText,
      settingsDefaultModelsText,
      settingsMcpText
    ];
    const structuredFileCount = structuredTexts.filter((content) => content !== undefined).length;

    if (structuredFileCount > 0 && structuredFileCount < structuredTexts.length) {
      return { valid: false, reason: 'Structured state files are incomplete', mode: 'structured' };
    }

    if (structuredFileCount === structuredTexts.length) {
      if (structuredCommitText !== undefined) {
        const commit = this.parseJsonFileText(paths.structuredStateCommitPath, structuredCommitText);
        if (!commit.valid) {
          return { valid: false, reason: commit.reason, mode: 'structured' };
        }
        if (!isStructuredStateCommitFile(commit.value)) {
          return { valid: false, reason: 'Structured state commit file has an invalid shape', mode: 'structured' };
        }
        if (commit.value.layoutVersion > COMPASS_LAYOUT_VERSION) {
          return {
            valid: false,
            reason: `Structured state commit file is newer than supported: ${String(commit.value.layoutVersion)}`,
            mode: 'structured'
          };
        }
      } else if (requireStructuredCommit) {
        return { valid: false, reason: 'Structured state commit file is missing', mode: 'structured' };
      }

      const core = this.parseJsonFileText(paths.stateCorePath, coreText as string);
      if (!core.valid) {
        return { valid: false, reason: core.reason, mode: 'structured' };
      }
      if (!isStructuredStateCoreFile(core.value)) {
        return { valid: false, reason: 'Structured state core file has an invalid shape', mode: 'structured' };
      }

      const ui = this.parseJsonFileText(paths.uiSelectionPath, uiText as string);
      if (!ui.valid) {
        return { valid: false, reason: ui.reason, mode: 'structured' };
      }
      if (!isStructuredUiSelectionFile(ui.value)) {
        return { valid: false, reason: 'Structured UI selection file has an invalid shape', mode: 'structured' };
      }

      const settingsGeneral = this.parseJsonFileText(paths.settingsGeneralPath, settingsGeneralText as string);
      if (!settingsGeneral.valid) {
        return { valid: false, reason: settingsGeneral.reason, mode: 'structured' };
      }
      if (!isStructuredSettingsGeneralFile(settingsGeneral.value)) {
        return { valid: false, reason: 'Structured settings.general file has an invalid shape', mode: 'structured' };
      }

      const settingsModelConfig = this.parseJsonFileText(paths.settingsModelConfigPath, settingsModelConfigText as string);
      if (!settingsModelConfig.valid) {
        return { valid: false, reason: settingsModelConfig.reason, mode: 'structured' };
      }
      if (!isStructuredSettingsModelConfigFile(settingsModelConfig.value)) {
        return {
          valid: false,
          reason: 'Structured settings.model-config file has an invalid shape',
          mode: 'structured'
        };
      }

      const settingsDefaultModels = this.parseJsonFileText(
        paths.settingsDefaultModelsPath,
        settingsDefaultModelsText as string
      );
      if (!settingsDefaultModels.valid) {
        return { valid: false, reason: settingsDefaultModels.reason, mode: 'structured' };
      }
      if (!isStructuredSettingsDefaultModelsFile(settingsDefaultModels.value)) {
        return {
          valid: false,
          reason: 'Structured settings.default-models file has an invalid shape',
          mode: 'structured'
        };
      }

      const settingsMcp = this.parseJsonFileText(paths.settingsMcpPath, settingsMcpText as string);
      if (!settingsMcp.valid) {
        return { valid: false, reason: settingsMcp.reason, mode: 'structured' };
      }
      if (!isStructuredSettingsMcpFile(settingsMcp.value)) {
        return { valid: false, reason: 'Structured settings.mcp file has an invalid shape', mode: 'structured' };
      }
    } else if (structuredCommitText !== undefined) {
      return { valid: false, reason: 'Structured state commit file exists without structured state files', mode: 'empty' };
    }

    if (structuredFileCount === 0 && legacyStateText !== undefined) {
      const legacyState = this.parseJsonFileText(paths.legacyStatePath, legacyStateText);
      if (!legacyState.valid) {
        return { valid: false, reason: legacyState.reason, mode: 'legacy' };
      }
      if (!isRecord(legacyState.value)) {
        return { valid: false, reason: 'Legacy compass state file has an invalid shape', mode: 'legacy' };
      }
    }

    if (providerApiKeysText !== undefined) {
      const providerApiKeys = this.parseJsonFileText(paths.providerApiKeysPath, providerApiKeysText);
      if (!providerApiKeys.valid) {
        return {
          valid: false,
          reason: providerApiKeys.reason,
          mode: structuredFileCount === structuredTexts.length ? 'structured' : 'empty'
        };
      }
      if (!isStringMap(providerApiKeys.value)) {
        return {
          valid: false,
          reason: 'Structured provider API keys file has an invalid shape',
          mode: structuredFileCount === structuredTexts.length ? 'structured' : 'empty'
        };
      }
    } else if (legacyProviderApiKeysText !== undefined) {
      const legacyProviderApiKeys = this.parseJsonFileText(paths.legacyProviderApiKeysPath, legacyProviderApiKeysText);
      if (!legacyProviderApiKeys.valid) {
        return {
          valid: false,
          reason: legacyProviderApiKeys.reason,
          mode: structuredFileCount === structuredTexts.length ? 'structured' : structuredFileCount === 0 && legacyStateText !== undefined ? 'legacy' : 'empty'
        };
      }
      if (!isStringMap(legacyProviderApiKeys.value)) {
        return {
          valid: false,
          reason: 'Legacy provider API keys file has an invalid shape',
          mode: structuredFileCount === structuredTexts.length ? 'structured' : structuredFileCount === 0 && legacyStateText !== undefined ? 'legacy' : 'empty'
        };
      }
    }

    if (structuredFileCount === structuredTexts.length) {
      return { valid: true, mode: 'structured' };
    }
    if (legacyStateText !== undefined) {
      return { valid: true, mode: 'legacy' };
    }
    return { valid: true, mode: 'empty' };
  }

  public getKvCompat(key: string, stateStoreKey: string, providerApiKeysStoreKey: string): string | undefined {
    if (key === stateStoreKey) {
      const state = this.readStateLite();
      return state ? JSON.stringify(state) : undefined;
    }
    if (key === providerApiKeysStoreKey) {
      const providerApiKeys = this.getProviderApiKeys();
      if (Object.keys(providerApiKeys).length) {
        return JSON.stringify(providerApiKeys);
      }
      return this.legacyProviderApiKeysPayload;
    }
    return undefined;
  }

  public setKvCompat(key: string, value: string, stateStoreKey: string, providerApiKeysStoreKey: string): boolean {
    if (key === stateStoreKey) {
      const currentState = this.readStateLite();
      const baseState =
        currentState && isRecord(currentState)
          ? looksLikePersistedStateLite(currentState)
            ? currentState
            : toPersistedStateLiteForStorage(currentState)
          : undefined;
      this.legacyStatePayload = value.trim() ? value : undefined;
      const parsed = parseJsonObject(value);
      if (parsed) {
        const nextState = looksLikePersistedStateLite(parsed)
          ? parsed
          : toPersistedStateLiteForStorage(parsed, baseState);
        this.writeStateLite(nextState);
      } else if (value.trim()) {
        warn('Ignoring invalid state compat payload; keeping the existing structured state intact.');
      }
      return true;
    }
    if (key === providerApiKeysStoreKey) {
      this.legacyProviderApiKeysPayload = value.trim() ? value : undefined;
      const parsed = parseJsonObject(value);
      if (parsed) {
        const normalized = normalizeProviderApiKeys(parsed);
        if (!providerApiKeysEqual(this.providerApiKeys, normalized)) {
          this.providerApiKeys = normalized;
          this.dirty = true;
        }
      } else if (value.trim()) {
        warn('Ignoring invalid provider API keys compat payload; keeping the existing structured secrets intact.');
      }
      return true;
    }
    return false;
  }

  private parseJsonFileText(filePath: string, raw: string): { valid: boolean; value?: unknown; reason?: string } {
    if (!raw.trim()) {
      return { valid: false, reason: `Snapshot file is empty: ${filePath}` };
    }
    try {
      return { valid: true, value: JSON.parse(raw) };
    } catch (err) {
      warn('Error parsing snapshot file:', err);
      return { valid: false, reason: `Snapshot file is not valid JSON: ${filePath}` };
    }
  }
}
