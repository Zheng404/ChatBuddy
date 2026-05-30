/**
 * ChatBuddy 聊天控制器核心协调器。
 *
 * `ChatController` 聚合 `ChatGenerationService`、`ChatPanelManager` 和 `ToolCallOrchestrator`
 * 三个子服务，负责 WebView 消息路由、状态载荷构建、面板生命周期管理。
 *
 * 本身不处理业务细节，而是将消息分发到对应的服务模块，
 * 并负责 Extension Host ↔ WebView 的状态同步。
 */
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
import { OpenAICompatibleClient } from './providerClient';
import { getPanelIconPath } from './panelIcon';
import { ChatStateRepository } from './stateRepository';
import { getChatWebviewHtml } from './webview';
import {
  AssistantProfile,
  ChatStatePayload,
  ChatBuddySettings,
  ProviderModelOption,
  RuntimeLocale,
  SessionTempParams,
  WebviewInboundMessage,
  WebviewOutboundMessage
} from './types';
import { getLocaleFromSettings, warn } from './utils';
import { STREAM_STATE_POST_INTERVAL_MS, STREAM_FULL_STATE_POST_INTERVAL_MS } from './streamAccumulator';
import { ChatStateCache } from './chatControllerStateCache';
import {
  listMcpResources,
  listMcpPrompts,
  insertMcpResource,
  insertMcpPrompt,
  type McpOperationDeps
} from './chatControllerMcpOperations';

export type PanelMessageContext = ToolOrchestratorPanelContext;

/**
 * ChatBuddy 聊天控制器核心协调器。
 *
 * 聚合 `ChatGenerationService`、`ChatPanelManager` 和 `ToolCallOrchestrator`
 * 三个子服务，负责 WebView 消息路由、状态载荷构建、面板生命周期管理，
 * 并负责 Extension Host ↔ WebView 的状态同步。
 */
export class ChatController {
  private streamStatePostTimers = new WeakMap<vscode.WebviewPanel, ReturnType<typeof setTimeout>>();
  private readonly stateCache: ChatStateCache;
  private readonly mcpDeps: McpOperationDeps;
  private streamingEnabled: boolean;
  private _isGenerating = false;
  private pendingToolContinuation: PendingToolContinuation | undefined;
  private abortController: AbortController | undefined;
  private abortReason: GenerationAbortReason | undefined;
  private sessionTempModelRefBySession: Record<string, string> = {};
  private sessionTempParamsBySession: Record<string, SessionTempParams> = {};
  private lastSelectedSessionIdByAssistant: Record<string, string | undefined> = {};
  private modelOptionsCache: {
    options: ProviderModelOption[];
    version: number;
    map: Map<string, ProviderModelOption>;
  } | undefined;
  private readonly toolOrchestrator: ToolCallOrchestrator;
  private readonly generationService: ChatGenerationService;
  private readonly panelManager: ChatPanelManager;

  /**
   * 创建聊天控制器实例。
   * @param repository - 状态仓库
   * @param providerClient - OpenAI 兼容客户端
   * @param mcpRuntime - MCP 运行时
   * @param extensionUri - 扩展根目录 URI
   */
  constructor(
    private readonly repository: ChatStateRepository,
    private readonly providerClient: OpenAICompatibleClient,
    private readonly mcpRuntime: McpRuntime,
    private readonly extensionUri: vscode.Uri
  ) {
    const assistant = this.repository.getSelectedAssistant();
    this.streamingEnabled = assistant?.streaming ?? this.repository.getSettings().streamingDefault;
    this.getModelOptions();
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
        if (this._isGenerating) {
          this.stopGeneration('manual');
        }
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
      isGenerating: () => this._isGenerating,
      setIsGenerating: (generating) => {
        // Intentional: both toolOrchestrator and generationService register setIsGenerating.
        // Either service can independently end generation (tool result processing vs. stream completion),
        // so both paths need to clear the flag.
        this._isGenerating = generating;
        void vscode.commands.executeCommand('setContext', 'chatBuddyIsGenerating', generating);
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
      isGenerating: () => this._isGenerating,
      // Intentional duplicate: see comment above in toolOrchestrator setIsGenerating.
      setIsGenerating: (generating) => {
        this._isGenerating = generating;
        void vscode.commands.executeCommand('setContext', 'chatBuddyIsGenerating', generating);
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
      postStreamDelta: (content, reasoning, context) => this.postStreamDelta(content, reasoning, context),
      scheduleStreamStatePost: (context) => this.scheduleStreamStatePost(context),
      flushScheduledStreamStatePost: (context) => this.flushScheduledStreamStatePost(context),
      confirmDangerousAction: (message, actionLabel) => this.confirmDangerousAction(message, actionLabel)
    });
    this.stateCache = new ChatStateCache(this.repository, STREAM_FULL_STATE_POST_INTERVAL_MS);
    this.mcpDeps = {
      repository: this.repository,
      mcpRuntime: this.mcpRuntime,
      getLocale: () => this.getLocale(),
      postMessage: (message, context) => this.postMessage(message, context),
      postError: (message, context) => this.postError(message, context)
    };
  }

  private getLocale(): RuntimeLocale {
    return getLocaleFromSettings(this.repository.getSettings());
  }

  private getRuntimeStrings(): Record<string, string> {
    return getStrings(this.getLocale());
  }

  private getModelOptions(): ProviderModelOption[] {
    const currentVersion = this.repository.getVersion();
    if (this.modelOptionsCache && this.modelOptionsCache.version === currentVersion) {
      return this.modelOptionsCache.options;
    }
    const options = this.repository.getModelOptions(false, this.getRuntimeStrings());
    const map = new Map(options.map(o => [o.ref, o]));
    this.modelOptionsCache = { options, version: currentVersion, map };
    return options;
  }

  private resolveModelOption(modelRef: string | undefined): ProviderModelOption | undefined {
    if (!modelRef) { return undefined; }
    const options = this.getModelOptions();
    return this.modelOptionsCache?.map.get(modelRef) ?? options.find(o => o.ref === modelRef);
  }

  private getStateTargetPanel(context?: PanelMessageContext): vscode.WebviewPanel | undefined {
    return context?.panel ?? this.panelManager.getActivePanel();
  }

  private scheduleStreamStatePost(context?: PanelMessageContext): void {
    const targetPanel = this.getStateTargetPanel(context);
    if (!targetPanel || this.streamStatePostTimers.has(targetPanel)) {
      return;
    }
    const interval = this._isGenerating ? STREAM_FULL_STATE_POST_INTERVAL_MS : STREAM_STATE_POST_INTERVAL_MS;
    const timeoutHandle = setTimeout(() => {
      this.streamStatePostTimers.delete(targetPanel);
      this.postState(undefined, context);
    }, interval);
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

  /**
   * 打开指定助手的聊天面板（若未创建则新建）。
   * @param assistantId - 可选的助手 ID，不传入则使用当前选中助手
   */
  public openAssistantChat(assistantId?: string): void {
    const { panel, panelReady } = this.panelManager.openAssistantChat(assistantId);
    const selectedAssistantId = this.repository.getSelectedAssistant()?.id;
    if (!panelReady) {
      this.panelManager.queuePendingState(panel, {
        assistantId: selectedAssistantId
      });
      return;
    }
    this.postState(undefined, {
      panel,
      assistantId: selectedAssistantId
    });
  }

  /**
   * 预填充聊天输入框内容并打开对应面板。
   * @param content - 要预填充的内容
   * @param assistantId - 可选的助手 ID
   */
  public prefillComposer(content: string, assistantId?: string): void {
    if (!content.trim()) {
      return;
    }
    this.openAssistantChat(assistantId);
    const targetPanel = this.panelManager.getActivePanel();
    if (!targetPanel) {
      return;
    }
    const selectedAssistantId = this.repository.getSelectedAssistant()?.id;
    if (!this.panelManager.isPanelReady(targetPanel)) {
      this.panelManager.queuePendingState(targetPanel, {
        assistantId: selectedAssistantId,
        composerPrefill: content
      });
      return;
    }
    this.postMessage(
      {
        type: 'prefillComposer',
        content
      },
      { panel: targetPanel, assistantId: selectedAssistantId }
    );
  }

  /**
   * 停止当前正在进行的生成过程。
   * @param reason - 停止原因，默认为 'manual'
   */
  public stopGeneration(reason: GenerationAbortReason = 'manual'): void {
    this.abortReason = reason;
    this.abortController?.abort();
  }

  /**
   * 为当前选中的助手创建新会话。
   */
  public createSessionForSelectedAssistant(): void {
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant || assistant.isDeleted) {
      return;
    }
    this.createSessionForAssistant(assistant.id);
    this.postState();
  }

  /**
   * 重命名当前选中助手的指定会话。
   * @param sessionId - 会话 ID
   * @param title - 新标题
   */
  public renameSessionForSelectedAssistant(sessionId: string, title: string): void {
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant) {
      return;
    }
    this.repository.renameSession(assistant.id, sessionId, title);
    this.postState();
  }

  /**
   * 删除当前选中助手的指定会话。
   * @param sessionId - 会话 ID
   */
  public deleteSessionForSelectedAssistant(sessionId: string): void {
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant) {
      return;
    }
    this.repository.deleteSession(assistant.id, sessionId);
    delete this.sessionTempModelRefBySession[sessionId];
    delete this.sessionTempParamsBySession[sessionId];
    this.ensureSession(assistant.id);
    this.postState();
  }

  /**
   * 切换会话面板的折叠/展开状态。
   */
  public toggleSessionPanel(): void {
    const state = this.repository.getState();
    this.repository.setSessionPanelCollapsed(!state.sessionPanelCollapsed);
    this.postState();
  }

  /**
   * 释放指定助手的多标签面板（如存在）。
   * 在助手被永久删除时调用以防止悬空引用。
   * @param assistantId - 助手 ID
   */
  public disposePanelForAssistant(assistantId: string): void {
    const sessions = this.repository.getSessionsForAssistant(assistantId);
    for (const session of sessions) {
      delete this.sessionTempModelRefBySession[session.id];
      delete this.sessionTempParamsBySession[session.id];
    }
    delete this.lastSelectedSessionIdByAssistant[assistantId];
    this.panelManager.disposePanelForAssistant(assistantId);
  }

  /**
   * 设置活动面板变更时的回调函数。
   * @param callback - 回调函数
   */
  public setActivePanelChangeCallback(callback: () => void): void {
    this.panelManager.setActivePanelChangeCallback(callback);
  }

  /**
   * 将最新状态推送到当前活动的聊天面板。
   */
  public postStateToActivePanel(): void {
    this.postState();
  }

  /**
   * 查询当前是否正在生成消息。
   * @returns 若正在生成返回 true，否则返回 false
   */
  public isGenerating(): boolean {
    return this._isGenerating;
  }

  /**
   * 释放控制器资源，停止生成并清理所有定时器。
   */
  public dispose(): void {
    this.stopGeneration('manual');
    this.stateCache.clear();
    // 兜底清理：防止面板销毁回调未触发时定时器泄漏
    const panelSet = new Set([
      this.panelManager.getActivePanel(),
      ...this.panelManager.getPanelsByAssistantId().values()
    ]);
    for (const panel of panelSet) {
      if (!panel) {
        continue;
      }
      const handle = this.streamStatePostTimers.get(panel);
      if (handle) {
        clearTimeout(handle);
        this.streamStatePostTimers.delete(panel);
      }
    }
    this.panelManager.dispose();
  }

  /**
   * 应用新设置到控制器，更新流式开关和模型选项。
   * @param settings - 新设置对象
   */
  public applySettings(settings: ChatBuddySettings): void {
    const assistant = this.repository.getSelectedAssistant();
    this.streamingEnabled = assistant?.streaming ?? settings.streamingDefault;
    this.modelOptionsCache = undefined;
    this.postState();
  }

  /** Checks if an error is benign and should be silently ignored. */
  private isBenignError(error: unknown): boolean {
    if (error instanceof Error) {
      const name = error.name || '';
      const msg = error.message || '';
      return name === 'Canceled' || name === 'AbortError' || msg === 'Channel has been closed';
    }
    return false;
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

    try {
      await routeChatControllerWebviewMessage({
        message,
        context,
        repository: this.repository,
        getLocale: () => this.getLocale(),
        hasPendingToolContinuation: Boolean(this.pendingToolContinuation),
        isGenerating: this._isGenerating,
        handleReady: (targetContext) => this.handlePanelReady(targetContext),
        postError: (errorMessage, targetContext) => this.postError(errorMessage, targetContext),
        postState: (errorMessage, targetContext) => this.postState(errorMessage, targetContext),
        createSessionForAssistant: (assistantId) => this.createSessionForAssistant(assistantId),
        ensureSession: (assistantId) => this.ensureSession(assistantId),
        sessionTempModelRefBySession: this.sessionTempModelRefBySession,
        sessionTempParamsBySession: this.sessionTempParamsBySession,
        setStreamingEnabled: (enabled) => {
          this.streamingEnabled = enabled;
        },
        regenerateReply: (targetContext) => this.regenerateReply(targetContext),
        regenerateFromMessage: (messageId, targetContext) => this.regenerateFromMessage(messageId, targetContext),
        copyMessage: (messageId) => this.copyMessage(messageId),
        deleteMessage: (messageId) => this.deleteMessage(messageId),
        editMessage: (messageId, newContent, regenerate) => this.editMessage(messageId, newContent, regenerate),
        clearSession: () => this.clearSession(),
        sendMessage: (content, images, files, targetContext) => this.sendMessage(content, images, files, targetContext),
        selectFiles: (targetContext) => this.selectFiles(targetContext),
        selectImages: (targetContext) => this.selectImages(targetContext),
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
    } catch (error) {
      if (!this.isBenignError(error)) {
        warn('Unhandled webview message error:', error);
        this.postError(
          error instanceof Error ? error.message : String(error),
          context
        );
      }
    }
  }

  private handlePanelReady(context?: PanelMessageContext): void {
    const targetPanel = context?.panel ?? this.panelManager.getActivePanel();
    if (!targetPanel) {
      return;
    }
    const pending = this.panelManager.markPanelReady(targetPanel);
    this.postState(pending?.error, {
      panel: targetPanel,
      assistantId: pending?.assistantId ?? context?.assistantId
    });
    if (pending?.composerPrefill?.trim()) {
      this.postMessage(
        {
          type: 'prefillComposer',
          content: pending.composerPrefill
        },
        { panel: targetPanel, assistantId: pending?.assistantId ?? context?.assistantId }
      );
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
      delete this.sessionTempParamsBySession[previousSessionId];
    }
    return created.id;
  }

  private postMessage(message: WebviewOutboundMessage, context?: PanelMessageContext): void {
    const targetPanel = context?.panel ?? this.panelManager.getActivePanel();
    void targetPanel?.webview.postMessage(message).then(undefined, () => {});
  }

  private postError(message: string, context?: PanelMessageContext): void {
    this.postMessage({ type: 'error', message }, context);
  }

  private postStreamDelta(content: string, reasoning: string | undefined, context?: PanelMessageContext): void {
    const targetPanel = this.getStateTargetPanel(context);
    if (!targetPanel) { return; }
    const assistant = this.repository.getSelectedAssistant();
    const session = assistant ? this.repository.getSelectedSession(assistant.id) : undefined;
    const lastMessage = session?.messages?.[session.messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') { return; }

    targetPanel.webview.postMessage({
      type: 'streamDelta',
      payload: {
        messageId: lastMessage.id,
        content,
        reasoning,
        modelLabel: lastMessage.model || ''
      }
    });
  }

  private resolveEffectiveProviderConfig(settings: ChatBuddySettings, assistant: AssistantProfile, sessionId?: string) {
    return resolveChatPayloadProviderConfig({
      settings,
      assistant,
      sessionId,
      sessionTempModelRefBySession: this.sessionTempModelRefBySession,
      sessionTempParamsBySession: this.sessionTempParamsBySession
    });
  }

  private async listMcpResources(context?: PanelMessageContext): Promise<void> {
    return listMcpResources(this.mcpDeps, context);
  }

  private async listMcpPrompts(context?: PanelMessageContext): Promise<void> {
    return listMcpPrompts(this.mcpDeps, context);
  }

  private async insertMcpResource(serverId: string, uri: string, context?: PanelMessageContext): Promise<void> {
    return insertMcpResource(this.mcpDeps, serverId, uri, context);
  }

  private async insertMcpPrompt(
    serverId: string,
    name: string,
    args: Record<string, string>,
    context?: PanelMessageContext
  ): Promise<void> {
    return insertMcpPrompt(this.mcpDeps, serverId, name, args, context);
  }

  private async continuePendingToolCalls(context?: PanelMessageContext): Promise<void> {
    await this.toolOrchestrator.continuePendingToolCalls(context);
  }

  private cancelPendingToolCalls(context?: PanelMessageContext): void {
    this.toolOrchestrator.cancelPendingToolCalls(context);
  }

  private buildPayload(error?: string, assistantIdOverride?: string): ChatStatePayload {
    const locale = this.getLocale();
    const raw = this.stateCache.getBaseState(this._isGenerating);
    const assistant =
      (assistantIdOverride ? this.repository.getAssistantById(assistantIdOverride) : undefined) ??
      this.repository.getSelectedAssistant();
    const { sessions, selectedSession } = this.stateCache.getCachedSessions(assistant?.id || '');

    syncSessionScopedState({
      assistantId: assistant?.id,
      selectedSessionId: selectedSession?.id,
      lastSelectedSessionIdByAssistant: this.lastSelectedSessionIdByAssistant,
      sessionTempModelRefBySession: this.sessionTempModelRefBySession,
      sessionTempParamsBySession: this.sessionTempParamsBySession
    });

    return withGenerationState(
      buildChatStatePayload({
        locale,
        rawState: raw,
        assistant,
        sessions,
        selectedSession,
        pendingToolContinuation: this.pendingToolContinuation,
        getModelOption: (modelRef) => this.resolveModelOption(modelRef),
        getServerSummaries: (settings, currentAssistant) => {
          const summaries = this.mcpRuntime.getServerSummaries(settings, currentAssistant);
          const probeCache = this.repository.getMcpProbeCache();
          if (!probeCache || !Array.isArray(probeCache.entries)) {
            return summaries;
          }
          const probeMap = new Map<string, { success: boolean; probedAt: number; error?: string }>();
          for (const entry of probeCache.entries) {
            if (!entry || typeof entry !== 'object') { continue; }
            const e = entry as { serverId?: unknown; success?: unknown; probedAt?: unknown; error?: unknown };
            if (typeof e.serverId !== 'string' || typeof e.success !== 'boolean') { continue; }
            probeMap.set(e.serverId, {
              success: e.success,
              probedAt: typeof e.probedAt === 'number' ? e.probedAt : probeCache.lastProbeAt,
              error: typeof e.error === 'string' ? e.error : undefined
            });
          }
          return summaries.map((s) => {
            const probe = probeMap.get(s.id);
            return probe ? { ...s, lastProbe: probe } : s;
          });
        },
        resolveProviderConfigForAssistant: (settings, currentAssistant, sessionId) =>
          this.resolveEffectiveProviderConfig(settings, currentAssistant, sessionId),
        modelOptions: this.getModelOptions(),
        sessionTempModelRefBySession: this.sessionTempModelRefBySession,
        sessionTempParamsBySession: this.sessionTempParamsBySession,
        streamingEnabled: this.streamingEnabled,
        error
      }),
      this._isGenerating
    );
  }

  private postState(error?: string, context?: PanelMessageContext): void {
    const targetPanel = context?.panel ?? this.panelManager.getActivePanel();
    if (!targetPanel) {
      return;
    }
    if (!this.panelManager.isPanelReady(targetPanel)) {
      this.panelManager.queuePendingState(targetPanel, {
        error,
        assistantId: context?.assistantId
      });
      return;
    }
    const payload = this.buildPayload(error, context?.assistantId);
    const title = payload.selectedAssistant?.name?.trim() || payload.strings.chatPanelTitle;
    targetPanel.title = title;
    targetPanel.iconPath = getPanelIconPath(payload.selectedAssistant?.avatar ?? 'account');
    this.postMessage({ type: 'state', payload }, { panel: targetPanel });
  }

  private async sendMessage(content: string, images: Array<{ base64: string; mimeType: string }> | undefined, files: Array<{ name: string; content: string; language?: string }> | undefined, context?: PanelMessageContext): Promise<void> {
    await this.generationService.sendMessage(content, images, files, context);
  }

  /**
   * 重新生成当前会话的最后一条助手回复。
   * @param context - 可选的面板消息上下文
   * @returns Promise，生成完成后 resolve
   */
  public async regenerateReply(context?: PanelMessageContext): Promise<void> {
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

  private async editMessage(messageId: string, newContent: string, regenerate?: boolean): Promise<void> {
    await this.generationService.editMessage(messageId, newContent, regenerate);
  }

  private async clearSession(): Promise<void> {
    await this.generationService.clearSession();
  }

  private async confirmDangerousAction(message: string, actionLabel: string): Promise<boolean> {
    const confirmed = await vscode.window.showWarningMessage(message, { modal: true }, actionLabel);
    return confirmed === actionLabel;
  }

  private static readonly IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
  private static readonly IMAGE_MIME_MAP: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml'
  };

  private static readonly DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'pptx']);
  private static readonly MAX_PPTX_SLIDES = 100;

  /** Check if file content appears to be binary by scanning for NULL bytes. */
  private static isBinaryContent(bytes: Uint8Array): boolean {
    const limit = Math.min(bytes.length, 8192);
    for (let i = 0; i < limit; i++) {
      if (bytes[i] === 0) { return true; }
    }
    return false;
  }

  /**
   * Parse document content (PDF, DOCX, PPTX) into plain text.
   * Returns undefined if parsing fails.
   */
  private static async parseDocumentContent(
    ext: string,
    buffer: Buffer,
    _name: string
  ): Promise<string | undefined> {
    try {
      if (ext === 'pdf') {
        // Lazy-load pdf-parse to avoid DOMMatrix error at module load time
        // (pdf-parse bundle contains DOMMatrix which is undefined in some VS Code/Electron versions)
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        return result.text;
      }
      if (ext === 'docx') {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      }
      if (ext === 'pptx') {
        // PPTX 解析: 它是 ZIP 包，包含 XML 文件
        // 简单方案: 尝试用 mammoth 的底层解析, 或自行解压提取文本
        // 这里使用简单的 ZIP + XML 文本提取
        return ChatController.extractPptxText(buffer);
      }
    } catch (err) {
      warn('Error in parseDocumentContent:', err);
    }
    return undefined;
  }

  /**
   * Extract text from PPTX by unzipping the archive and reading slide XML.
   * PPTX files are ZIP archives containing XML slide content.
   */
  /**
   * Decode common XML entities in text content.
   */
  private static decodeXmlEntities(text: string): string {
    return text
      .replace(/\u0026lt;/g, '<')
      .replace(/\u0026gt;/g, '>')
      .replace(/\u0026amp;/g, '&')
      .replace(/\u0026quot;/g, '"')
      .replace(/\u0026apos;/g, "'");
  }

  /**
   * Extract text from PPTX by unzipping the archive and reading slide XML.
   * PPTX files are ZIP archives containing XML slide content.
   */
  private static async extractPptxText(buffer: Buffer): Promise<string | undefined> {
    try {
      const JSZip = await import('jszip');
      const zip = await JSZip.loadAsync(buffer);
      const texts: string[] = [];
      // Read all slide XML files (ppt/slides/slide*.xml)
      const slideFiles = Object.keys(zip.files)
        .filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
        .sort((a, b) => {
          const numA = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] || '0', 10);
          const numB = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] || '0', 10);
          return numA - numB;
        })
        .slice(0, ChatController.MAX_PPTX_SLIDES);
      for (const slidePath of slideFiles) {
        const content = await zip.files[slidePath].async('string');
        // Extract text between <a:t> tags (PPTX text nodes)
        const regex = /\u003ca:t\u003e([^\u003c]*)\u003c\/a:t\u003e/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
          if (match[1] && match[1].trim()) {
            texts.push(ChatController.decodeXmlEntities(match[1]));
          }
        }
      }
      if (texts.length > 0) {
        return texts.join('\n');
      }
    } catch (err) {
      warn('Error in extractPptxText:', err);
    }
    return undefined;
  }

  private async selectFiles(context?: PanelMessageContext): Promise<void> {
    const locale = this.getLocale();
    const strings = getStrings(locale);
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant || assistant.isDeleted) {
      return;
    }
    try {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: true,
        openLabel: strings.fileDropZoneHint || 'Select files',
        filters: {
          'Supported Files': ['ts', 'js', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'h',
            'cs', 'rb', 'php', 'swift', 'kt', 'html', 'css', 'scss', 'json', 'yaml',
            'yml', 'xml', 'sql', 'sh', 'md', 'txt', 'vue', 'svelte', 'graphql',
            'pdf', 'docx', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'],
          'Text & Code': ['ts', 'js', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'h',
            'cs', 'rb', 'php', 'swift', 'kt', 'html', 'css', 'scss', 'json', 'yaml',
            'yml', 'xml', 'sql', 'sh', 'md', 'txt', 'vue', 'svelte', 'graphql'],
          'Documents': ['pdf', 'docx', 'pptx'],
          'Images': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'],
          'All Files': ['*']
        }
      });
      if (!uris || !uris.length) {
        return;
      }
      const files: Array<{ name: string; content: string; language?: string }> = [];
      const images: Array<{ base64: string; mimeType: string }> = [];
      const maxSize = 100 * 1024;
      const maxLines = 500;
      for (const uri of uris) {
        try {
          const raw = await vscode.workspace.fs.readFile(uri);
          const name = uri.path.split('/').pop() || uri.path;
          const ext = name.split('.').pop()?.toLowerCase() || '';

          // Image files → base64 image channel
          if (ChatController.IMAGE_EXTENSIONS.has(ext)) {
            const mimeType = ChatController.IMAGE_MIME_MAP[ext] || 'image/png';
            const base64 = Buffer.from(raw).toString('base64');
            images.push({ base64, mimeType });
            continue;
          }

          // Document files (PDF, DOCX, PPTX) → parse to text
          if (ChatController.DOCUMENT_EXTENSIONS.has(ext)) {
            const parsed = await ChatController.parseDocumentContent(ext, Buffer.from(raw), name);
            if (parsed !== undefined) {
              let finalContent = parsed;
              if (parsed.length > maxSize) {
                const lines = parsed.split('\n');
                if (lines.length > maxLines) {
                  finalContent = lines.slice(0, maxLines).join('\n') + '\n// ... (' + (strings.fileTooLarge ? strings.fileTooLarge.replace(/{name}/g, name) : 'truncated') + ')';
                } else {
                  finalContent = parsed.substring(0, maxSize) + '\n// ... (' + (strings.fileTooLarge ? strings.fileTooLarge.replace(/{name}/g, name) : 'truncated') + ')';
                }
              }
              files.push({ name, content: finalContent });
              continue;
            }
            // Parsing failed → fall through to binary rejection
          }

          // Binary files → reject with toast
          if (ChatController.isBinaryContent(raw)) {
            const msg = (strings.fileBinaryRejected || 'Binary file not supported: {name}')
              .replace('{name}', name);
            this.postMessage({ type: 'toast', message: msg, tone: 'error' }, context);
            continue;
          }

          // Text files → read as UTF-8 with truncation
          const content = Buffer.from(raw).toString('utf-8');
          let finalContent = content;
          if (content.length > maxSize) {
            const lines = content.split('\n');
            if (lines.length > maxLines) {
              finalContent = lines.slice(0, maxLines).join('\n') + '\n// ... (' + (strings.fileTooLarge ? strings.fileTooLarge.replace(/{name}/g, name) : 'truncated') + ')';
            } else {
              finalContent = content.substring(0, maxSize) + '\n// ... (' + (strings.fileTooLarge ? strings.fileTooLarge.replace(/{name}/g, name) : 'truncated') + ')';
            }
          }
          files.push({ name, content: finalContent });
        } catch (err) {
          warn('Error reading selected file:', err);
        }
      }
      if (files.length > 0) {
        this.postMessage({ type: 'filesSelected', files }, context);
      }
      if (images.length > 0) {
        this.postMessage({ type: 'imagesSelected', images }, context);
      }
    } catch (err) {
      warn('Error in selectFiles dialog:', err);
    }
  }

  private async selectImages(context?: PanelMessageContext): Promise<void> {
    const assistant = this.repository.getSelectedAssistant();
    if (!assistant || assistant.isDeleted) {
      return;
    }
    try {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: true,
        openLabel: undefined,
        filters: {
          Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
        }
      });
      if (!uris || !uris.length) {
        return;
      }
      const images: Array<{ base64: string; mimeType: string }> = [];
      for (const uri of uris) {
        try {
          const raw = await vscode.workspace.fs.readFile(uri);
          const ext = uri.path.split('.').pop()?.toLowerCase() || '';
          const mimeType = ChatController.IMAGE_MIME_MAP[ext] || 'image/png';
          const base64 = Buffer.from(raw).toString('base64');
          images.push({ base64, mimeType });
        } catch (err) {
          warn('Error reading selected image:', err);
        }
      }
      if (images.length > 0) {
        this.postMessage({ type: 'imagesSelected', images }, context);
      }
    } catch (err) {
      warn('Error in selectImages dialog:', err);
    }
  }
}
