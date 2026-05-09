/**
 * 聊天状态载荷构建模块。
 *
 * 将 `ChatStateRepository` 中的运行时状态转换为 `ChatStatePayload`，
 * 供 WebView 渲染使用。包含 Provider 配置解析、会话作用域状态同步、
 * 以及完整的 payload 组装逻辑。
 */
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
  RuntimeLocale,
  SessionTempParams
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
  sessionTempParamsBySession: Record<string, SessionTempParams>;
}): void {
  const { assistantId, selectedSessionId, lastSelectedSessionIdByAssistant, sessionTempModelRefBySession, sessionTempParamsBySession } = args;
  if (!assistantId) {
    return;
  }
  const lastSelectedSessionId = lastSelectedSessionIdByAssistant[assistantId];
  if (lastSelectedSessionId && lastSelectedSessionId !== selectedSessionId) {
    delete sessionTempModelRefBySession[lastSelectedSessionId];
    delete sessionTempParamsBySession[lastSelectedSessionId];
  }
  lastSelectedSessionIdByAssistant[assistantId] = selectedSessionId;
}

export function resolveEffectiveProviderConfig(args: {
  settings: ChatBuddySettings;
  assistant: AssistantProfile;
  sessionId?: string;
  sessionTempModelRefBySession: Record<string, string>;
  sessionTempParamsBySession: Record<string, SessionTempParams>;
}): ResolvedProviderConfig {
  const { settings, assistant, sessionId, sessionTempModelRefBySession, sessionTempParamsBySession } = args;
  const tempModelRef = sessionId ? sessionTempModelRefBySession[sessionId] : '';
  const tempParams = sessionId ? sessionTempParamsBySession[sessionId] : undefined;
  const parsedTemp = parseModelRef(tempModelRef);
  const baseFallback = {
    temperature: assistant.temperature,
    topP: assistant.topP,
    maxTokens: assistant.maxTokens,
    contextCount: assistant.contextCount,
    presencePenalty: assistant.presencePenalty,
    frequencyPenalty: assistant.frequencyPenalty,
    timeoutMs: settings.timeoutMs
  };
  const resolved = parsedTemp
    ? resolveModelBindingConfig(settings, parsedTemp, baseFallback)
    : resolveProviderConfig(settings, assistant);
  if (!tempParams) {
    return resolved;
  }
  return {
    config: {
      ...resolved.config,
      ...(tempParams.temperature !== undefined && { temperature: tempParams.temperature }),
      ...(tempParams.topP !== undefined && { topP: tempParams.topP }),
      ...(tempParams.maxTokens !== undefined && { maxTokens: tempParams.maxTokens }),
      ...(tempParams.presencePenalty !== undefined && { presencePenalty: tempParams.presencePenalty }),
      ...(tempParams.frequencyPenalty !== undefined && { frequencyPenalty: tempParams.frequencyPenalty }),
    },
    meta: resolved.meta,
  };
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
  sessionTempParamsBySession: Record<string, SessionTempParams>;
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
    sessionTempParamsBySession,
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
    sessionTempParams: selectedSessionId ? sessionTempParamsBySession[selectedSessionId] ?? {} : {},
    sendShortcut: settings.sendShortcut,
    streaming: assistant?.streaming ?? streamingEnabled,
    isGenerating: false,
    canChat,
    mcpServers,
    awaitingToolContinuation,
    pendingToolCallCount,
    toolRoundLimit: settings.mcp.maxToolRounds,
    readOnlyReason,
    error,
    templates: rawState.templates
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
