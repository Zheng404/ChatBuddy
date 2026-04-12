import { resolveProviderConfig, resolveModelBindingConfig } from './providerClient';
import {
  AssistantProfile,
  ChatBuddySettings,
  ChatSessionDetail,
  ChatSessionSummary,
  ChatStatePayload,
  McpServerSummary,
  PersistedStateLite,
  ProviderModelOption,
  ProviderToolCall,
  RuntimeLocale
} from './types';
import { parseModelRef } from './modelCatalog';
import { getStrings } from './i18n';

type ResolvedProviderConfig = ReturnType<typeof resolveProviderConfig>;

type PendingToolContinuationLike = {
  result: {
    toolCalls?: ProviderToolCall[];
  };
};

export function syncSessionScopedState(args: {
  assistantId: string | undefined;
  selectedSessionId?: string;
  lastSelectedSessionIdByAssistant: Record<string, string | undefined>;
  sessionTempModelRefBySession: Record<string, string>;
}): void {
  const { assistantId, selectedSessionId, lastSelectedSessionIdByAssistant, sessionTempModelRefBySession } = args;
  if (!assistantId) {
    return;
  }
  const lastSelectedSessionId = lastSelectedSessionIdByAssistant[assistantId];
  if (lastSelectedSessionId && lastSelectedSessionId !== selectedSessionId) {
    delete sessionTempModelRefBySession[lastSelectedSessionId];
  }
  lastSelectedSessionIdByAssistant[assistantId] = selectedSessionId;
}

export function resolveEffectiveProviderConfig(args: {
  settings: ChatBuddySettings;
  assistant: AssistantProfile;
  sessionId?: string;
  sessionTempModelRefBySession: Record<string, string>;
}): ResolvedProviderConfig {
  const { settings, assistant, sessionId, sessionTempModelRefBySession } = args;
  const tempModelRef = sessionId ? sessionTempModelRefBySession[sessionId] : '';
  const parsedTemp = parseModelRef(tempModelRef);
  if (!parsedTemp) {
    return resolveProviderConfig(settings, assistant);
  }
  return resolveModelBindingConfig(settings, parsedTemp, {
    temperature: assistant.temperature,
    topP: assistant.topP,
    maxTokens: assistant.maxTokens,
    contextCount: assistant.contextCount,
    presencePenalty: assistant.presencePenalty,
    frequencyPenalty: assistant.frequencyPenalty,
    timeoutMs: settings.timeoutMs
  });
}

export function buildChatStatePayload(args: {
  locale: RuntimeLocale;
  rawState: PersistedStateLite;
  assistant?: AssistantProfile;
  sessions: ChatSessionSummary[];
  selectedSession?: ChatSessionDetail;
  pendingToolContinuation?: PendingToolContinuationLike;
  getModelOption: (modelRef: string | undefined) => ProviderModelOption | undefined;
  getServerSummaries: (settings: ChatBuddySettings, assistant?: AssistantProfile) => McpServerSummary[];
  resolveProviderConfigForAssistant: (
    settings: ChatBuddySettings,
    assistant: AssistantProfile,
    sessionId?: string
  ) => ResolvedProviderConfig;
  modelOptions: ProviderModelOption[];
  sessionTempModelRefBySession: Record<string, string>;
  streamingEnabled: boolean;
  error?: string;
}): ChatStatePayload {
  const {
    locale,
    rawState,
    assistant,
    sessions,
    selectedSession,
    pendingToolContinuation,
    getModelOption,
    getServerSummaries,
    resolveProviderConfigForAssistant,
    modelOptions,
    sessionTempModelRefBySession,
    streamingEnabled,
    error
  } = args;
  const strings = getStrings(locale);
  const settings = rawState.settings;

  let providerLabel = '-';
  let modelLabel = '-';
  let canChat = false;
  let readOnlyReason: string | undefined;
  const awaitingToolContinuation = Boolean(pendingToolContinuation);
  const pendingToolCallCount = pendingToolContinuation?.result.toolCalls?.length ?? 0;
  const mcpServers = getServerSummaries(settings, assistant);

  if (!assistant) {
    readOnlyReason = strings.noAssistantSelectedBody;
  } else if (assistant.isDeleted) {
    readOnlyReason = strings.assistantArchivedReadonly;
    const option = getModelOption(assistant.modelRef);
    providerLabel = option?.providerName ?? '-';
    modelLabel = option?.label ?? assistant.modelRef ?? '-';
  } else {
    const resolved = resolveProviderConfigForAssistant(settings, assistant, selectedSession?.id);
    providerLabel = resolved.config.providerName || '-';
    modelLabel = resolved.config.modelLabel || assistant.modelRef || '-';
    canChat = true;
  }

  if (awaitingToolContinuation) {
    canChat = false;
    readOnlyReason = strings.toolContinuationReadonly || strings.generationBusy;
  }

  const selectedSessionId = selectedSession?.id || '';

  return {
    groups: rawState.groups,
    assistants: rawState.assistants,
    selectedAssistant: assistant,
    selectedAssistantId: assistant?.id,
    sessions,
    selectedSessionId,
    selectedSession,
    sessionPanelCollapsed: rawState.sessionPanelCollapsed,
    locale,
    strings,
    providerLabel,
    modelLabel,
    modelOptions,
    sessionTempModelRef: selectedSessionId ? sessionTempModelRefBySession[selectedSessionId] ?? '' : '',
    sendShortcut: settings.sendShortcut,
    streaming: assistant?.streaming ?? streamingEnabled,
    isGenerating: false,
    canChat,
    mcpServers,
    awaitingToolContinuation,
    pendingToolCallCount,
    toolRoundLimit: settings.mcp.maxToolRounds,
    readOnlyReason,
    error
  };
}

export function withGenerationState(
  payload: ChatStatePayload,
  isGenerating: boolean
): ChatStatePayload {
  return {
    ...payload,
    isGenerating
  };
}
