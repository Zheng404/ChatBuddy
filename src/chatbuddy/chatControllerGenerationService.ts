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
import { OpenAICompatibleClient, resolveModelBindingConfig, validateProviderConfig } from './providerClient';
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
        return '```' + lang + '\n// File: ' + f.name + '\n' + f.content + '\n```';
      }).join('\n\n');
      fullContent = normalizedWithPrefix
        ? normalizedWithPrefix + '\n\n' + fileBlocks
        : fileBlocks;
    }

    const settings = this.deps.repository.getSettings();
    const resolved = this.deps.resolveEffectiveProviderConfig(settings, assistant, selectedSession.id);
    const modelId = resolved.config.modelId || '';
    const caps = resolveCapabilities(modelId);
    const visionSupported = !!caps?.vision;

    // Detect if current model supports vision; if not and images are present,
    // perform OCR or downgrade to text prompt.
    if (messageImages && messageImages.length > 0 && !visionSupported) {
      // Model does not support vision → attempt OCR using the same provider.
      // Note: OCR requires the provider to accept image_url input. If the
      // provider itself rejects vision content, OCR will fail gracefully.
      const ocrResults: Array<{ index: number; text: string }> = [];
      for (let i = 0; i < messageImages.length; i++) {
        const img = messageImages[i];
        if (!img.base64) { continue; }
        try {
          const ocrText = await this.performOcr(img.base64, img.mimeType, resolved.config, locale);
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
        // OCR completely failed → remove images and show warning
        this.deps.postMessage({
          type: 'toast',
          message: strings.imagePasteUnsupportedModel || '',
          tone: 'info'
        }, context);
        messageImages = undefined;
        // If no text content either, abort sending to avoid an empty user message
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

    const invalidReason = validateProviderConfig(resolved.config, locale, resolved.meta);
    if (invalidReason) {
      this.deps.repository.appendMessage(assistant.id, selectedSession.id, {
        id: createId('msg'),
        role: 'assistant',
        content: invalidReason,
        timestamp: nowTs(),
        model: resolved.config.modelLabel
      });
      this.deps.postError(invalidReason, context);
      this.deps.postState(invalidReason, context);
      return;
    }

    // When the current model does not support vision, strip images from ALL messages
    // sent to the provider to avoid API errors. Images remain in local state for display.
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
    const providerTools = await this.deps.toolOrchestrator.buildProviderTools(settings, assistant, resolved.config);
    const useToolCalling =
      providerTools.tools.length > 0 &&
      this.deps.toolOrchestrator.providerSupportsToolCalling(resolved.config.modelRef, resolved.config);
    const useStreaming = assistant.streaming && !useToolCalling;

    const assistantMessage: ChatMessage = {
      id: createId('msg'),
      role: 'assistant',
      content: '',
      timestamp: nowTs(),
      model: resolved.config.modelLabel,
      reasoning: ''
    };
    this.deps.repository.appendMessage(assistant.id, selectedSession.id, assistantMessage);

    this.deps.setIsGenerating(true);
    this.deps.setAbortController(new AbortController());
    this.deps.setAbortReason(undefined);
    this.deps.setStreamingEnabled(assistant.streaming);

    const timeoutHandle = setTimeout(() => {
      this.deps.setAbortReason('timeout');
      this.deps.getAbortController()?.abort();
    }, resolved.config.timeoutMs);

    this.deps.postState(undefined, context);

    const acc = createStreamAccumulator();
    const streamParams: StreamFlushParams = {
      assistantId: assistant.id,
      sessionId: selectedSession.id,
      fallbackMessageId: assistantMessage.id,
      modelLabel: resolved.config.modelLabel,
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

    // 全局超时仅在「无响应」阶段生效：首个流式 token 到达后即清除，
    // 后续由 consumeSseResponse 的 readWithTimeout 检测连接中断。
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

    try {
      if (useStreaming) {
        await this.deps.providerClient.chatStream(
          providerMessages,
          resolved.config,
          wrappedCallbacks,
          locale,
          this.deps.getAbortController()?.signal
        );
      } else {
        const result = await this.deps.providerClient.chat(
          providerMessages,
          resolved.config,
          locale,
          this.deps.getAbortController()?.signal,
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
          await this.deps.toolOrchestrator.runToolCallingBatch(runState, context);
          return;
        }
        this.deps.toolOrchestrator.applyProviderResultToAssistantMessage(
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
      clearStreamFlush(acc);
      const fallback = resolveGenerationErrorMessage(error, this.deps.getAbortReason(), strings);
      const partial = buildStreamErrorContent(acc, fallback);
      this.deps.repository.updateLastAssistantMessage(assistant.id, selectedSession.id, (current) => ({
        id: current?.id ?? assistantMessage.id,
        role: 'assistant',
        content: partial.content,
        timestamp: nowTs(),
        model: resolved.config.modelLabel,
        reasoning: partial.reasoning
      }));

      this.deps.postError(fallback, context);
      this.deps.postState(fallback, context);
    } finally {
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

    const removedCount = Math.max(0, session.messages.length - userIndex);
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

    const removedCount = Math.max(0, session.messages.length - userIndex);
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
    const result = await this.deps.providerClient.chat(messages, providerConfig, locale);
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
