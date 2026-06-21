/**
 * 工具调用编排器。
 *
 * 负责 MCP 工具和本地函数工具的发现、构建、调用编排。
 * 处理工具调用链：Provider 返回 toolCalls → 执行工具 → 将结果回传给 Provider → 获取最终回复。
 *
 * 支持用户确认机制（危险操作需要显式确认），以及多轮工具调用的状态保持。
 */
import * as vscode from 'vscode';

import { getStrings } from './i18n';
import { mergeReasoningParts, splitThinkTaggedContent } from './chatUtils';
import { buildRemotePassthroughTools, McpRuntime } from './mcpRuntime';
import { OpenAICompatibleClient, ProviderChatResult, ProviderToolRound } from './providerClient';
import { ChatStateRepository } from './stateRepository';
import {
  buildStreamCallbacks,
  buildStreamErrorContent,
  buildStreamFlush,
  clearStreamFlush,
  createStreamAccumulator,
  StreamFlushParams
} from './streamAccumulator';
import {
  AssistantProfile,
  ChatBuddySettings,
  ChatToolRound,
  ProviderConfig,
  ProviderMessage,
  ProviderToolDefinition,
  RuntimeLocale,
  RuntimeStrings
} from './types';
import { nowTs } from './utils/id';
import { toErrorMessage } from './utils';

export type GenerationAbortReason = 'manual' | 'timeout';

export type ToolOrchestratorPanelContext = {
  panel: vscode.WebviewPanel;
  assistantId?: string;
  /**
   * 生成开始时绑定的目标会话 ID。
   *
   * 多面板模式下，切换面板会触发 `setSelectedAssistant`，导致 repository 当前选中会话变化。
   * 若不绑定，stream delta 会定位到切换后选中会话的末尾消息，而非实际生成目标（Bug 1）。
   */
  sessionId?: string;
};

export type BuiltProviderTools = {
  tools: ProviderToolDefinition[];
  localToolNames: Set<string>;
};

export type PendingToolContinuation = {
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

type ToolCallOrchestratorDeps = {
  repository: ChatStateRepository;
  providerClient: OpenAICompatibleClient;
  mcpRuntime: McpRuntime;
  getLocale: () => RuntimeLocale;
  getPendingToolContinuation: () => PendingToolContinuation | undefined;
  setPendingToolContinuation: (pending: PendingToolContinuation | undefined) => void;
  isGenerating: () => boolean;
  setIsGenerating: (generating: boolean) => void;
  getAbortController: () => AbortController | undefined;
  setAbortController: (controller: AbortController | undefined) => void;
  getAbortReason: () => GenerationAbortReason | undefined;
  setAbortReason: (reason: GenerationAbortReason | undefined) => void;
  stopGeneration: (reason?: GenerationAbortReason) => void;
  postError: (message: string, context?: ToolOrchestratorPanelContext) => void;
  postState: (error?: string, context?: ToolOrchestratorPanelContext) => void;
  scheduleStreamStatePost: (context?: ToolOrchestratorPanelContext) => void;
  flushScheduledStreamStatePost: (context?: ToolOrchestratorPanelContext) => void;
};

export function resolveGenerationErrorMessage(
  error: unknown,
  abortReason: GenerationAbortReason | undefined,
  strings: RuntimeStrings
): string {
  if (abortReason === 'manual') {
    return strings.generationStopped;
  }
  if (abortReason === 'timeout') {
    return strings.requestTimeout;
  }
  if (error instanceof Error) {
    const errorMsg = error.message.toLowerCase();
    if (errorMsg.includes('fetch') || errorMsg.includes('network')) {
      return strings.networkError || error.message;
    }
    if (errorMsg.includes('401') || errorMsg.includes('unauthorized')) {
      return strings.authFailed || error.message;
    }
    if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
      return strings.rateLimitExceeded || error.message;
    }
    if (errorMsg.includes('timeout')) {
      return strings.requestTimeout;
    }
    if (errorMsg.includes('aborted')) {
      return strings.requestTimeout;
    }
    return error.message || strings.unknownError;
  }
  return strings.unknownError;
}

export class ToolCallOrchestrator {
  constructor(private readonly deps: ToolCallOrchestratorDeps) {}

  public providerSupportsToolCalling(
    modelRef: string,
    config: Pick<ProviderConfig, 'apiType' | 'providerKind'>
  ): boolean {
    const option = this.deps.repository.resolveModelOption(modelRef);
    if (option?.capabilities?.tools) {
      return true;
    }
    if (option?.capabilities && option.capabilities.tools === false) {
      return false;
    }
    return config.apiType === 'chat_completions' || config.apiType === 'responses';
  }

  public async buildProviderTools(
    settings: ChatBuddySettings,
    assistant: AssistantProfile,
    providerConfig: Pick<ProviderConfig, 'apiType' | 'providerKind'>
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
      providerConfig.apiType === 'responses' && providerConfig.providerKind === 'openai'
    );
    const passthroughServerIds = new Set(passthrough.map((item) => item.serverId));
    const localBindings = (await this.deps.mcpRuntime.listToolBindings(settings, assistant)).filter(
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

  public applyProviderResultToAssistantMessage(
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
    const contentValue = baseContent || fallbackContent || getStrings(this.deps.getLocale()).emptyResponse;
    const reasoningValue = mergeReasoningParts(result.reasoning, thinkSplit.reasoning);
    this.deps.repository.updateLastAssistantMessage(assistantId, sessionId, (current) => ({
      id: current?.id ?? assistantMessageId,
      role: 'assistant',
      content: contentValue,
      timestamp: nowTs(),
      model: modelLabel,
      reasoning: reasoningValue,
      toolRounds: options?.toolRounds
    }));
  }

  public async runToolCallingBatch(
    pending: PendingToolContinuation,
    context?: ToolOrchestratorPanelContext,
    onFirstStreamToken?: () => void
  ): Promise<'completed' | 'paused'> {
    const maxRounds = Math.max(1, Math.floor(pending.settings.mcp.maxToolRounds) || 1);
    const targetContext = this.buildToolContinuationContext(pending, context);
    let result = pending.result;
    let roundCount = 0;
    const chatToolRounds: ChatToolRound[] = [];

    const extractReasoning = (providerResult: ProviderChatResult): string => {
      const split = splitThinkTaggedContent(providerResult.text);
      return mergeReasoningParts(providerResult.reasoning, split.reasoning) || '';
    };

    // Bug 1: 为每次 provider 模型请求设置独立请求超时。
    // 工具执行耗时不再挤占模型响应的超时预算（原 continuePendingToolCalls 全局超时会在
    // 工具轮次执行过程中提前触发 abort）。此处只覆盖单次 providerClient.chat，
    // 最终流式响应由 streamFinalResponse 的 FINAL_STREAM_TIMEOUT_MS 保护。
    const chatNextRound = async (): Promise<ProviderChatResult> => {
      let chatTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
      if (pending.providerConfig.timeoutMs > 0) {
        chatTimeoutHandle = setTimeout(() => {
          this.deps.setAbortReason('timeout');
          this.deps.getAbortController()?.abort();
        }, pending.providerConfig.timeoutMs);
      }
      try {
        return await this.deps.providerClient.chat(
          pending.providerMessages,
          pending.providerConfig,
          pending.locale,
          this.deps.getAbortController()?.signal,
          {
            tools: pending.providerTools.tools,
            toolRounds: pending.toolRounds
          }
        );
      } finally {
        if (chatTimeoutHandle) {
          clearTimeout(chatTimeoutHandle);
        }
      }
    };

    while ((result.toolCalls?.length ?? 0) > 0) {
      if (roundCount >= maxRounds) {
        pending.result = result;
        this.deps.setPendingToolContinuation(pending);
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
        this.deps.postState(undefined, targetContext);
        return 'paused';
      }

      const toolCalls = result.toolCalls ?? [];
      const roundReasoning = extractReasoning(result);
      const results = await this.executeToolRound(
        pending.settings,
        pending.assistant,
        toolCalls,
        pending.providerTools.localToolNames,
        this.deps.getAbortController()?.signal
      );
      if (results.length === 0) {
        break;
      }

      chatToolRounds.push({
        reasoning: roundReasoning || undefined,
        calls: toolCalls.map((call) => {
          const matched = results.find((item) => item.toolCallId === call.id);
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

      this.applyProviderResultToAssistantMessage(
        pending.assistant.id,
        pending.sessionId,
        pending.assistantMessageId,
        { text: '', reasoning: '' },
        pending.providerConfig.modelLabel,
        { toolRounds: chatToolRounds }
      );
      this.deps.postState(undefined, targetContext);

      result = await chatNextRound();
      pending.result = result;
    }

    this.deps.setPendingToolContinuation(undefined);

    if (pending.assistant.streaming) {
      await this.streamFinalResponse(pending, chatToolRounds, targetContext, onFirstStreamToken);
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

  public async continuePendingToolCalls(context?: ToolOrchestratorPanelContext): Promise<void> {
    const pending = this.deps.getPendingToolContinuation();
    if (!pending) {
      return;
    }
    if (this.deps.isGenerating()) {
      this.deps.postError(getStrings(this.deps.getLocale()).generationBusy, context);
      return;
    }

    const targetContext = this.buildToolContinuationContext(pending, context);
    const strings = getStrings(pending.locale);

    this.deps.setPendingToolContinuation(undefined);
    this.deps.setIsGenerating(true);
    this.deps.setAbortController(new AbortController());
    this.deps.setAbortReason(undefined);
    // Bug 1: 不再在工具轮次开始前设置全局超时。
    // 原实现会将工具执行耗时计入模型响应的超时预算，导致后续 providerClient.chat 误触发 abort。
    // 现拆分为各阶段独立超时：
    // - 工具执行：MCP server.timeoutMs + AbortSignal（Bug 2）
    // - 每次 provider 模型请求：runToolCallingBatch 内的 chatNextRound 独立超时
    // - 最终流式响应：streamFinalResponse 的 FINAL_STREAM_TIMEOUT_MS

    this.deps.postState(undefined, targetContext);

    try {
      await this.runToolCallingBatch(pending, targetContext);
    } catch (error) {
      const fallback = resolveGenerationErrorMessage(error, this.deps.getAbortReason(), strings);
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
      this.deps.setPendingToolContinuation(undefined);
      this.deps.postError(fallback, targetContext);
      this.deps.postState(fallback, targetContext);
    } finally {
      this.deps.setIsGenerating(false);
      this.deps.setAbortController(undefined);
      this.deps.setAbortReason(undefined);
      this.deps.postState(undefined, targetContext);
    }
  }

  public cancelPendingToolCalls(context?: ToolOrchestratorPanelContext): void {
    const pending = this.deps.getPendingToolContinuation();
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
    this.deps.setPendingToolContinuation(undefined);
    this.deps.postState(undefined, targetContext);
  }

  private buildToolContinuationContext(
    pending: PendingToolContinuation,
    context?: ToolOrchestratorPanelContext
  ): ToolOrchestratorPanelContext | undefined {
    if (!context?.panel) {
      return context;
    }
    return {
      panel: context.panel,
      assistantId: pending.assistant.id
    };
  }

  private async executeToolRound(
    settings: ChatBuddySettings,
    assistant: AssistantProfile,
    toolCalls: ProviderToolRound['toolCalls'],
    localToolNames: Set<string>,
    signal?: AbortSignal
  ): Promise<ProviderToolRound['results']> {
    const results: ProviderToolRound['results'] = [];
    for (const toolCall of toolCalls) {
      if (!localToolNames.has(toolCall.name)) {
        continue;
      }
      try {
        // Bug 2: 将 AbortSignal 传入工具调用链路，支持用户中断
        const output = await this.deps.mcpRuntime.callBoundTool(
          settings,
          assistant,
          toolCall.name,
          toolCall.argumentsText,
          signal
        );
        results.push({
          toolCallId: toolCall.id,
          output
        });
      } catch (error) {
        // Bug 2: 用户中断时立即向上抛出，不再继续执行后续工具调用
        if (signal?.aborted) {
          throw error;
        }
        results.push({
          toolCallId: toolCall.id,
          output: toErrorMessage(error, getStrings(this.deps.getLocale()).unknownError)
        });
      }
    }
    return results;
  }

  private async streamFinalResponse(
    pending: PendingToolContinuation,
    chatToolRounds: ChatToolRound[],
    context?: ToolOrchestratorPanelContext,
    onFirstToken?: () => void
  ): Promise<void> {
    const strings = getStrings(pending.locale);
    const acc = createStreamAccumulator();
    const params: StreamFlushParams = {
      assistantId: pending.assistant.id,
      sessionId: pending.sessionId,
      fallbackMessageId: pending.assistantMessageId,
      modelLabel: pending.providerConfig.modelLabel,
      toolRounds: chatToolRounds,
      context
    };

    // 最终流式响应的全局完成超时（Bug 2）：
    // attemptProviderGeneration / continuePendingToolCalls 的超时在首 token 到达或批次返回后被清除，
    // 此处需独立的完成超时，防止服务器通过持续发送空/keep-alive SSE 事件规避 per-read 超时。
    // 首 token 到达后仍保留，覆盖整个流式完成阶段。
    let completionTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (pending.providerConfig.timeoutMs > 0) {
      const FINAL_STREAM_TIMEOUT_MS = Math.max(pending.providerConfig.timeoutMs, 300_000);
      completionTimeoutHandle = setTimeout(() => {
        this.deps.setAbortReason('timeout');
        this.deps.getAbortController()?.abort();
      }, FINAL_STREAM_TIMEOUT_MS);
    }
    const clearCompletionTimeout = () => {
      if (completionTimeoutHandle) {
        clearTimeout(completionTimeoutHandle);
        completionTimeoutHandle = undefined;
      }
    };
    const flush = buildStreamFlush(acc, params, this.deps.repository, strings, (persist) => {
      if (persist) {
        this.deps.flushScheduledStreamStatePost(context);
        return;
      }
      this.deps.scheduleStreamStatePost(context);
    });
    const baseCallbacks = buildStreamCallbacks(acc, flush);

    // 首个流式 token 到达时清除全局超时
    let firstTokenFired = false;
    const callbacks = {
      onDelta: (delta: string) => {
        if (!firstTokenFired) {
          firstTokenFired = true;
          onFirstToken?.();
        }
        baseCallbacks.onDelta(delta);
      },
      onReasoningDelta: (delta: string) => {
        if (!firstTokenFired) {
          firstTokenFired = true;
          onFirstToken?.();
        }
        baseCallbacks.onReasoningDelta(delta);
      },
      onDone: baseCallbacks.onDone
    };

    try {
      await this.deps.providerClient.chatStream(
        pending.providerMessages,
        pending.providerConfig,
        callbacks,
        pending.locale,
        this.deps.getAbortController()?.signal,
        { toolRounds: pending.toolRounds }
      );
    } catch (error) {
      clearStreamFlush(acc);
      const errorMsg = resolveGenerationErrorMessage(error, this.deps.getAbortReason(), strings);
      const partial = buildStreamErrorContent(acc, errorMsg);
      this.deps.repository.updateLastAssistantMessage(
        pending.assistant.id,
        pending.sessionId,
        (current) => ({
          id: current?.id ?? pending.assistantMessageId,
          role: 'assistant',
          content: partial.content,
          timestamp: nowTs(),
          model: pending.providerConfig.modelLabel,
          reasoning: partial.reasoning,
          toolRounds: chatToolRounds
        }),
        true
      );
      this.deps.postState(undefined, context);
    } finally {
      // 无论流式成功结束还是异常中断，都清除完成超时（Bug 2）
      clearCompletionTimeout();
    }
  }
}
