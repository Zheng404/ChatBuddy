import { ChatBuddySettings, PersistedStateLite, ProviderModelProfile, ProviderProfile } from '../types';
import { createInitialState } from '../stateSanitizers';
import { readJsonFile, readTextFile, removeFileIfExists, writeJsonAtomic, writeTextAtomic } from './io';
import { CompassPaths } from './paths';
import {
  StructuredSettingsDefaultModelsFile,
  StructuredSettingsGeneralFile,
  StructuredSettingsMcpFile,
  StructuredSettingsModelConfigFile,
  StructuredStateCoreFile,
  StructuredStateDocument,
  StructuredUiSelectionFile
} from './types';

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

function looksLikePersistedStateLite(value: unknown): value is PersistedStateLite {
  if (!isRecord(value)) {
    return false;
  }
  return Array.isArray(value.groups) && Array.isArray(value.assistants) && isRecord(value.settings);
}

function toPersistedStateLiteForStorage(raw: Record<string, unknown>): PersistedStateLite {
  const base = createInitialState();
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

  private providerApiKeys: Record<string, string> = {};

  private legacyStatePayload: string | undefined;
  private legacyProviderApiKeysPayload: string | undefined;

  public async load(paths: CompassPaths): Promise<void> {
    const [core, ui, settingsGeneral, settingsModelConfig, settingsDefaultModels, settingsMcp] = await Promise.all([
      readJsonFile<StructuredStateCoreFile>(paths.stateCorePath),
      readJsonFile<StructuredUiSelectionFile>(paths.uiSelectionPath),
      readJsonFile<StructuredSettingsGeneralFile>(paths.settingsGeneralPath),
      readJsonFile<StructuredSettingsModelConfigFile>(paths.settingsModelConfigPath),
      readJsonFile<StructuredSettingsDefaultModelsFile>(paths.settingsDefaultModelsPath),
      readJsonFile<StructuredSettingsMcpFile>(paths.settingsMcpPath)
    ]);

    this.core = core && Array.isArray(core.groups) && Array.isArray(core.assistants) ? core : undefined;
    this.ui =
      ui && isRecord(ui.selectedSessionIdByAssistant) && Array.isArray(ui.collapsedGroupIds) ? ui : undefined;
    this.settingsGeneral = settingsGeneral ?? undefined;
    this.settingsModelConfig =
      settingsModelConfig && Array.isArray(settingsModelConfig.providers) ? settingsModelConfig : undefined;
    this.settingsDefaultModels = settingsDefaultModels ?? undefined;
    this.settingsMcp = settingsMcp && isRecord(settingsMcp.mcp) ? settingsMcp : undefined;

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
      await Promise.all([
        writeJsonAtomic(paths.stateCorePath, document.core),
        writeJsonAtomic(paths.uiSelectionPath, document.ui),
        writeJsonAtomic(paths.settingsGeneralPath, document.settingsGeneral),
        writeJsonAtomic(paths.settingsModelConfigPath, document.settingsModelConfig),
        writeJsonAtomic(paths.settingsDefaultModelsPath, document.settingsDefaultModels),
        writeJsonAtomic(paths.settingsMcpPath, document.settingsMcp)
      ]);
      await removeFileIfExists(paths.legacyStatePath);
      this.legacyStatePayload = undefined;
    } else {
      await Promise.all([
        removeFileIfExists(paths.stateCorePath),
        removeFileIfExists(paths.uiSelectionPath),
        removeFileIfExists(paths.settingsGeneralPath),
        removeFileIfExists(paths.settingsModelConfigPath),
        removeFileIfExists(paths.settingsDefaultModelsPath),
        removeFileIfExists(paths.settingsMcpPath)
      ]);
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
      this.legacyStatePayload = value;
      const parsed = parseJsonObject(value);
      if (parsed && looksLikePersistedStateLite(parsed)) {
        this.writeStateLite(parsed);
      }
      return true;
    }
    if (key === providerApiKeysStoreKey) {
      this.legacyProviderApiKeysPayload = value;
      this.providerApiKeys = normalizeProviderApiKeys(parseJsonObject(value));
      return true;
    }
    return false;
  }
}
