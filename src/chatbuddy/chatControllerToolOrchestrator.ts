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
    context?: ToolOrchestratorPanelContext
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
        pending.providerTools.localToolNames
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

      result = await this.deps.providerClient.chat(
        pending.providerMessages,
        pending.providerConfig,
        pending.locale,
        this.deps.getAbortController()?.signal,
        {
          tools: pending.providerTools.tools,
          toolRounds: pending.toolRounds
        }
      );
      pending.result = result;
    }

    this.deps.setPendingToolContinuation(undefined);

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
    const timeoutHandle = setTimeout(() => {
      this.deps.stopGeneration('timeout');
    }, pending.providerConfig.timeoutMs);

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
      clearTimeout(timeoutHandle);
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
    localToolNames: Set<string>
  ): Promise<ProviderToolRound['results']> {
    const results: ProviderToolRound['results'] = [];
    for (const toolCall of toolCalls) {
      if (!localToolNames.has(toolCall.name)) {
        continue;
      }
      try {
        const output = await this.deps.mcpRuntime.callBoundTool(
          settings,
          assistant,
          toolCall.name,
          toolCall.argumentsText
        );
        results.push({
          toolCallId: toolCall.id,
          output
        });
      } catch (error) {
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
    context?: ToolOrchestratorPanelContext
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
    const flush = buildStreamFlush(acc, params, this.deps.repository, strings, (persist) => {
      if (persist) {
        this.deps.flushScheduledStreamStatePost(context);
        return;
      }
      this.deps.scheduleStreamStatePost(context);
    });
    const callbacks = buildStreamCallbacks(acc, flush);

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
      const errorMsg = toErrorMessage(error, strings.unknownError);
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
    }
  }
}
