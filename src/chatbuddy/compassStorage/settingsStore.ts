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
import { warn } from '../utils';
import { readJsonFile, readTextFile, removeFileIfExists, writeJsonAtomic, writeTextAtomic } from './io';
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
  } catch {
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
    }))
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
      }))
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
      chatTabMode: settings.chatTabMode === 'multi' ? 'multi' : 'single'
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
      }))
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
      chatTabMode: state.settings.chatTabMode
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
        }))
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
        }))
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

  public async load(paths: CompassPaths): Promise<void> {
    const [core, ui, settingsGeneral, settingsModelConfig, settingsDefaultModels, settingsMcp, structuredCommit] =
      await Promise.all([
      readJsonFile<StructuredStateCoreFile>(paths.stateCorePath),
      readJsonFile<StructuredUiSelectionFile>(paths.uiSelectionPath),
      readJsonFile<StructuredSettingsGeneralFile>(paths.settingsGeneralPath),
      readJsonFile<StructuredSettingsModelConfigFile>(paths.settingsModelConfigPath),
      readJsonFile<StructuredSettingsDefaultModelsFile>(paths.settingsDefaultModelsPath),
      readJsonFile<StructuredSettingsMcpFile>(paths.settingsMcpPath),
      readJsonFile<StructuredStateCommitFile>(paths.structuredStateCommitPath)
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

    const providerApiKeysPayload = await readJsonFile<Record<string, unknown>>(paths.providerApiKeysPath);
    this.providerApiKeys = normalizeProviderApiKeys(providerApiKeysPayload);

    const legacyStatePayload = await readTextFile(paths.legacyStatePath);
    this.legacyStatePayload = legacyStatePayload?.trim() ? legacyStatePayload : undefined;

    const legacyProviderApiKeysPayload = await readTextFile(paths.legacyProviderApiKeysPath);
    this.legacyProviderApiKeysPayload = legacyProviderApiKeysPayload?.trim() ? legacyProviderApiKeysPayload : undefined;

    if (!Object.keys(this.providerApiKeys).length && this.legacyProviderApiKeysPayload) {
      this.providerApiKeys = normalizeProviderApiKeys(parseJsonObject(this.legacyProviderApiKeysPayload));
    }
  }

  public async persist(paths: CompassPaths): Promise<void> {
    const document = this.getStructuredStateDocument();
    if (document) {
      const commit: StructuredStateCommitFile = {
        name: 'compass-structured-state',
        layoutVersion: COMPASS_LAYOUT_VERSION,
        generation: (this.structuredCommit?.generation ?? 0) + 1,
        writtenAt: new Date().toISOString()
      };
      await Promise.all([
        writeJsonAtomic(paths.stateCorePath, document.core),
        writeJsonAtomic(paths.uiSelectionPath, document.ui),
        writeJsonAtomic(paths.settingsGeneralPath, document.settingsGeneral),
        writeJsonAtomic(paths.settingsModelConfigPath, document.settingsModelConfig),
        writeJsonAtomic(paths.settingsDefaultModelsPath, document.settingsDefaultModels),
        writeJsonAtomic(paths.settingsMcpPath, document.settingsMcp)
      ]);
      await writeJsonAtomic(paths.structuredStateCommitPath, commit);
      this.structuredCommit = cloneStructuredStateCommit(commit);
      await removeFileIfExists(paths.legacyStatePath);
      this.legacyStatePayload = undefined;
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
    }

    if (Object.keys(this.providerApiKeys).length) {
      await writeJsonAtomic(paths.providerApiKeysPath, this.providerApiKeys);
      await removeFileIfExists(paths.legacyProviderApiKeysPath);
      this.legacyProviderApiKeysPayload = undefined;
      return;
    }

    await removeFileIfExists(paths.providerApiKeysPath);
    if (this.legacyProviderApiKeysPayload && this.legacyProviderApiKeysPayload.trim()) {
      await writeTextAtomic(paths.legacyProviderApiKeysPath, this.legacyProviderApiKeysPayload);
    } else {
      await removeFileIfExists(paths.legacyProviderApiKeysPath);
    }
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
    this.providerApiKeys = normalizeProviderApiKeys(providerApiKeys);
    this.legacyProviderApiKeysPayload = undefined;
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
        this.providerApiKeys = normalizeProviderApiKeys(parsed);
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
    } catch {
      return { valid: false, reason: `Snapshot file is not valid JSON: ${filePath}` };
    }
  }
}
