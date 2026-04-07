import * as vscode from 'vscode';

import { getCodiconRootUri } from './codicon';
import { buildRemotePassthroughTools, McpRuntime } from './mcpRuntime';
import { parseModelRef, DEFAULT_TITLE_SUMMARY_PROMPT } from './modelCatalog';
import { formatString, getAssistantLocalization, getDefaultSessionTitle, getStrings, resolveLocale } from './i18n';
import { applyQuestionPrefix, mergeReasoningParts, splitThinkTaggedContent, toProviderMessages } from './chatUtils';
import {
  OpenAICompatibleClient,
  ProviderChatResult,
  ProviderToolRound,
  resolveModelBindingConfig,
  resolveProviderConfig,
  validateProviderConfig
} from './providerClient';
import { getPanelIconPath } from './panelIcon';
import { ChatStateRepository } from './stateRepository';
import { getChatWebviewHtml } from './webview';
import { createId, nowTs } from './utils/id';
import {
  AssistantProfile,
  ChatBuddySettings,
  ChatMessage,
  ChatStatePayload,
  ChatToolRound,
  ProviderMessage,
  ProviderConfig,
  ProviderToolDefinition,
  RuntimeLocale,
  WebviewInboundMessage,
  WebviewOutboundMessage
} from './types';
import { getLocaleFromSettings } from './utils';

const CHAT_PANEL_VIEW_TYPE = 'chatbuddy.mainChat';
const STREAM_FLUSH_INTERVAL_MS = 50;

type PanelMessageContext = {
  panel: vscode.WebviewPanel;
  assistantId?: string;
};

type BuiltProviderTools = {
  tools: ProviderToolDefinition[];
  localToolNames: Set<string>;
};

type PendingToolContinuation = {
  assistant: AssistantProfile;
  sessionId: string;
  assistantMessageId: string;
  settings: ChatBuddySettings;
  locale: RuntimeLocale;
  providerMessages: ProviderMessage[];
  providerTools: BuiltProviderTools;
  providerConfig: ProviderConfig;
  toolRounds: ProviderToolRound[];
  result: ProviderChatResult;
};

export class ChatController {
  private panel: vscode.WebviewPanel | undefined;
  private panelsByAssistantId = new Map<string, vscode.WebviewPanel>();
  private streamingEnabled: boolean;
  private isGenerating = false;
  private pendingToolContinuation: PendingToolContinuation | undefined;
  private abortController: AbortController | undefined;
  private abortReason: 'manual' | 'timeout' | undefined;
  private sessionTempModelRefBySession: Record<string, string> = {};
  private lastSelectedSessionIdByAssistant: Record<string, string | undefined> = {};

  constructor(
    private readonly repository: ChatStateRepository,
    private readonly providerClient: OpenAICompatibleClient,
    private readonly mcpRuntime: McpRuntime
  ) {
    const assistant = this.repository.getSelectedAssistant();
    this.streamingEnabled = assistant?.streaming ?? this.repository.getSettings().streamingDefault;
  }

  private getLocale(): RuntimeLocale {
    return getLocaleFromSettings(this.repository.getSettings());
  }

  public openAssistantChat(assistantId?: string): void {
    if (assistantId) {
      this.repository.setSelectedAssistant(assistantId);
    }

    const assistant = this.repository.getSelectedAssistant();
    if (assistant && !assistant.isDeleted) {
      this.ensureSession(assistant.id);
      this.streamingEnabled = assistant.streaming;
    }

    const strings = getStrings(this.getLocale());
    const panelTitle = assistant?.name?.trim() || strings.chatPanelTitle;
    const panelIcon = getPanelIconPath(assistant?.avatar ?? 'account');
    const chatTabMode = this.repository.getSettings().chatTabMode;

    if (chatTabMode === 'multi' && assistant) {
      // Multi-tab mode: each assistant gets its own panel
      const existing = this.panelsByAssistantId.get(assistant.id);
      if (existing) {
        existing.title = panelTitle;
        existing.iconPath = panelIcon;
        existing.reveal(vscode.ViewColumn.One);
        this.panel = existing;
        this.postState();
      } else {
        const newPanel = vscode.window.createWebviewPanel(CHAT_PANEL_VIEW_TYPE, panelTitle, vscode.ViewColumn.One, {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [getCodiconRootUri()]
        });
        newPanel.iconPath = panelIcon;
        newPanel.webview.html = getChatWebviewHtml(newPanel.webview);
        const assistantIdRef = assistant.id;
        const messageListener = newPanel.webview.onDidReceiveMessage((message: WebviewInboundMessage) => {
          this.panel = newPanel;
          void this.handleWebviewMessage(message, {
            panel: newPanel,
            assistantId: assistantIdRef
          });
        });
        newPanel.onDidDispose(() => {
          this.stopGeneration('manual');
          messageListener.dispose();
          this.panelsByAssistantId.delete(assistantIdRef);
          if (this.panel === newPanel) {
            this.panel = undefined;
          }
        });
        this.panelsByAssistantId.set(assistant.id, newPanel);
        this.panel = newPanel;
      }
    } else {
      // Single-tab mode: reuse the same panel
      if (!this.panel) {
        this.panel = vscode.window.createWebviewPanel(CHAT_PANEL_VIEW_TYPE, panelTitle, vscode.ViewColumn.One, {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [getCodiconRootUri()]
        });
        this.panel.iconPath = panelIcon;
        this.panel.webview.html = getChatWebviewHtml(this.panel.webview);
        const panelRef = this.panel;
        const messageListener = this.panel.webview.onDidReceiveMessage((message: WebviewInboundMessage) => {
          void this.handleWebviewMessage(message, {
            panel: panelRef
          });
        });
        this.panel.onDidDispose(() => {
          this.stopGeneration('manual');
          messageListener.dispose();
          this.panel = undefined;
        });
      } else {
        this.panel.title = panelTitle;
        this.panel.iconPath = panelIcon;
        this.panel.reveal(vscode.ViewColumn.One);
        this.postState();
      }
    }

    this.postState();
  }

  public stopGeneration(reason: 'manual' | 'timeout' = 'manual'): void {
    this.abortReason = reason;
    this.abortController?.abort();
  }

  public createSessionForSelectedAssistant(): void {
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant || assistant.isDeleted) {
      return;
    }
    this.createSessionForAssistant(assistant.id);
    this.postState();
  }

  public renameSessionForSelectedAssistant(sessionId: string, title: string): void {
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant) {
      return;
    }
    this.repository.renameSession(assistant.id, sessionId, title);
    this.postState();
  }

  public deleteSessionForSelectedAssistant(sessionId: string): void {
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant) {
      return;
    }
    this.repository.deleteSession(assistant.id, sessionId);
    delete this.sessionTempModelRefBySession[sessionId];
    this.ensureSession(assistant.id);
    this.postState();
  }

  public toggleSessionPanel(): void {
    const state = this.repository.getState();
    this.repository.setSessionPanelCollapsed(!state.sessionPanelCollapsed);
    this.postState();
  }

  public applySettings(settings: ChatBuddySettings): void {
    this.repository.updateSettings(settings);
    const assistant = this.repository.getSelectedAssistant();
    this.streamingEnabled = assistant?.streaming ?? settings.streamingDefault;
    this.postState();
  }

  private async handleWebviewMessage(message: WebviewInboundMessage, context?: PanelMessageContext): Promise<void> {
    if (context?.panel) {
      this.panel = context.panel;
    }
    if (context?.assistantId) {
      const selectedAssistant = this.repository.getSelectedAssistant();
      if (selectedAssistant?.id !== context.assistantId) {
        this.repository.setSelectedAssistant(context.assistantId);
      }
    }

    if (
      this.pendingToolContinuation &&
      message.type !== 'ready' &&
      message.type !== 'continueToolCalls' &&
      message.type !== 'cancelToolCalls'
    ) {
      const notice = getStrings(this.getLocale()).toolContinuationReadonly || getStrings(this.getLocale()).generationBusy;
      this.postError(notice, context);
      this.postState(notice, context);
      return;
    }

    switch (message.type) {
      case 'ready':
        this.postState(undefined, context);
        return;
      case 'createSession': {
        const assistant = this.repository.getSelectedAssistant();
        if (!assistant || assistant.isDeleted) {
          return;
        }
        this.createSessionForAssistant(assistant.id);
        this.postState();
        return;
      }
      case 'selectSession': {
        const assistant = this.repository.getSelectedAssistant();
        if (!assistant) {
          return;
        }
        const previousSessionId = this.repository.getSelectedSession(assistant.id)?.id;
        this.repository.selectSession(assistant.id, message.sessionId);
        if (previousSessionId && previousSessionId !== message.sessionId) {
          delete this.sessionTempModelRefBySession[previousSessionId];
        }
        this.postState();
        return;
      }
      case 'renameSession': {
        const assistant = this.repository.getSelectedAssistant();
        if (!assistant) {
          return;
        }
        this.repository.renameSession(assistant.id, message.sessionId, message.title);
        this.postState();
        return;
      }
      case 'deleteSession': {
        const assistant = this.repository.getSelectedAssistant();
        if (!assistant) {
          return;
        }
        const session = this.repository.getSessionsForAssistant(assistant.id).find((item) => item.id === message.sessionId);
        if (!session) {
          return;
        }
        const strings = getStrings(this.getLocale());
        const sessionTitle = session.title?.trim() || strings.untitledSession;
        const confirmed = await this.confirmDangerousAction(
          formatString(strings.confirmDeleteSession, { title: sessionTitle }),
          strings.deleteAction
        );
        if (!confirmed) {
          return;
        }
        this.repository.deleteSession(assistant.id, message.sessionId);
        delete this.sessionTempModelRefBySession[message.sessionId];
        this.ensureSession(assistant.id);
        this.postState();
        return;
      }
      case 'setSessionTempModel': {
        const assistant = this.repository.getSelectedAssistant();
        if (!assistant || assistant.isDeleted) {
          return;
        }
        const session = this.repository.getSelectedSession(assistant.id);
        if (!session) {
          return;
        }
        const modelRef = message.modelRef.trim();
        if (!modelRef) {
          delete this.sessionTempModelRefBySession[session.id];
          this.postState();
          return;
        }
        const option = this.repository.resolveModelOption(modelRef);
        if (!option) {
          this.postError(getStrings(this.getLocale()).modelUnavailable);
          return;
        }
        this.sessionTempModelRefBySession[session.id] = option.ref;
        this.postState();
        return;
      }
      case 'toggleSessionPanel': {
        const state = this.repository.getState();
        this.repository.setSessionPanelCollapsed(!state.sessionPanelCollapsed);
        this.postState();
        return;
      }
      case 'setStreaming': {
        const assistant = this.repository.getSelectedAssistant();
        if (!assistant || assistant.isDeleted) {
          return;
        }
        this.streamingEnabled = message.enabled;
        this.repository.setAssistantStreaming(assistant.id, message.enabled);
        this.postState();
        return;
      }
      case 'regenerateReply':
        await this.regenerateReply(context);
        return;
      case 'regenerateFromMessage':
        await this.regenerateFromMessage(message.messageId, context);
        return;
      case 'copyMessage':
        await this.copyMessage(message.messageId);
        return;
      case 'deleteMessage':
        await this.deleteMessage(message.messageId);
        return;
      case 'editMessage':
        await this.editMessage(message.messageId, message.newContent);
        return;
      case 'clearSession':
        await this.clearSession();
        return;
      case 'sendMessage':
        await this.sendMessage(message.content, context);
        return;
      case 'continueToolCalls':
        await this.continuePendingToolCalls(context);
        return;
      case 'cancelToolCalls':
        this.cancelPendingToolCalls(context);
        return;
      case 'listMcpResources':
        await this.listMcpResources(context);
        return;
      case 'listMcpPrompts':
        await this.listMcpPrompts(context);
        return;
      case 'readMcpResource':
        await this.insertMcpResource(message.serverId, message.uri, context);
        return;
      case 'getMcpPrompt':
        await this.insertMcpPrompt(message.serverId, message.name, message.args, context);
        return;
      case 'stopGeneration':
        this.stopGeneration('manual');
        this.postState(undefined, context);
        return;
      default:
        return;
    }
  }

  private ensureSession(assistantId: string): void {
    const assistant = this.repository.getAssistantById(assistantId);
    if (!assistant || assistant.isDeleted) {
      return;
    }
    const sessions = this.repository.getSessionsForAssistant(assistantId);
    if (!sessions.length) {
      this.createSessionForAssistant(assistantId);
      return;
    }
    const selected = this.repository.getSelectedSession(assistantId);
    if (!selected) {
      this.repository.selectSession(assistantId, sessions[0].id);
    }
  }

  private createSessionForAssistant(assistantId: string): string | undefined {
    const assistant = this.repository.getAssistantById(assistantId);
    if (!assistant || assistant.isDeleted) {
      return undefined;
    }
    const previousSessionId = this.repository.getSelectedSession(assistant.id)?.id;
    const created = this.repository.createSession(assistant.id, getDefaultSessionTitle(this.getLocale()));
    if (previousSessionId && previousSessionId !== created.id) {
      delete this.sessionTempModelRefBySession[previousSessionId];
    }
    return created.id;
  }

  private postMessage(message: WebviewOutboundMessage, context?: PanelMessageContext): void {
    const targetPanel = context?.panel ?? this.panel;
    void targetPanel?.webview.postMessage(message);
  }

  private postError(message: string, context?: PanelMessageContext): void {
    this.postMessage({ type: 'error', message }, context);
  }

  private syncSessionScopedState(assistantId: string | undefined, selectedSessionId?: string): void {
    if (!assistantId) {
      return;
    }
    const lastSelectedSessionId = this.lastSelectedSessionIdByAssistant[assistantId];
    if (lastSelectedSessionId && lastSelectedSessionId !== selectedSessionId) {
      delete this.sessionTempModelRefBySession[lastSelectedSessionId];
    }
    this.lastSelectedSessionIdByAssistant[assistantId] = selectedSessionId;
  }

  private resolveEffectiveProviderConfig(settings: ChatBuddySettings, assistant: AssistantProfile, sessionId?: string) {
    const tempModelRef = sessionId ? this.sessionTempModelRefBySession[sessionId] : '';
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

  private async listMcpResources(context?: PanelMessageContext): Promise<void> {
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant || assistant.isDeleted) {
      return;
    }
    const settings = this.repository.getSettings();
    try {
      const items = await this.mcpRuntime.listResources(settings, assistant);
      this.postMessage({
        type: 'mcpResources',
        payload: {
          items
        }
      }, context);
    } catch (error) {
      this.postError(error instanceof Error ? error.message : getStrings(this.getLocale()).unknownError, context);
    }
  }

  private async listMcpPrompts(context?: PanelMessageContext): Promise<void> {
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant || assistant.isDeleted) {
      return;
    }
    const settings = this.repository.getSettings();
    try {
      const items = await this.mcpRuntime.listPrompts(settings, assistant);
      this.postMessage({
        type: 'mcpPrompts',
        payload: {
          items
        }
      }, context);
    } catch (error) {
      this.postError(error instanceof Error ? error.message : getStrings(this.getLocale()).unknownError, context);
    }
  }

  private async insertMcpResource(serverId: string, uri: string, context?: PanelMessageContext): Promise<void> {
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant || assistant.isDeleted) {
      return;
    }
    const settings = this.repository.getSettings();
    try {
      const content = await this.mcpRuntime.readResource(settings, assistant, serverId, uri);
      this.postMessage({
        type: 'mcpInsert',
        payload: {
          content
        }
      }, context);
    } catch (error) {
      this.postError(error instanceof Error ? error.message : getStrings(this.getLocale()).unknownError, context);
    }
  }

  private async insertMcpPrompt(
    serverId: string,
    name: string,
    args: Record<string, string>,
    context?: PanelMessageContext
  ): Promise<void> {
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant || assistant.isDeleted) {
      return;
    }
    const settings = this.repository.getSettings();
    try {
      const content = await this.mcpRuntime.getPrompt(settings, assistant, serverId, name, args);
      this.postMessage({
        type: 'mcpInsert',
        payload: {
          content
        }
      }, context);
    } catch (error) {
      this.postError(error instanceof Error ? error.message : getStrings(this.getLocale()).unknownError, context);
    }
  }

  private providerSupportsToolCalling(modelRef: string, config: { apiType: string; providerKind: string }): boolean {
    const option = this.repository.resolveModelOption(modelRef);
    if (option?.capabilities?.tools) {
      return true;
    }
    // If the model explicitly lacks tool support, respect that.
    if (option?.capabilities && option.capabilities.tools === false) {
      return false;
    }
    // Most OpenAI-compatible providers support function calling via chat_completions or responses API.
    return config.apiType === 'chat_completions' || config.apiType === 'responses';
  }

  private async buildProviderTools(
    settings: ChatBuddySettings,
    assistant: AssistantProfile,
    resolved: ReturnType<ChatController['resolveEffectiveProviderConfig']>
  ): Promise<BuiltProviderTools> {
    if (!assistant.enabledMcpServerIds.length) {
      return {
        tools: [],
        localToolNames: new Set<string>()
      };
    }

    const passthrough = buildRemotePassthroughTools(
      settings,
      assistant,
      resolved.config.apiType === 'responses' && resolved.config.providerKind === 'openai'
    );
    const passthroughServerIds = new Set(passthrough.map((item) => item.serverId));
    const localBindings = (await this.mcpRuntime.listToolBindings(settings, assistant)).filter(
      (binding) => !passthroughServerIds.has(binding.serverId)
    );
    return {
      tools: [...localBindings.map((binding) => binding.providerTool), ...passthrough.map((item) => item.tool)],
      localToolNames: new Set(
        localBindings
          .map((binding) => (binding.providerTool.type === 'function' ? binding.providerTool.function.name : ''))
          .filter(Boolean)
      )
    };
  }

  private async executeToolRound(
    settings: ChatBuddySettings,
    assistant: AssistantProfile,
    toolCalls: ProviderToolRound['toolCalls'],
    localToolNames: Set<string>
  ): Promise<ProviderToolRound['results']> {
    const results: ProviderToolRound['results'] = [];
    for (const toolCall of toolCalls) {
      if (!localToolNames.has(toolCall.name)) {
        continue;
      }
      try {
        const output = await this.mcpRuntime.callBoundTool(settings, assistant, toolCall.name, toolCall.argumentsText);
        results.push({
          toolCallId: toolCall.id,
          output
        });
      } catch (error) {
        results.push({
          toolCallId: toolCall.id,
          output: error instanceof Error ? error.message : getStrings(this.getLocale()).unknownError
        });
      }
    }
    return results;
  }

  private buildToolContinuationContext(
    pending: PendingToolContinuation,
    context?: PanelMessageContext
  ): PanelMessageContext | undefined {
    if (!context?.panel) {
      return context;
    }
    return {
      panel: context.panel,
      assistantId: pending.assistant.id
    };
  }

  private applyProviderResultToAssistantMessage(
    assistantId: string,
    sessionId: string,
    assistantMessageId: string,
    result: ProviderChatResult,
    modelLabel: string,
    options?: {
      fallbackContent?: string;
      toolRounds?: ChatToolRound[];
    }
  ): void {
    const thinkSplit = splitThinkTaggedContent(result.text);
    const baseContent = thinkSplit.content.trim();
    const fallbackContent = options?.fallbackContent?.trim();
    const contentValue = baseContent || fallbackContent || getStrings(this.getLocale()).emptyResponse;
    const reasoningValue = mergeReasoningParts(result.reasoning, thinkSplit.reasoning);
    this.repository.updateLastAssistantMessage(assistantId, sessionId, (current) => ({
      id: current?.id ?? assistantMessageId,
      role: 'assistant',
      content: contentValue,
      timestamp: nowTs(),
      model: modelLabel,
      reasoning: reasoningValue,
      toolRounds: options?.toolRounds
    }));
  }

  private async runToolCallingBatch(
    pending: PendingToolContinuation,
    context?: PanelMessageContext
  ): Promise<'completed' | 'paused'> {
    const maxRounds = Math.max(1, Math.floor(pending.settings.mcp.maxToolRounds) || 1);
    const targetContext = this.buildToolContinuationContext(pending, context);
    let result = pending.result;
    let roundCount = 0;
    const chatToolRounds: ChatToolRound[] = [];

    const extractReasoning = (r: ProviderChatResult): string => {
      const split = splitThinkTaggedContent(r.text);
      return mergeReasoningParts(r.reasoning, split.reasoning) || '';
    };

    while ((result.toolCalls?.length ?? 0) > 0) {
      if (roundCount >= maxRounds) {
        pending.result = result;
        this.pendingToolContinuation = pending;
        this.applyProviderResultToAssistantMessage(
          pending.assistant.id,
          pending.sessionId,
          pending.assistantMessageId,
          result,
          pending.providerConfig.modelLabel,
          {
            fallbackContent: getStrings(pending.locale).toolContinuationPendingMessage,
            toolRounds: chatToolRounds
          }
        );
        this.postState(undefined, targetContext);
        return 'paused';
      }

      const toolCalls = result.toolCalls ?? [];
      const roundReasoning = extractReasoning(result);

      const results = await this.executeToolRound(
        pending.settings,
        pending.assistant,
        toolCalls,
        pending.providerTools.localToolNames
      );
      if (results.length === 0) {
        break;
      }

      // Build structured tool round for display (reasoning before tool calls)
      chatToolRounds.push({
        reasoning: roundReasoning || undefined,
        calls: toolCalls.map((call) => {
          const matched = results.find((r) => r.toolCallId === call.id);
          return {
            id: call.id,
            name: call.name,
            argumentsText: call.argumentsText,
            output: matched?.output
          };
        })
      });

      pending.toolRounds.push({
        toolCalls,
        results
      });
      roundCount += 1;

      // Update assistant message with tool call progress
      this.applyProviderResultToAssistantMessage(
        pending.assistant.id,
        pending.sessionId,
        pending.assistantMessageId,
        { text: '', reasoning: '' },
        pending.providerConfig.modelLabel,
        { toolRounds: chatToolRounds }
      );
      this.postState(undefined, targetContext);

      result = await this.providerClient.chat(
        pending.providerMessages,
        pending.providerConfig,
        pending.locale,
        this.abortController?.signal,
        {
          tools: pending.providerTools.tools,
          toolRounds: pending.toolRounds
        }
      );
      pending.result = result;
    }

    this.pendingToolContinuation = undefined;

    // Final response after all tool rounds — use streaming if enabled
    if (pending.assistant.streaming) {
      await this.streamFinalResponse(pending, chatToolRounds, targetContext);
    } else {
      this.applyProviderResultToAssistantMessage(
        pending.assistant.id,
        pending.sessionId,
        pending.assistantMessageId,
        result,
        pending.providerConfig.modelLabel,
        {
          fallbackContent: getStrings(pending.locale).emptyResponse,
          toolRounds: chatToolRounds
        }
      );
    }
    return 'completed';
  }

  private async streamFinalResponse(
    pending: PendingToolContinuation,
    chatToolRounds: ChatToolRound[],
    context?: PanelMessageContext
  ): Promise<void> {
    let streamRawMerged = '';
    let streamRawPersisted = '';
    let streamReasoningDeltaMerged = '';
    let streamReasoningDeltaPersisted = '';
    let streamFlushTimer: ReturnType<typeof setTimeout> | undefined;
    const strings = getStrings(pending.locale);

    const flushStreamMessage = (persist: boolean) => {
      const thinkSplit = splitThinkTaggedContent(streamRawMerged);
      const contentValue = thinkSplit.content.trim() || strings.emptyResponse;
      const reasoningValue = mergeReasoningParts(streamReasoningDeltaMerged, thinkSplit.reasoning);
      this.repository.updateLastAssistantMessage(
        pending.assistant.id,
        pending.sessionId,
        (current) => ({
          id: current?.id ?? pending.assistantMessageId,
          role: 'assistant',
          content: contentValue,
          timestamp: nowTs(),
          model: pending.providerConfig.modelLabel,
          reasoning: reasoningValue,
          toolRounds: chatToolRounds
        }),
        persist
      );
      streamRawPersisted = streamRawMerged;
      streamReasoningDeltaPersisted = streamReasoningDeltaMerged;
      this.postState(undefined, context);
    };

    const scheduleStreamFlush = () => {
      if (streamFlushTimer) { return; }
      streamFlushTimer = setTimeout(() => {
        streamFlushTimer = undefined;
        if (streamRawMerged !== streamRawPersisted || streamReasoningDeltaMerged !== streamReasoningDeltaPersisted) {
          flushStreamMessage(false);
        }
      }, STREAM_FLUSH_INTERVAL_MS);
    };

    try {
      await this.providerClient.chatStream(
        pending.providerMessages,
        pending.providerConfig,
        {
          onDelta: (delta) => {
            streamRawMerged += delta;
            scheduleStreamFlush();
          },
          onReasoningDelta: (delta) => {
            streamReasoningDeltaMerged += delta;
            scheduleStreamFlush();
          },
          onDone: () => {
            if (streamFlushTimer) {
              clearTimeout(streamFlushTimer);
              streamFlushTimer = undefined;
            }
            flushStreamMessage(true);
          }
        },
        pending.locale,
        this.abortController?.signal,
        { toolRounds: pending.toolRounds }
      );
    } catch (error) {
      if (streamFlushTimer) {
        clearTimeout(streamFlushTimer);
        streamFlushTimer = undefined;
      }
      const partialSplit = splitThinkTaggedContent(streamRawMerged);
      const partial = partialSplit.content.trim();
      const reasoningPartial = mergeReasoningParts(streamReasoningDeltaMerged, partialSplit.reasoning);
      const errorMsg = error instanceof Error ? error.message : strings.unknownError;
      const fallbackContent = partial ? `${partial}\n\n${errorMsg}` : errorMsg;
      this.repository.updateLastAssistantMessage(
        pending.assistant.id,
        pending.sessionId,
        (current) => ({
          id: current?.id ?? pending.assistantMessageId,
          role: 'assistant',
          content: fallbackContent,
          timestamp: nowTs(),
          model: pending.providerConfig.modelLabel,
          reasoning: reasoningPartial || undefined,
          toolRounds: chatToolRounds
        }),
        true
      );
      this.postState(undefined, context);
    }
  }

  private async continuePendingToolCalls(context?: PanelMessageContext): Promise<void> {
    const pending = this.pendingToolContinuation;
    if (!pending) {
      return;
    }
    if (this.isGenerating) {
      this.postError(getStrings(this.getLocale()).generationBusy, context);
      return;
    }

    const targetContext = this.buildToolContinuationContext(pending, context);
    const strings = getStrings(pending.locale);

    this.pendingToolContinuation = undefined;
    this.isGenerating = true;
    this.abortController = new AbortController();
    this.abortReason = undefined;
    const timeoutHandle = setTimeout(() => {
      this.stopGeneration('timeout');
    }, pending.providerConfig.timeoutMs);

    this.postState(undefined, targetContext);

    try {
      await this.runToolCallingBatch(pending, targetContext);
    } catch (error) {
      let fallback: string;
      if (this.abortReason === 'manual') {
        fallback = strings.generationStopped;
      } else if (this.abortReason === 'timeout') {
        fallback = strings.requestTimeout;
      } else if (error instanceof Error) {
        const errorMsg = error.message.toLowerCase();
        if (errorMsg.includes('fetch') || errorMsg.includes('network')) {
          fallback = strings.networkError || error.message;
        } else if (errorMsg.includes('401') || errorMsg.includes('unauthorized')) {
          fallback = strings.authFailed || error.message;
        } else if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
          fallback = strings.rateLimitExceeded || error.message;
        } else if (errorMsg.includes('timeout')) {
          fallback = strings.requestTimeout;
        } else {
          fallback = error.message || strings.unknownError;
        }
      } else {
        fallback = strings.unknownError;
      }

      this.applyProviderResultToAssistantMessage(
        pending.assistant.id,
        pending.sessionId,
        pending.assistantMessageId,
        pending.result,
        pending.providerConfig.modelLabel,
        {
          fallbackContent: fallback
        }
      );
      this.pendingToolContinuation = undefined;
      this.postError(fallback, targetContext);
      this.postState(fallback, targetContext);
    } finally {
      clearTimeout(timeoutHandle);
      this.isGenerating = false;
      this.abortController = undefined;
      this.abortReason = undefined;
      this.postState(undefined, targetContext);
    }
  }

  private cancelPendingToolCalls(context?: PanelMessageContext): void {
    const pending = this.pendingToolContinuation;
    if (!pending) {
      return;
    }

    const targetContext = this.buildToolContinuationContext(pending, context);
    const strings = getStrings(pending.locale);
    this.applyProviderResultToAssistantMessage(
      pending.assistant.id,
      pending.sessionId,
      pending.assistantMessageId,
      pending.result,
      pending.providerConfig.modelLabel,
      {
        fallbackContent: strings.toolContinuationStoppedMessage || strings.generationStopped
      }
    );
    this.pendingToolContinuation = undefined;
    this.postState(undefined, targetContext);
  }

  private buildPayload(error?: string, assistantIdOverride?: string): ChatStatePayload {
    const locale = this.getLocale();
    const strings = getStrings(locale);
    const raw = this.repository.getState();
    const settings = this.repository.getSettings();
    const assistant =
      (assistantIdOverride ? this.repository.getAssistantById(assistantIdOverride) : undefined) ??
      this.repository.getSelectedAssistant();
    const sessions = assistant ? this.repository.getSessionsForAssistant(assistant.id) : [];
    const selectedSession = assistant ? this.repository.getSelectedSession(assistant.id) : undefined;

    this.syncSessionScopedState(assistant?.id, selectedSession?.id);

    let providerLabel = '-';
    let modelLabel = '-';
    let canChat = false;
    let readOnlyReason: string | undefined;
    const awaitingToolContinuation = Boolean(this.pendingToolContinuation);
    const pendingToolCallCount = this.pendingToolContinuation?.result.toolCalls?.length ?? 0;
    const mcpServers = this.mcpRuntime.getServerSummaries(settings, assistant);

    if (!assistant) {
      readOnlyReason = strings.noAssistantSelectedBody;
    } else if (assistant.isDeleted) {
      readOnlyReason = strings.assistantArchivedReadonly;
      const option = this.repository.resolveModelOption(assistant.modelRef);
      providerLabel = option?.providerName ?? '-';
      modelLabel = option?.label ?? assistant.modelRef ?? '-';
    } else {
      const resolved = this.resolveEffectiveProviderConfig(settings, assistant, selectedSession?.id);
      providerLabel = resolved.config.providerName || '-';
      modelLabel = resolved.config.modelLabel || assistant.modelRef || '-';
      canChat = true;
    }

    if (awaitingToolContinuation) {
      canChat = false;
      readOnlyReason = strings.toolContinuationReadonly || strings.generationBusy;
    }

    const assistantMeta = Object.fromEntries(
      raw.assistants.map((item) => {
        const localized = getAssistantLocalization(locale, item);
        return [
          item.id,
          {
            name: localized.name,
            subtitle: localized.subtitle,
            isDeleted: item.isDeleted
          }
        ];
      })
    );

    const selectedSessionId = selectedSession?.id || '';

    return {
      groups: raw.groups,
      assistants: raw.assistants,
      selectedAssistant: assistant,
      selectedAssistantId: assistant?.id,
      sessions,
      selectedSessionId,
      selectedSession,
      sessionPanelCollapsed: raw.sessionPanelCollapsed,
      locale,
      strings,
      assistantMeta,
      providerLabel,
      modelLabel,
      modelOptions: this.repository.getModelOptions(),
      sessionTempModelRef: selectedSessionId ? this.sessionTempModelRefBySession[selectedSessionId] ?? '' : '',
      sendShortcut: settings.sendShortcut,
      streaming: assistant?.streaming ?? this.streamingEnabled,
      isGenerating: this.isGenerating,
      canChat,
      mcpServers,
      awaitingToolContinuation,
      pendingToolCallCount,
      toolRoundLimit: settings.mcp.maxToolRounds,
      readOnlyReason,
      error
    };
  }

  private postState(error?: string, context?: PanelMessageContext): void {
    const targetPanel = context?.panel ?? this.panel;
    if (!targetPanel) {
      return;
    }
    const payload = this.buildPayload(error, context?.assistantId);
    const title = payload.selectedAssistant?.name?.trim() || payload.strings.chatPanelTitle;
    targetPanel.title = title;
    targetPanel.iconPath = getPanelIconPath(payload.selectedAssistant?.avatar ?? 'account');
    this.postMessage({ type: 'state', payload }, { panel: targetPanel });
  }

  private async sendMessage(content: string, context?: PanelMessageContext): Promise<void> {
    const normalized = content.trim();
    if (!normalized) {
      return;
    }
    if (this.isGenerating) {
      this.postError(getStrings(this.getLocale()).generationBusy, context);
      return;
    }

    const locale = this.getLocale();
    const strings = getStrings(locale);
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant) {
      this.postError(strings.noAssistantSelectedBody, context);
      this.postState(strings.noAssistantSelectedBody, context);
      return;
    }
    if (assistant.isDeleted) {
      this.postError(strings.assistantArchivedReadonly, context);
      this.postState(strings.assistantArchivedReadonly, context);
      return;
    }

    this.ensureSession(assistant.id);
    const selectedSession = this.repository.getSelectedSession(assistant.id);
    if (!selectedSession) {
      this.postError(strings.sessionNotFound, context);
      return;
    }

    const normalizedWithPrefix = applyQuestionPrefix(normalized, assistant.questionPrefix);
    const userMessage: ChatMessage = {
      id: createId('msg'),
      role: 'user',
      content: normalizedWithPrefix,
      timestamp: nowTs()
    };
    const sessionAfterUser = this.repository.appendMessage(assistant.id, selectedSession.id, userMessage);

    const settings = this.repository.getSettings();
    const resolved = this.resolveEffectiveProviderConfig(settings, assistant, selectedSession.id);
    const invalidReason = validateProviderConfig(resolved.config, locale, resolved.meta);
    if (invalidReason) {
      this.repository.appendMessage(assistant.id, selectedSession.id, {
        id: createId('msg'),
        role: 'assistant',
        content: invalidReason,
        timestamp: nowTs(),
        model: resolved.config.modelLabel
      });
      this.postError(invalidReason, context);
      this.postState(invalidReason, context);
      return;
    }

    const providerMessages = toProviderMessages(
      assistant.systemPrompt,
      assistant.questionPrefix,
      sessionAfterUser.messages,
      assistant.contextCount
    );
    const providerTools = await this.buildProviderTools(settings, assistant, resolved);
    const useToolCalling =
      providerTools.tools.length > 0 && this.providerSupportsToolCalling(resolved.config.modelRef, resolved.config);
    const useStreaming = assistant.streaming && !useToolCalling;

    const assistantMessage: ChatMessage = {
      id: createId('msg'),
      role: 'assistant',
      content: '',
      timestamp: nowTs(),
      model: resolved.config.modelLabel,
      reasoning: ''
    };
    this.repository.appendMessage(assistant.id, selectedSession.id, assistantMessage);

    this.isGenerating = true;
    this.abortController = new AbortController();
    this.abortReason = undefined;
    this.streamingEnabled = assistant.streaming;

    const timeoutHandle = setTimeout(() => {
      this.stopGeneration('timeout');
    }, resolved.config.timeoutMs);

    this.postState(undefined, context);

    let streamRawMerged = '';
    let streamRawPersisted = '';
    let streamReasoningDeltaMerged = '';
    let streamReasoningDeltaPersisted = '';
    let streamFlushTimer: ReturnType<typeof setTimeout> | undefined;
    const flushStreamMessage = (persist: boolean) => {
      const thinkSplit = splitThinkTaggedContent(streamRawMerged);
      const mergedTrimmed = thinkSplit.content.trim();
      const contentValue = mergedTrimmed ? mergedTrimmed : strings.emptyResponse;
      const reasoningValue = mergeReasoningParts(streamReasoningDeltaMerged, thinkSplit.reasoning);
      this.repository.updateLastAssistantMessage(
        assistant.id,
        selectedSession.id,
        (current) => ({
          id: current?.id ?? assistantMessage.id,
          role: 'assistant',
          content: contentValue,
          timestamp: nowTs(),
          model: resolved.config.modelLabel,
          reasoning: reasoningValue
        }),
        persist
      );
      streamRawPersisted = streamRawMerged;
      streamReasoningDeltaPersisted = streamReasoningDeltaMerged;
      this.postState(undefined, context);
    };
    const scheduleStreamFlush = () => {
      if (streamFlushTimer) {
        return;
      }
      streamFlushTimer = setTimeout(() => {
        streamFlushTimer = undefined;
        if (streamRawMerged !== streamRawPersisted || streamReasoningDeltaMerged !== streamReasoningDeltaPersisted) {
          flushStreamMessage(false);
        }
      }, STREAM_FLUSH_INTERVAL_MS);
    };

    try {
      if (useStreaming) {
        await this.providerClient.chatStream(
          providerMessages,
          resolved.config,
          {
            onDelta: (delta) => {
              streamRawMerged += delta;
              scheduleStreamFlush();
            },
            onReasoningDelta: (delta) => {
              streamReasoningDeltaMerged += delta;
              scheduleStreamFlush();
            },
            onDone: () => {
              if (streamFlushTimer) {
                clearTimeout(streamFlushTimer);
                streamFlushTimer = undefined;
              }
              flushStreamMessage(true);
            }
          },
          locale,
          this.abortController.signal
        );
      } else {
        const result = await this.providerClient.chat(
          providerMessages,
          resolved.config,
          locale,
          this.abortController.signal,
          useToolCalling
            ? {
                tools: providerTools.tools
              }
            : {}
        );
        if (useToolCalling) {
          const runState: PendingToolContinuation = {
            assistant,
            sessionId: selectedSession.id,
            assistantMessageId: assistantMessage.id,
            settings,
            locale,
            providerMessages,
            providerTools,
            providerConfig: resolved.config,
            toolRounds: [],
            result
          };
          await this.runToolCallingBatch(runState, context);
          return;
        }
        this.applyProviderResultToAssistantMessage(
          assistant.id,
          selectedSession.id,
          assistantMessage.id,
          result,
          resolved.config.modelLabel,
          {
            fallbackContent: strings.emptyResponse
          }
        );
      }
    } catch (error) {
      if (streamFlushTimer) {
        clearTimeout(streamFlushTimer);
        streamFlushTimer = undefined;
      }

      let fallback: string;
      if (this.abortReason === 'manual') {
        fallback = strings.generationStopped;
      } else if (this.abortReason === 'timeout') {
        fallback = strings.requestTimeout;
      } else if (error instanceof Error) {
        const errorMsg = error.message.toLowerCase();
        if (errorMsg.includes('fetch') || errorMsg.includes('network')) {
          fallback = strings.networkError || error.message;
        } else if (errorMsg.includes('401') || errorMsg.includes('unauthorized')) {
          fallback = strings.authFailed || error.message;
        } else if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
          fallback = strings.rateLimitExceeded || error.message;
        } else if (errorMsg.includes('timeout')) {
          fallback = strings.requestTimeout;
        } else {
          fallback = error.message || strings.unknownError;
        }
      } else {
        fallback = strings.unknownError;
      }

      const partialSplit = splitThinkTaggedContent(streamRawMerged);
      const partial = partialSplit.content.trim();
      const reasoningPartial = mergeReasoningParts(streamReasoningDeltaMerged, partialSplit.reasoning);
      const fallbackMessage = partial ? `${partial}\n\n${fallback}` : fallback;
      this.repository.updateLastAssistantMessage(assistant.id, selectedSession.id, (current) => ({
        id: current?.id ?? assistantMessage.id,
        role: 'assistant',
        content: fallbackMessage,
        timestamp: nowTs(),
        model: resolved.config.modelLabel,
        reasoning: reasoningPartial
      }));

      this.postError(fallback, context);
      this.postState(fallback, context);
    } finally {
      clearTimeout(timeoutHandle);
      this.isGenerating = false;
      this.abortController = undefined;
      this.abortReason = undefined;
      this.postState(undefined, context);
      // Trigger background title generation after response completes
      const currentSession = this.repository.getSessionById(selectedSession.id);
      if (currentSession && currentSession.titleSource === 'default') {
        this.triggerTitleGeneration(assistant.id, currentSession.id).catch(() => {});
      }
    }
  }

  private async triggerTitleGeneration(assistantId: string, sessionId: string): Promise<void> {
    const settings = this.repository.getSettings();
    const titleBinding = settings.defaultModels.titleSummary;
    if (!titleBinding) {
      return;
    }
    const session = this.repository.getSessionById(sessionId);
    if (!session || session.assistantId !== assistantId || session.titleSource !== 'default') {
      return;
    }

    const { config, meta } = resolveModelBindingConfig(settings, titleBinding, {
      maxTokens: 4000,
      temperature: 0.5,
      contextCount: 4,
      timeoutMs: 30000
    });
    if (!meta.providerExists || !meta.providerEnabled || !meta.modelExists) {
      return;
    }

    const locale = this.getLocale();
    const prompt = settings.defaultModels.titleSummaryPrompt?.trim() || DEFAULT_TITLE_SUMMARY_PROMPT;

    try {
      const contextMessages = session.messages
        .slice(-6)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const result = await this.providerClient.chat(
        [{ role: 'system', content: prompt }, ...contextMessages],
        config,
        locale,
        AbortSignal.timeout(15000)
      );

      const title = result.text?.trim();
      if (title) {
        this.repository.generateSessionTitle(assistantId, sessionId, title);
      }
    } catch {}
  }

  private async regenerateReply(context?: PanelMessageContext): Promise<void> {
    const locale = this.getLocale();
    const strings = getStrings(locale);
    if (this.isGenerating) {
      this.postError(strings.generationBusy, context);
      return;
    }
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant || assistant.isDeleted) {
      return;
    }
    const session = this.repository.getSelectedSession(assistant.id);
    if (!session) {
      this.postError(strings.sessionNotFound, context);
      return;
    }

    let userIndex = -1;
    for (let i = session.messages.length - 1; i >= 0; i -= 1) {
      if (session.messages[i].role === 'user') {
        userIndex = i;
        break;
      }
    }
    if (userIndex < 0) {
      this.postError(strings.sessionNotFound, context);
      return;
    }

    const removedCount = Math.max(0, session.messages.length - userIndex);
    const confirmed = await this.confirmDangerousAction(
      formatString(strings.confirmRegenerateReply, { count: String(removedCount) }),
      strings.regenerateReplyAction
    );
    if (!confirmed) {
      return;
    }

    const userContent = session.messages[userIndex].content;
    this.repository.truncateSessionMessages(assistant.id, session.id, userIndex);
    await this.sendMessage(userContent, context);
  }

  private async regenerateFromMessage(messageId: string, context?: PanelMessageContext): Promise<void> {
    const locale = this.getLocale();
    const strings = getStrings(locale);
    if (this.isGenerating) {
      this.postError(strings.generationBusy, context);
      return;
    }
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant || assistant.isDeleted) {
      return;
    }
    const session = this.repository.getSelectedSession(assistant.id);
    if (!session) {
      this.postError(strings.sessionNotFound, context);
      return;
    }

    const targetIndex = session.messages.findIndex((message) => message.id === messageId);
    if (targetIndex < 0) {
      return;
    }

    let userIndex = -1;
    for (let i = targetIndex; i >= 0; i -= 1) {
      if (session.messages[i].role === 'user') {
        userIndex = i;
        break;
      }
    }
    if (userIndex < 0) {
      this.postError(strings.sessionNotFound, context);
      return;
    }

    const removedCount = Math.max(0, session.messages.length - userIndex);
    const confirmed = await this.confirmDangerousAction(
      formatString(strings.confirmRegenerateFromMessage, { count: String(removedCount) }),
      strings.regenerateFromMessageAction
    );
    if (!confirmed) {
      return;
    }

    const userContent = session.messages[userIndex].content;
    this.repository.truncateSessionMessages(assistant.id, session.id, userIndex);
    await this.sendMessage(userContent, context);
  }

  private async copyMessage(messageId: string): Promise<void> {
    const strings = getStrings(this.getLocale());
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant) {
      return;
    }
    const session = this.repository.getSelectedSession(assistant.id);
    if (!session) {
      return;
    }
    const message = session.messages.find((item) => item.id === messageId);
    if (!message) {
      return;
    }
    try {
      await vscode.env.clipboard.writeText(message.content);
      this.postMessage({
        type: 'toast',
        message: strings.copyMessageSuccess,
        tone: 'success'
      });
    } catch {
      this.postError(strings.unknownError);
    }
  }

  private async deleteMessage(messageId: string): Promise<void> {
    const strings = getStrings(this.getLocale());
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant) {
      return;
    }
    const session = this.repository.getSelectedSession(assistant.id);
    if (!session) {
      return;
    }
    const message = session.messages.find((item) => item.id === messageId);
    if (!message) {
      return;
    }
    const confirmed = await this.confirmDangerousAction(strings.confirmDeleteMessage, strings.deleteAction);
    if (!confirmed) {
      return;
    }
    this.repository.deleteMessage(assistant.id, session.id, messageId);
    this.postState();
  }

  private async editMessage(messageId: string, newContent: string): Promise<void> {
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant) {
      return;
    }
    const session = this.repository.getSelectedSession(assistant.id);
    if (!session) {
      return;
    }
    const message = session.messages.find((item) => item.id === messageId);
    if (!message) {
      return;
    }
    const trimmedContent = newContent.trim();
    if (!trimmedContent) {
      return;
    }
    this.repository.editMessage(assistant.id, session.id, messageId, trimmedContent);
    this.postState();
  }

  private async clearSession(): Promise<void> {
    const strings = getStrings(this.getLocale());
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant) {
      return;
    }
    const session = this.repository.getSelectedSession(assistant.id);
    if (!session) {
      return;
    }
    if (!session.messages.length) {
      return;
    }
    const confirmed = await this.confirmDangerousAction(strings.confirmClearSession, strings.clearAction);
    if (!confirmed) {
      return;
    }
    this.repository.clearSessionMessages(assistant.id, session.id);
    const greeting = assistant.greeting?.trim();
    if (greeting) {
      this.repository.appendMessage(assistant.id, session.id, {
        id: createId('msg'),
        role: 'assistant',
        content: greeting,
        timestamp: nowTs()
      });
    }
    this.postState();
  }

  private async confirmDangerousAction(message: string, actionLabel: string): Promise<boolean> {
    const confirmed = await vscode.window.showWarningMessage(message, { modal: true }, actionLabel);
    return confirmed === actionLabel;
  }
}
