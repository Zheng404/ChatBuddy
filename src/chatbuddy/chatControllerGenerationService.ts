/**
 * 聊天消息生成服务。
 *
 * 处理用户消息发送、流式/非流式响应生成、消息追加与更新、
 * 以及自动标题生成功能。
 *
 * 与 `ToolCallOrchestrator` 协作处理工具调用链，
 * 通过 `StreamAccumulator` 管理增量流数据的累积与节流刷新。
 */
import * as vscode from 'vscode';

import { TITLE_GENERATION } from './constants';
import { formatString, getStrings } from './i18n';
import { DEFAULT_TITLE_SUMMARY_PROMPT } from './modelCatalog';
import { applyQuestionPrefix, toProviderMessages } from './chatUtils';
import { resolveTemplateVariables } from './utils/template';
import {
  GenerationAbortReason,
  PendingToolContinuation,
  resolveGenerationErrorMessage,
  ToolCallOrchestrator,
  ToolOrchestratorPanelContext
} from './chatControllerToolOrchestrator';
import { HttpError, OpenAICompatibleClient, resolveFailoverChain, resolveModelBindingConfig, validateProviderConfig } from './providerClient';
import { resolveCapabilities } from './modelCapabilities';
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
  ChatMessage,
  ChatMessageImage,
  ProviderConfig,
  RuntimeLocale,
  WebviewOutboundMessage
} from './types';
import { warn } from './utils';
import { createId, nowTs } from './utils/id';

type ResolvedProviderConfig = ReturnType<typeof resolveModelBindingConfig>;

type ChatGenerationServiceDeps = {
  repository: ChatStateRepository;
  providerClient: OpenAICompatibleClient;
  toolOrchestrator: Pick<
    ToolCallOrchestrator,
    'applyProviderResultToAssistantMessage' | 'buildProviderTools' | 'providerSupportsToolCalling' | 'runToolCallingBatch'
  >;
  getLocale: () => RuntimeLocale;
  isGenerating: () => boolean;
  setIsGenerating: (generating: boolean) => void;
  getAbortController: () => AbortController | undefined;
  setAbortController: (controller: AbortController | undefined) => void;
  getAbortReason: () => GenerationAbortReason | undefined;
  setAbortReason: (reason: GenerationAbortReason | undefined) => void;
  setStreamingEnabled: (enabled: boolean) => void;
  ensureSession: (assistantId: string) => void;
  resolveEffectiveProviderConfig: (
    settings: ChatBuddySettings,
    assistant: AssistantProfile,
    sessionId?: string
  ) => ResolvedProviderConfig;
  postMessage: (message: WebviewOutboundMessage, context?: ToolOrchestratorPanelContext) => void;
  postError: (message: string, context?: ToolOrchestratorPanelContext) => void;
  postState: (error?: string, context?: ToolOrchestratorPanelContext) => void;
  scheduleStreamStatePost: (context?: ToolOrchestratorPanelContext) => void;
  flushScheduledStreamStatePost: (context?: ToolOrchestratorPanelContext) => void;
  confirmDangerousAction: (message: string, actionLabel: string) => Promise<boolean>;
};

/**
 * Determine if an error is retryable for provider failover.
 * Retryable: network errors, timeouts, rate limits (429), 5xx server errors.
 * Not retryable: auth errors (401), user abort, client errors (4xx except 429).
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpError) {
    // 408 = request timeout, 429 = rate limit, 5xx = server error
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // 精确匹配网络/超时错误，避免误判包含 "fetch" 的业务错误
    if (
      msg === 'fetch failed' ||
      msg.includes('network error') ||
      msg.includes('sse read timeout') ||
      msg.includes('request timeout') ||
      msg.includes('etimedout') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset')
    ) {
      return true;
    }
    // Abort errors from user cancellation should NOT failover
    if (msg.includes('aborted') && !msg.includes('timeout')) {
      return false;
    }
  }
  return false;
}

/**
 * Check if an error is an auth error (401) - should NOT failover.
 */
function isAuthError(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status === 401;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('401') || msg.includes('unauthorized');
  }
  return false;
}

export class ChatGenerationService {
  constructor(private readonly deps: ChatGenerationServiceDeps) {}

  public async sendMessage(content: string, images?: Array<{ base64: string; mimeType: string }>, files?: Array<{ name: string; content: string; language?: string }>, context?: ToolOrchestratorPanelContext): Promise<void> {
    const normalized = content.trim();
    if (!normalized && (!images || !images.length) && (!files || !files.length)) {
      return;
    }
    if (this.deps.isGenerating()) {
      this.deps.postError(getStrings(this.deps.getLocale()).generationBusy, context);
      return;
    }

    const locale = this.deps.getLocale();
    const strings = getStrings(locale);
    const assistant = this.deps.repository.getSelectedAssistant();
    if (!assistant) {
      this.deps.postError(strings.noAssistantSelectedBody, context);
      this.deps.postState(strings.noAssistantSelectedBody, context);
      return;
    }
    if (assistant.isDeleted) {
      this.deps.postError(strings.assistantArchivedReadonly, context);
      this.deps.postState(strings.assistantArchivedReadonly, context);
      return;
    }

    this.deps.ensureSession(assistant.id);
    const selectedSession = this.deps.repository.getSelectedSession(assistant.id);
    if (!selectedSession) {
      this.deps.postError(strings.sessionNotFound, context);
      return;
    }

    const normalizedWithPrefix = applyQuestionPrefix(normalized, assistant.questionPrefix);
    let messageImages: ChatMessageImage[] | undefined = images && images.length > 0 ? images : undefined;

    let fullContent = normalizedWithPrefix;
    if (files && files.length > 0) {
      const fileBlocks = files.map(f => {
        const lang = f.language || '';
        // 转义文件内容中的代码块结束标记，防止破坏 Markdown 结构
        const safeContent = f.content.replace(/```/g, '\\`\\`\\`');
        return '```' + lang + '\n// File: ' + f.name + '\n' + safeContent + '\n```';
      }).join('\n\n');
      fullContent = normalizedWithPrefix
        ? normalizedWithPrefix + '\n\n' + fileBlocks
        : fileBlocks;
    }

    const settings = this.deps.repository.getSettings();

    // Build failover chain: primary + valid fallbacks
    const failoverChain = resolveFailoverChain(settings, assistant);
    if (failoverChain.length === 0) {
      this.deps.postError(strings.providerUnavailable, context);
      this.deps.postState(strings.providerUnavailable, context);
      return;
    }

    // Use primary config for vision capability check and initial setup
    const primaryResolved = failoverChain[0];
    const modelId = primaryResolved.config.modelId || '';
    const caps = resolveCapabilities(modelId);
    const visionSupported = !!caps?.vision;

    // Detect if current model supports vision; if not and images are present,
    // perform OCR or downgrade to text prompt.
    if (messageImages && messageImages.length > 0 && !visionSupported) {
      // 从故障转移链中查找支持 vision 的模型用于 OCR，避免使用不支持视觉的端点
      const ocrConfig = failoverChain.find((entry) => {
        const mid = entry.config.modelId || '';
        return !!resolveCapabilities(mid)?.vision;
      })?.config ?? primaryResolved.config;
      const ocrResults: Array<{ index: number; text: string }> = [];
      for (let i = 0; i < messageImages.length; i++) {
        const img = messageImages[i];
        if (!img.base64) { continue; }
        try {
          const ocrText = await this.performOcr(img.base64, img.mimeType, ocrConfig, locale);
          if (ocrText) {
            ocrResults.push({ index: i, text: ocrText });
          }
        } catch {
          // OCR failed for this image, skip
        }
      }
      if (ocrResults.length > 0) {
        const ocrBlock = '\n\n<image_ocr>\n' +
          (locale === 'zh-CN' ? '图片文字识别结果：' : 'Image text recognition results:') +
          '\n\n' +
          ocrResults.map((r) => `[${locale === 'zh-CN' ? '图片' : 'Image'} ${r.index + 1}]\n${r.text}`).join('\n\n') +
          '\n</image_ocr>';
        fullContent = fullContent + ocrBlock;
      } else {
        this.deps.postMessage({
          type: 'toast',
          message: strings.imagePasteUnsupportedModel || '',
          tone: 'info'
        }, context);
        messageImages = undefined;
        if (!fullContent.trim()) {
          return;
        }
      }
    }

    const messageFiles = files && files.length > 0
      ? files.map(f => ({ name: f.name, content: f.content, language: f.language }))
      : undefined;

    const userMessage: ChatMessage = {
      id: createId('msg'),
      role: 'user',
      content: normalizedWithPrefix,
      timestamp: nowTs(),
      images: messageImages,
      files: messageFiles
    };
    const sessionAfterUser = this.deps.repository.appendMessage(assistant.id, selectedSession.id, userMessage);

    // When the current model does not support vision, strip images from ALL messages
    const messagesForProvider = !visionSupported
      ? sessionAfterUser.messages.map((msg) =>
          msg.images && msg.images.length > 0 ? { ...msg, images: undefined } : msg
        )
      : sessionAfterUser.messages;
    const providerMessages = toProviderMessages(
      resolveTemplateVariables(assistant.systemPrompt),
      assistant.questionPrefix,
      messagesForProvider,
      assistant.contextCount
    );

    const assistantMessage: ChatMessage = {
      id: createId('msg'),
      role: 'assistant',
      content: '',
      timestamp: nowTs(),
      model: primaryResolved.config.modelLabel,
      reasoning: ''
    };
    this.deps.repository.appendMessage(assistant.id, selectedSession.id, assistantMessage);

    this.deps.setIsGenerating(true);
    this.deps.setAbortController(new AbortController());
    this.deps.setAbortReason(undefined);
    this.deps.setStreamingEnabled(assistant.streaming);

    this.deps.postState(undefined, context);

    // Attempt providers in failover chain
    const attemptedProviders: string[] = [];

    for (let chainIndex = 0; chainIndex < failoverChain.length; chainIndex++) {
      const currentResolved = failoverChain[chainIndex];

      // Skip invalid provider configs and try next in chain
      const invalidReason = validateProviderConfig(currentResolved.config, locale, currentResolved.meta);
      if (invalidReason) {
        attemptedProviders.push(currentResolved.config.modelLabel + ' (invalid)');
        if (chainIndex === failoverChain.length - 1) {
          // Last provider also invalid - show error
          this.deps.repository.appendMessage(assistant.id, selectedSession.id, {
            id: createId('msg'),
            role: 'assistant',
            content: invalidReason,
            timestamp: nowTs(),
            model: currentResolved.config.modelLabel
          });
          this.deps.postError(invalidReason, context);
          this.deps.postState(invalidReason, context);
          this.deps.setIsGenerating(false);
          this.deps.setAbortController(undefined);
          this.deps.setAbortReason(undefined);
          return;
        }
        // Not the last - continue to next provider
        continue;
      }

      attemptedProviders.push(currentResolved.config.modelLabel);

      // Update model label on assistant message for current provider
      if (chainIndex > 0) {
        this.deps.repository.updateLastAssistantMessage(assistant.id, selectedSession.id, (current) => ({
          id: current?.id ?? assistantMessage.id,
          role: 'assistant',
          content: current?.content ?? '',
          timestamp: nowTs(),
          model: currentResolved.config.modelLabel,
          reasoning: current?.reasoning ?? ''
        }));
        // Notify user of failover attempt
        const failoverNotice = formatString(strings.providerFailoverAttempt || 'Failover to {provider}', {
          provider: currentResolved.config.modelLabel
        });
        this.deps.postMessage({
          type: 'toast',
          message: failoverNotice,
          tone: 'info'
        }, context);
      }

      // Create fresh accumulator for each provider attempt (clear previous partial content on failover)
      const acc = createStreamAccumulator();
      const streamParams: StreamFlushParams = {
        assistantId: assistant.id,
        sessionId: selectedSession.id,
        fallbackMessageId: assistantMessage.id,
        modelLabel: currentResolved.config.modelLabel,
        context
      };
      const flushStreamMessage = buildStreamFlush(acc, streamParams, this.deps.repository, strings, (persist) => {
        if (persist) {
          this.deps.flushScheduledStreamStatePost(context);
          return;
        }
        this.deps.scheduleStreamStatePost(context);
      });
      const streamCallbacks = buildStreamCallbacks(acc, flushStreamMessage);

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      try {
        const providerTools = await this.deps.toolOrchestrator.buildProviderTools(settings, assistant, currentResolved.config);
        const useToolCalling =
          providerTools.tools.length > 0 &&
          this.deps.toolOrchestrator.providerSupportsToolCalling(currentResolved.config.modelRef, currentResolved.config);
        const useStreaming = assistant.streaming && !useToolCalling;

        timeoutHandle = setTimeout(() => {
          this.deps.setAbortReason('timeout');
          this.deps.getAbortController()?.abort();
        }, currentResolved.config.timeoutMs);

        let responseTimeoutCleared = false;
        const wrappedCallbacks = useStreaming ? {
          onDelta: (delta: string) => {
            if (!responseTimeoutCleared) {
              clearTimeout(timeoutHandle);
              responseTimeoutCleared = true;
            }
            streamCallbacks.onDelta(delta);
          },
          onReasoningDelta: (delta: string) => {
            if (!responseTimeoutCleared) {
              clearTimeout(timeoutHandle);
              responseTimeoutCleared = true;
            }
            streamCallbacks.onReasoningDelta(delta);
          },
          onDone: streamCallbacks.onDone
        } : streamCallbacks;

        if (useStreaming) {
          await this.deps.providerClient.chatStream(
            providerMessages,
            currentResolved.config,
            wrappedCallbacks,
            locale,
            this.deps.getAbortController()?.signal
          );
        } else {
          const result = await this.deps.providerClient.chat(
            providerMessages,
            currentResolved.config,
            locale,
            this.deps.getAbortController()?.signal,
            useToolCalling
              ? { tools: providerTools.tools }
              : {}
          );
          if (useToolCalling) {
            // 工具调用阶段使用独立的更长超时，避免合法长时间 MCP 操作被中断
            clearTimeout(timeoutHandle);
            const TOOL_CALLING_TIMEOUT_MS = Math.max(currentResolved.config.timeoutMs, 300_000);
            timeoutHandle = setTimeout(() => {
              this.deps.setAbortReason('timeout');
              this.deps.getAbortController()?.abort();
            }, TOOL_CALLING_TIMEOUT_MS);
            const runState: PendingToolContinuation = {
              assistant,
              sessionId: selectedSession.id,
              assistantMessageId: assistantMessage.id,
              settings,
              locale,
              providerMessages,
              providerTools,
              providerConfig: currentResolved.config,
              toolRounds: [],
              result
            };
            await this.deps.toolOrchestrator.runToolCallingBatch(runState, context);
            clearTimeout(timeoutHandle);
            this.deps.setIsGenerating(false);
            this.deps.setAbortController(undefined);
            this.deps.setAbortReason(undefined);
            this.deps.postState(undefined, context);
            const currentSession = this.deps.repository.getSessionById(selectedSession.id);
            if (currentSession && currentSession.titleSource === 'default') {
              this.triggerTitleGeneration(assistant.id, currentSession.id).catch((error) => {
                warn('Background title generation failed:', error);
              });
            }
            return;
          }
          this.deps.toolOrchestrator.applyProviderResultToAssistantMessage(
            assistant.id,
            selectedSession.id,
            assistantMessage.id,
            result,
            currentResolved.config.modelLabel,
            { fallbackContent: strings.emptyResponse }
          );
        }
        // Success - clean up and return
        clearTimeout(timeoutHandle);
        this.deps.setIsGenerating(false);
        this.deps.setAbortController(undefined);
        this.deps.setAbortReason(undefined);
        this.deps.postState(undefined, context);
        const currentSession = this.deps.repository.getSessionById(selectedSession.id);
        if (currentSession && currentSession.titleSource === 'default') {
          this.triggerTitleGeneration(assistant.id, currentSession.id).catch((error) => {
            warn('Background title generation failed:', error);
          });
        }
        return;
      } catch (error) {
        clearTimeout(timeoutHandle);
        clearStreamFlush(acc);

        // Check abort reason - user manual abort should not failover
        const abortReason = this.deps.getAbortReason();
        if (abortReason === 'manual') {
          const fallback = resolveGenerationErrorMessage(error, abortReason, strings);
          const partial = buildStreamErrorContent(acc, fallback);
          this.deps.repository.updateLastAssistantMessage(assistant.id, selectedSession.id, (current) => ({
            id: current?.id ?? assistantMessage.id,
            role: 'assistant',
            content: partial.content,
            timestamp: nowTs(),
            model: currentResolved.config.modelLabel,
            reasoning: partial.reasoning
          }));
          this.deps.postError(fallback, context);
          this.deps.postState(fallback, context);
          this.deps.setIsGenerating(false);
          this.deps.setAbortController(undefined);
          this.deps.setAbortReason(undefined);
          return;
        }

        // Auth errors should not failover
        if (isAuthError(error)) {
          const fallback = resolveGenerationErrorMessage(error, abortReason, strings);
          const partial = buildStreamErrorContent(acc, fallback);
          this.deps.repository.updateLastAssistantMessage(assistant.id, selectedSession.id, (current) => ({
            id: current?.id ?? assistantMessage.id,
            role: 'assistant',
            content: partial.content,
            timestamp: nowTs(),
            model: currentResolved.config.modelLabel,
            reasoning: partial.reasoning
          }));
          this.deps.postError(fallback, context);
          this.deps.postState(fallback, context);
          this.deps.setIsGenerating(false);
          this.deps.setAbortController(undefined);
          this.deps.setAbortReason(undefined);
          return;
        }

        // If not retryable or this is the last provider, show error
        // Timeout abort should trigger failover (abort reason is 'timeout' but error message is "aborted")
        if ((!isRetryableError(error) && abortReason !== 'timeout') || chainIndex === failoverChain.length - 1) {
          const fallback = resolveGenerationErrorMessage(error, abortReason, strings);
          // Build comprehensive error message if all providers failed
          const finalError = chainIndex === failoverChain.length - 1 && failoverChain.length > 1
            ? formatString(strings.allProvidersFailed || 'All providers failed. Tried: {providers}. Last error: {error}', {
                providers: attemptedProviders.join(', '),
                error: fallback
              })
            : fallback;
          const partial = buildStreamErrorContent(acc, finalError);
          this.deps.repository.updateLastAssistantMessage(assistant.id, selectedSession.id, (current) => ({
            id: current?.id ?? assistantMessage.id,
            role: 'assistant',
            content: partial.content,
            timestamp: nowTs(),
            model: currentResolved.config.modelLabel,
            reasoning: partial.reasoning
          }));
          this.deps.postError(finalError, context);
          this.deps.postState(finalError, context);
          this.deps.setIsGenerating(false);
          this.deps.setAbortController(undefined);
          this.deps.setAbortReason(undefined);
          return;
        }

        // Retryable error - reset abort controller for next attempt
        this.deps.setAbortController(new AbortController());
        this.deps.setAbortReason(undefined);
        // Continue to next provider in chain
      }
    }

    // Safety net: all providers were invalid/skipped, ensure cleanup
    if (this.deps.isGenerating()) {
      this.deps.setIsGenerating(false);
      this.deps.setAbortController(undefined);
      this.deps.setAbortReason(undefined);
      this.deps.postState(undefined, context);
    }
  }

  public async regenerateReply(context?: ToolOrchestratorPanelContext): Promise<void> {
    const locale = this.deps.getLocale();
    const strings = getStrings(locale);
    if (this.deps.isGenerating()) {
      this.deps.postError(strings.generationBusy, context);
      return;
    }
    const assistant = this.deps.repository.getSelectedAssistant();
    if (!assistant || assistant.isDeleted) {
      return;
    }
    const session = this.deps.repository.getSelectedSession(assistant.id);
    if (!session) {
      this.deps.postError(strings.sessionNotFound, context);
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
      this.deps.postError(strings.sessionNotFound, context);
      return;
    }

    const removedCount = Math.max(0, session.messages.length - userIndex - 1);
    const confirmed = await this.deps.confirmDangerousAction(
      formatString(strings.confirmRegenerateReply, { count: String(removedCount) }),
      strings.regenerateReplyAction
    );
    if (!confirmed) {
      return;
    }

    const userMsg = session.messages[userIndex];
    const userContent = userMsg.content;
    const userImages = userMsg.images && userMsg.images.length > 0 ? userMsg.images : undefined;
    const userFiles = userMsg.files && userMsg.files.length > 0 ? userMsg.files : undefined;
    this.deps.repository.truncateSessionMessages(assistant.id, session.id, userIndex);
    await this.sendMessage(userContent, userImages, userFiles, context);
  }

  public async regenerateFromMessage(
    messageId: string,
    context?: ToolOrchestratorPanelContext
  ): Promise<void> {
    const locale = this.deps.getLocale();
    const strings = getStrings(locale);
    if (this.deps.isGenerating()) {
      this.deps.postError(strings.generationBusy, context);
      return;
    }
    const assistant = this.deps.repository.getSelectedAssistant();
    if (!assistant || assistant.isDeleted) {
      return;
    }
    const session = this.deps.repository.getSelectedSession(assistant.id);
    if (!session) {
      this.deps.postError(strings.sessionNotFound, context);
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
      this.deps.postError(strings.sessionNotFound, context);
      return;
    }

    const removedCount = Math.max(0, session.messages.length - userIndex - 1);
    const confirmed = await this.deps.confirmDangerousAction(
      formatString(strings.confirmRegenerateFromMessage, { count: String(removedCount) }),
      strings.regenerateFromMessageAction
    );
    if (!confirmed) {
      return;
    }

    const userMsg = session.messages[userIndex];
    const userContent = userMsg.content;
    const userImages = userMsg.images && userMsg.images.length > 0 ? userMsg.images : undefined;
    const userFiles = userMsg.files && userMsg.files.length > 0 ? userMsg.files : undefined;
    this.deps.repository.truncateSessionMessages(assistant.id, session.id, userIndex);
    await this.sendMessage(userContent, userImages, userFiles, context);
  }

  /**
   * Perform OCR on an image using the current provider.
   * Returns the extracted text, or undefined if OCR fails.
   */
  private async performOcr(
    base64: string,
    mimeType: string,
    providerConfig: ProviderConfig,
    locale: RuntimeLocale
  ): Promise<string | undefined> {
    const systemPrompt = locale === 'zh-CN'
      ? '请描述图片中的文字内容，准确提取并转录所有可见文字。'
      : 'Please describe the text content in the image. Extract and transcribe all visible text accurately.';
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Please extract all text from this image.' },
          { type: 'image_url' as const, image_url: { url: `data:${mimeType};base64,${base64}` } }
        ]
      }
    ];
    const result = await this.deps.providerClient.chat(
      messages,
      providerConfig,
      locale,
      this.deps.getAbortController()?.signal
    );
    return result.text?.trim() || undefined;
  }

  public async copyMessage(messageId: string): Promise<void> {
    const strings = getStrings(this.deps.getLocale());
    const assistant = this.deps.repository.getSelectedAssistant();
    if (!assistant) {
      return;
    }
    const session = this.deps.repository.getSelectedSession(assistant.id);
    if (!session) {
      return;
    }
    const message = session.messages.find((item) => item.id === messageId);
    if (!message) {
      return;
    }
    try {
      await vscode.env.clipboard.writeText(message.content);
      this.deps.postMessage({
        type: 'toast',
        message: strings.copyMessageSuccess,
        tone: 'success'
      });
    } catch {
      this.deps.postError(strings.unknownError);
    }
  }

  public async deleteMessage(messageId: string): Promise<void> {
    const strings = getStrings(this.deps.getLocale());
    const assistant = this.deps.repository.getSelectedAssistant();
    if (!assistant) {
      return;
    }
    const session = this.deps.repository.getSelectedSession(assistant.id);
    if (!session) {
      return;
    }
    const message = session.messages.find((item) => item.id === messageId);
    if (!message) {
      return;
    }
    const confirmed = await this.deps.confirmDangerousAction(strings.confirmDeleteMessage, strings.deleteAction);
    if (!confirmed) {
      return;
    }
    this.deps.repository.deleteMessage(assistant.id, session.id, messageId);
    this.deps.postState();
  }

  public async editMessage(messageId: string, newContent: string, regenerate?: boolean): Promise<void> {
    const assistant = this.deps.repository.getSelectedAssistant();
    if (!assistant) {
      return;
    }
    const session = this.deps.repository.getSelectedSession(assistant.id);
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
    if (regenerate && message.role === 'user') {
      const originalImages = message.images && message.images.length > 0 ? message.images : undefined;
      this.deps.repository.editMessageAndTruncateAfter(assistant.id, session.id, messageId, trimmedContent);
      this.deps.postState();
      await this.sendMessage(trimmedContent, originalImages);
      return;
    }
    this.deps.repository.editMessage(assistant.id, session.id, messageId, trimmedContent);
    this.deps.postState();
  }

  public async clearSession(): Promise<void> {
    const strings = getStrings(this.deps.getLocale());
    const assistant = this.deps.repository.getSelectedAssistant();
    if (!assistant) {
      return;
    }
    const session = this.deps.repository.getSelectedSession(assistant.id);
    if (!session) {
      return;
    }
    if (!session.messages.length) {
      return;
    }
    const confirmed = await this.deps.confirmDangerousAction(strings.confirmClearSession, strings.clearAction);
    if (!confirmed) {
      return;
    }
    this.deps.repository.clearSessionMessages(assistant.id, session.id);
    const greeting = assistant.greeting?.trim();
    if (greeting) {
      this.deps.repository.appendMessage(assistant.id, session.id, {
        id: createId('msg'),
        role: 'assistant',
        content: greeting,
        timestamp: nowTs()
      });
    }
    this.deps.postState();
  }

  private async triggerTitleGeneration(assistantId: string, sessionId: string): Promise<void> {
    const settings = this.deps.repository.getSettings();
    const titleBinding = settings.defaultModels.titleSummary;
    if (!titleBinding) {
      return;
    }
    const session = this.deps.repository.getSessionById(sessionId);
    if (!session || session.assistantId !== assistantId || session.titleSource !== 'default') {
      return;
    }

    const { config, meta } = resolveModelBindingConfig(settings, titleBinding, {
      maxTokens: TITLE_GENERATION.MAX_TOKENS,
      temperature: TITLE_GENERATION.TEMPERATURE,
      contextCount: TITLE_GENERATION.CONTEXT_COUNT,
      timeoutMs: TITLE_GENERATION.TIMEOUT_MS
    });
    if (!meta.providerExists || !meta.providerEnabled || !meta.modelExists) {
      return;
    }

    const locale = this.deps.getLocale();
    const prompt = settings.defaultModels.titleSummaryPrompt?.trim() || DEFAULT_TITLE_SUMMARY_PROMPT;

    try {
      const contextMessages = session.messages
        .slice(-TITLE_GENERATION.RECENT_MESSAGES)
        .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }));

      const result = await this.deps.providerClient.chat(
        [{ role: 'system', content: prompt }, ...contextMessages],
        config,
        locale,
        AbortSignal.timeout(TITLE_GENERATION.ABORT_TIMEOUT_MS)
      );

      const title = result.text?.trim();
      if (title) {
        this.deps.repository.generateSessionTitle(assistantId, sessionId, title);
      }
    } catch (error) {
      warn('Title generation failed:', error);
    }
  }
}
