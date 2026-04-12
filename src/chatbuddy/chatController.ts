import * as vscode from 'vscode';

import {
  buildChatStatePayload,
  resolveEffectiveProviderConfig as resolveChatPayloadProviderConfig,
  syncSessionScopedState,
  withGenerationState
} from './chatControllerPayload';
import { ChatGenerationService } from './chatControllerGenerationService';
import { ChatPanelManager } from './chatControllerPanelManager';
import {
  GenerationAbortReason,
  PendingToolContinuation,
  ToolCallOrchestrator,
  ToolOrchestratorPanelContext
} from './chatControllerToolOrchestrator';
import { routeChatControllerWebviewMessage } from './chatControllerWebviewRouter';
import { McpRuntime } from './mcpRuntime';
import { getDefaultSessionTitle, getStrings } from './i18n';
import { OpenAICompatibleClient, ProviderChatResult } from './providerClient';
import { getPanelIconPath } from './panelIcon';
import { ChatStateRepository } from './stateRepository';
import { getChatWebviewHtml } from './webview';
import {
  AssistantProfile,
  ChatStatePayload,
  ChatBuddySettings,
  ProviderModelOption,
  ProviderConfig,
  RuntimeLocale,
  WebviewInboundMessage,
  WebviewOutboundMessage
} from './types';
import { getLocaleFromSettings, toErrorMessage } from './utils';
import { STREAM_STATE_POST_INTERVAL_MS } from './streamAccumulator';

export type PanelMessageContext = ToolOrchestratorPanelContext;

type PayloadBaseCache = {
  state: ReturnType<ChatStateRepository['getState']>;
  version: number;
  expiresAt: number;
  assistantId: string;
  selectedAssistant: import('./types').AssistantProfile | undefined;
  sessions: import('./types').ChatSessionSummary[];
  selectedSession: import('./types').ChatSessionDetail | undefined;
};

export class ChatController {
  private streamStatePostTimers = new WeakMap<vscode.WebviewPanel, ReturnType<typeof setTimeout>>();
  private payloadBaseCache: PayloadBaseCache | undefined;
  private streamingEnabled: boolean;
  private isGenerating = false;
  private pendingToolContinuation: PendingToolContinuation | undefined;
  private abortController: AbortController | undefined;
  private abortReason: GenerationAbortReason | undefined;
  private sessionTempModelRefBySession: Record<string, string> = {};
  private lastSelectedSessionIdByAssistant: Record<string, string | undefined> = {};
  private modelOptions: ProviderModelOption[];
  private readonly toolOrchestrator: ToolCallOrchestrator;
  private readonly generationService: ChatGenerationService;
  private readonly panelManager: ChatPanelManager;

  private get panel(): vscode.WebviewPanel | undefined {
    return this.panelManager.getActivePanel();
  }

  private set panel(panel: vscode.WebviewPanel | undefined) {
    this.panelManager.setActivePanel(panel);
  }

  private get panelsByAssistantId(): Map<string, vscode.WebviewPanel> {
    return this.panelManager.getPanelsByAssistantId();
  }

  constructor(
    private readonly repository: ChatStateRepository,
    private readonly providerClient: OpenAICompatibleClient,
    private readonly mcpRuntime: McpRuntime,
    private readonly extensionUri: vscode.Uri
  ) {
    const assistant = this.repository.getSelectedAssistant();
    this.streamingEnabled = assistant?.streaming ?? this.repository.getSettings().streamingDefault;
    this.modelOptions = this.repository.getModelOptions();
    this.panelManager = new ChatPanelManager({
      repository: this.repository,
      extensionUri: this.extensionUri,
      getLocale: () => this.getLocale(),
      ensureSession: (assistantId) => this.ensureSession(assistantId),
      setStreamingEnabled: (enabled) => {
        this.streamingEnabled = enabled;
      },
      renderWebviewHtml: (webview) => getChatWebviewHtml(webview, this.extensionUri),
      handleWebviewMessage: (message, context) => this.handleWebviewMessage(message, context),
      handlePanelDisposing: (panel) => {
        this.stopGeneration('manual');
        const timeoutHandle = this.streamStatePostTimers.get(panel);
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          this.streamStatePostTimers.delete(panel);
        }
      }
    });
    this.toolOrchestrator = new ToolCallOrchestrator({
      repository: this.repository,
      providerClient: this.providerClient,
      mcpRuntime: this.mcpRuntime,
      getLocale: () => this.getLocale(),
      getPendingToolContinuation: () => this.pendingToolContinuation,
      setPendingToolContinuation: (pending) => {
        this.pendingToolContinuation = pending;
      },
      isGenerating: () => this.isGenerating,
      setIsGenerating: (generating) => {
        this.isGenerating = generating;
      },
      getAbortController: () => this.abortController,
      setAbortController: (controller) => {
        this.abortController = controller;
      },
      getAbortReason: () => this.abortReason,
      setAbortReason: (reason) => {
        this.abortReason = reason;
      },
      stopGeneration: (reason) => this.stopGeneration(reason),
      postError: (message, context) => this.postError(message, context),
      postState: (error, context) => this.postState(error, context),
      scheduleStreamStatePost: (context) => this.scheduleStreamStatePost(context),
      flushScheduledStreamStatePost: (context) => this.flushScheduledStreamStatePost(context)
    });
    this.generationService = new ChatGenerationService({
      repository: this.repository,
      providerClient: this.providerClient,
      toolOrchestrator: this.toolOrchestrator,
      getLocale: () => this.getLocale(),
      isGenerating: () => this.isGenerating,
      setIsGenerating: (generating) => {
        this.isGenerating = generating;
      },
      getAbortController: () => this.abortController,
      setAbortController: (controller) => {
        this.abortController = controller;
      },
      getAbortReason: () => this.abortReason,
      setAbortReason: (reason) => {
        this.abortReason = reason;
      },
      setStreamingEnabled: (enabled) => {
        this.streamingEnabled = enabled;
      },
      ensureSession: (assistantId) => this.ensureSession(assistantId),
      resolveEffectiveProviderConfig: (settings, assistant, sessionId) =>
        this.resolveEffectiveProviderConfig(settings, assistant, sessionId),
      postMessage: (message, context) => this.postMessage(message, context),
      postError: (message, context) => this.postError(message, context),
      postState: (error, context) => this.postState(error, context),
      scheduleStreamStatePost: (context) => this.scheduleStreamStatePost(context),
      flushScheduledStreamStatePost: (context) => this.flushScheduledStreamStatePost(context),
      confirmDangerousAction: (message, actionLabel) => this.confirmDangerousAction(message, actionLabel)
    });
  }

  private getLocale(): RuntimeLocale {
    return getLocaleFromSettings(this.repository.getSettings());
  }

  private getPayloadBaseState(): PayloadBaseCache['state'] {
    const currentVersion = this.repository.getVersion();
    const cached = this.payloadBaseCache;
    if (cached && cached.version === currentVersion && cached.expiresAt > Date.now()) {
      return cached.state;
    }
    if (!this.isGenerating) {
      this.payloadBaseCache = undefined;
      return this.repository.getState();
    }
    const state = this.repository.getState();
    // Also cache sessions data during streaming to avoid repeated SQLite queries
    const assistant =
      this.repository.getSelectedAssistant();
    const assistantId = assistant?.id || '';
    const sessions = assistant ? this.repository.getSessionsForAssistant(assistant.id) : [];
    const selectedSession = assistant ? this.repository.getSelectedSession(assistant.id) : undefined;
    this.payloadBaseCache = {
      state,
      version: currentVersion,
      expiresAt: Date.now() + STREAM_STATE_POST_INTERVAL_MS,
      assistantId,
      selectedAssistant: assistant,
      sessions,
      selectedSession
    };
    return state;
  }

  private getCachedSessions(assistantId: string): {
    assistant: import('./types').AssistantProfile | undefined;
    sessions: import('./types').ChatSessionSummary[];
    selectedSession: import('./types').ChatSessionDetail | undefined;
  } {
    const cached = this.payloadBaseCache;
    if (cached && cached.assistantId === assistantId && cached.expiresAt > Date.now()) {
      return {
        assistant: cached.selectedAssistant,
        sessions: cached.sessions,
        selectedSession: cached.selectedSession
      };
    }
    const assistant = this.repository.getSelectedAssistant();
    const sessions = assistant ? this.repository.getSessionsForAssistant(assistant.id) : [];
    const selectedSession = assistant ? this.repository.getSelectedSession(assistant.id) : undefined;
    return { assistant, sessions, selectedSession };
  }

  private getStateTargetPanel(context?: PanelMessageContext): vscode.WebviewPanel | undefined {
    return context?.panel ?? this.panelManager.getActivePanel();
  }

  private scheduleStreamStatePost(context?: PanelMessageContext): void {
    const targetPanel = this.getStateTargetPanel(context);
    if (!targetPanel || this.streamStatePostTimers.has(targetPanel)) {
      return;
    }
    const timeoutHandle = setTimeout(() => {
      this.streamStatePostTimers.delete(targetPanel);
      this.postState(undefined, context);
    }, STREAM_STATE_POST_INTERVAL_MS);
    this.streamStatePostTimers.set(targetPanel, timeoutHandle);
  }

  private flushScheduledStreamStatePost(context?: PanelMessageContext): void {
    const targetPanel = this.getStateTargetPanel(context);
    if (!targetPanel) {
      return;
    }
    const timeoutHandle = this.streamStatePostTimers.get(targetPanel);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      this.streamStatePostTimers.delete(targetPanel);
    }
    this.postState(undefined, context);
  }

  public openAssistantChat(assistantId?: string): void {
    this.panelManager.openAssistantChat(assistantId);
    this.postState();
  }

  public stopGeneration(reason: GenerationAbortReason = 'manual'): void {
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

  /**
   * Dispose the multi-tab panel for a given assistant (if any).
   * Called when an assistant is permanently deleted to prevent stale references.
   */
  public disposePanelForAssistant(assistantId: string): void {
    const sessions = this.repository.getSessionsForAssistant(assistantId);
    for (const session of sessions) {
      delete this.sessionTempModelRefBySession[session.id];
    }
    this.panelManager.disposePanelForAssistant(assistantId);
  }

  public setActivePanelChangeCallback(callback: () => void): void {
    this.panelManager.setActivePanelChangeCallback(callback);
  }

  public dispose(): void {
    this.stopGeneration('manual');
    this.panelManager.dispose();
  }

  public applySettings(settings: ChatBuddySettings): void {
    this.repository.updateSettings(settings);
    const assistant = this.repository.getSelectedAssistant();
    this.streamingEnabled = assistant?.streaming ?? settings.streamingDefault;
    this.modelOptions = this.repository.getModelOptions();
    this.postState();
  }

  private async handleWebviewMessage(message: WebviewInboundMessage, context?: PanelMessageContext): Promise<void> {
    if (context?.panel) {
      this.panelManager.setActivePanel(context.panel);
    }
    if (context?.assistantId) {
      const selectedAssistant = this.repository.getSelectedAssistant();
      if (selectedAssistant?.id !== context.assistantId) {
        this.repository.setSelectedAssistant(context.assistantId);
      }
    }

    await routeChatControllerWebviewMessage({
      message,
      context,
      repository: this.repository,
      getLocale: () => this.getLocale(),
      hasPendingToolContinuation: Boolean(this.pendingToolContinuation),
      postError: (errorMessage, targetContext) => this.postError(errorMessage, targetContext),
      postState: (errorMessage, targetContext) => this.postState(errorMessage, targetContext),
      createSessionForAssistant: (assistantId) => this.createSessionForAssistant(assistantId),
      ensureSession: (assistantId) => this.ensureSession(assistantId),
      sessionTempModelRefBySession: this.sessionTempModelRefBySession,
      setStreamingEnabled: (enabled) => {
        this.streamingEnabled = enabled;
      },
      regenerateReply: (targetContext) => this.regenerateReply(targetContext),
      regenerateFromMessage: (messageId, targetContext) => this.regenerateFromMessage(messageId, targetContext),
      copyMessage: (messageId) => this.copyMessage(messageId),
      deleteMessage: (messageId) => this.deleteMessage(messageId),
      editMessage: (messageId, newContent) => this.editMessage(messageId, newContent),
      clearSession: () => this.clearSession(),
      sendMessage: (content, targetContext) => this.sendMessage(content, targetContext),
      continuePendingToolCalls: (targetContext) => this.continuePendingToolCalls(targetContext),
      cancelPendingToolCalls: (targetContext) => this.cancelPendingToolCalls(targetContext),
      listMcpResources: (targetContext) => this.listMcpResources(targetContext),
      listMcpPrompts: (targetContext) => this.listMcpPrompts(targetContext),
      insertMcpResource: (serverId, uri, targetContext) => this.insertMcpResource(serverId, uri, targetContext),
      insertMcpPrompt: (serverId, name, args, targetContext) =>
        this.insertMcpPrompt(serverId, name, args, targetContext),
      stopGeneration: (reason) => this.stopGeneration(reason),
      confirmDangerousAction: (confirmMessage, actionLabel) => this.confirmDangerousAction(confirmMessage, actionLabel)
    });
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
    const targetPanel = context?.panel ?? this.panelManager.getActivePanel();
    void targetPanel?.webview.postMessage(message);
  }

  private postError(message: string, context?: PanelMessageContext): void {
    this.postMessage({ type: 'error', message }, context);
  }

  private resolveEffectiveProviderConfig(settings: ChatBuddySettings, assistant: AssistantProfile, sessionId?: string) {
    return resolveChatPayloadProviderConfig({
      settings,
      assistant,
      sessionId,
      sessionTempModelRefBySession: this.sessionTempModelRefBySession
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
      this.postError(toErrorMessage(error, getStrings(this.getLocale()).unknownError), context);
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
      this.postError(toErrorMessage(error, getStrings(this.getLocale()).unknownError), context);
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
      this.postError(toErrorMessage(error, getStrings(this.getLocale()).unknownError), context);
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
      this.postError(toErrorMessage(error, getStrings(this.getLocale()).unknownError), context);
    }
  }

  private providerSupportsToolCalling(
    modelRef: string,
    config: Pick<ProviderConfig, 'apiType' | 'providerKind'>
  ): boolean {
    return this.toolOrchestrator.providerSupportsToolCalling(modelRef, config);
  }

  private async buildProviderTools(
    settings: ChatBuddySettings,
    assistant: import('./types').AssistantProfile,
    resolved: ReturnType<ChatController['resolveEffectiveProviderConfig']>
  ) {
    return this.toolOrchestrator.buildProviderTools(settings, assistant, resolved.config);
  }

  private applyProviderResultToAssistantMessage(
    assistantId: string,
    sessionId: string,
    assistantMessageId: string,
    result: ProviderChatResult,
    modelLabel: string,
    options?: {
      fallbackContent?: string;
      toolRounds?: import('./types').ChatToolRound[];
    }
  ): void {
    this.toolOrchestrator.applyProviderResultToAssistantMessage(
      assistantId,
      sessionId,
      assistantMessageId,
      result,
      modelLabel,
      options
    );
  }

  private async runToolCallingBatch(
    pending: PendingToolContinuation,
    context?: PanelMessageContext
  ): Promise<'completed' | 'paused'> {
    return this.toolOrchestrator.runToolCallingBatch(pending, context);
  }

  private async continuePendingToolCalls(context?: PanelMessageContext): Promise<void> {
    await this.toolOrchestrator.continuePendingToolCalls(context);
  }

  private cancelPendingToolCalls(context?: PanelMessageContext): void {
    this.toolOrchestrator.cancelPendingToolCalls(context);
  }

  private buildPayload(error?: string, assistantIdOverride?: string): ChatStatePayload {
    const locale = this.getLocale();
    const raw = this.getPayloadBaseState();
    const assistant =
      (assistantIdOverride ? this.repository.getAssistantById(assistantIdOverride) : undefined) ??
      this.repository.getSelectedAssistant();
    const { sessions, selectedSession } = this.getCachedSessions(assistant?.id || '');

    syncSessionScopedState({
      assistantId: assistant?.id,
      selectedSessionId: selectedSession?.id,
      lastSelectedSessionIdByAssistant: this.lastSelectedSessionIdByAssistant,
      sessionTempModelRefBySession: this.sessionTempModelRefBySession
    });

    return withGenerationState(
      buildChatStatePayload({
        locale,
        rawState: raw,
        assistant,
        sessions,
        selectedSession,
        pendingToolContinuation: this.pendingToolContinuation,
        getModelOption: (modelRef) => this.repository.resolveModelOption(modelRef),
        getServerSummaries: (settings, currentAssistant) => this.mcpRuntime.getServerSummaries(settings, currentAssistant),
        resolveProviderConfigForAssistant: (settings, currentAssistant, sessionId) =>
          this.resolveEffectiveProviderConfig(settings, currentAssistant, sessionId),
        modelOptions: this.modelOptions,
        sessionTempModelRefBySession: this.sessionTempModelRefBySession,
        streamingEnabled: this.streamingEnabled,
        error
      }),
      this.isGenerating
    );
  }

  private postState(error?: string, context?: PanelMessageContext): void {
    const targetPanel = context?.panel ?? this.panelManager.getActivePanel();
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
    await this.generationService.sendMessage(content, context);
  }

  private async regenerateReply(context?: PanelMessageContext): Promise<void> {
    await this.generationService.regenerateReply(context);
  }

  private async regenerateFromMessage(messageId: string, context?: PanelMessageContext): Promise<void> {
    await this.generationService.regenerateFromMessage(messageId, context);
  }

  private async copyMessage(messageId: string): Promise<void> {
    await this.generationService.copyMessage(messageId);
  }

  private async deleteMessage(messageId: string): Promise<void> {
    await this.generationService.deleteMessage(messageId);
  }

  private async editMessage(messageId: string, newContent: string): Promise<void> {
    await this.generationService.editMessage(messageId, newContent);
  }

  private async clearSession(): Promise<void> {
    await this.generationService.clearSession();
  }

  private async confirmDangerousAction(message: string, actionLabel: string): Promise<boolean> {
    const confirmed = await vscode.window.showWarningMessage(message, { modal: true }, actionLabel);
    return confirmed === actionLabel;
  }
}
