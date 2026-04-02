import * as vscode from 'vscode';

import { getCodiconRootUri } from './codicon';
import { parseModelRef } from './modelCatalog';
import { formatString, getAssistantLocalization, getDefaultSessionTitle, getStrings, resolveLocale } from './i18n';
import {
  OpenAICompatibleClient,
  resolveModelBindingConfig,
  resolveProviderConfig,
  validateProviderConfig
} from './providerClient';
import { getPanelIconPath } from './panelIcon';
import { ChatStateRepository } from './stateRepository';
import { getChatWebviewHtml } from './webview';
import { createId, nowTs } from './utils';
import {
  AssistantProfile,
  ChatBuddySettings,
  ChatMessage,
  ChatStatePayload,
  ProviderMessage,
  RuntimeLocale,
  WebviewInboundMessage,
  WebviewOutboundMessage
} from './types';

const CHAT_PANEL_VIEW_TYPE = 'chatbuddy.mainChat';
const STREAM_FLUSH_INTERVAL_MS = 50;

type PanelMessageContext = {
  panel: vscode.WebviewPanel;
  assistantId?: string;
};

function applyQuestionPrefix(content: string, questionPrefix: string): string {
  const prefix = questionPrefix.trim();
  if (!prefix) {
    return content;
  }
  if (content.startsWith(prefix)) {
    return content;
  }
  const separator = /[:：]$/.test(prefix) ? '' : ' ';
  return `${prefix}${separator}${content}`;
}

function toProviderConversationMessages(questionPrefix: string, messages: ChatMessage[]): ProviderMessage[] {
  const result: ProviderMessage[] = [];
  for (const message of messages) {
    if (message.content.trim().length === 0 || message.role === 'system') {
      continue;
    }
    if (message.role === 'user') {
      result.push({
        role: 'user',
        content: applyQuestionPrefix(message.content, questionPrefix)
      });
      continue;
    }
    result.push({
      role: 'assistant',
      content: message.content
    });
  }
  return result;
}

function toProviderMessages(
  systemPrompt: string,
  questionPrefix: string,
  messages: ChatMessage[],
  contextCount: number
): ProviderMessage[] {
  const normalizedSystemPrompt = systemPrompt.trim();
  const conversationMessages = toProviderConversationMessages(questionPrefix, messages);
  const normalizedContextCount = Number.isFinite(contextCount) && contextCount > 0 ? Math.floor(contextCount) : 0;
  const limitedMessages =
    normalizedContextCount === 0
      ? conversationMessages
      : conversationMessages.slice(-normalizedContextCount);

  return [
    ...(normalizedSystemPrompt
      ? [
          {
            role: 'system' as const,
            content: normalizedSystemPrompt
          }
        ]
      : []),
    ...limitedMessages
  ];
}

function splitThinkTaggedContent(rawText: string): { content: string; reasoning: string } {
  if (!rawText || !/[<]/.test(rawText)) {
    return {
      content: rawText,
      reasoning: ''
    };
  }

  // Only treat as reasoning when the message starts with a think block.
  if (!/^\s*<think\b[^>]*>/i.test(rawText)) {
    return {
      content: rawText,
      reasoning: ''
    };
  }

  const tagPattern = /<think\b[^>]*>|<\/think>/gi;
  let thinkDepth = 0;
  let cursor = 0;
  let matchedThinkOpenTag = false;
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];

  for (const match of rawText.matchAll(tagPattern)) {
    const index = match.index ?? 0;
    const segment = rawText.slice(cursor, index);
    if (segment) {
      if (thinkDepth > 0) {
        reasoningParts.push(segment);
      } else {
        contentParts.push(segment);
      }
    }

    const tag = match[0].toLowerCase();
    if (tag.startsWith('</think')) {
      if (thinkDepth === 0) {
        return {
          content: rawText,
          reasoning: ''
        };
      }
      thinkDepth -= 1;
    } else {
      matchedThinkOpenTag = true;
      thinkDepth += 1;
    }
    cursor = index + match[0].length;
  }

  if (!matchedThinkOpenTag || thinkDepth !== 0) {
    return {
      content: rawText,
      reasoning: ''
    };
  }

  const tail = rawText.slice(cursor);
  if (tail) {
    if (thinkDepth > 0) {
      reasoningParts.push(tail);
    } else {
      contentParts.push(tail);
    }
  }

  return {
    content: contentParts.join(''),
    reasoning: reasoningParts.join('')
  };
}

function mergeReasoningParts(...parts: Array<string | undefined>): string | undefined {
  const merged = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .trim();
  return merged || undefined;
}

export class ChatController {
  private panel: vscode.WebviewPanel | undefined;
  private panelsByAssistantId = new Map<string, vscode.WebviewPanel>();
  private streamingEnabled: boolean;
  private isGenerating = false;
  private abortController: AbortController | undefined;
  private abortReason: 'manual' | 'timeout' | undefined;
  private sessionTempModelRefBySession: Record<string, string> = {};
  private lastSelectedSessionIdByAssistant: Record<string, string | undefined> = {};

  constructor(
    private readonly repository: ChatStateRepository,
    private readonly providerClient: OpenAICompatibleClient
  ) {
    const assistant = this.repository.getSelectedAssistant();
    this.streamingEnabled = assistant?.streaming ?? this.repository.getSettings().streamingDefault;
  }

  private getLocale(): RuntimeLocale {
    return resolveLocale(this.repository.getSettings().locale, vscode.env.language);
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
      } else {
        const newPanel = vscode.window.createWebviewPanel(CHAT_PANEL_VIEW_TYPE, panelTitle, vscode.ViewColumn.One, {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [getCodiconRootUri()]
        });
        newPanel.iconPath = panelIcon;
        newPanel.webview.html = getChatWebviewHtml(newPanel.webview);
        const assistantIdRef = assistant.id;
        newPanel.onDidDispose(() => {
          this.stopGeneration('manual');
          this.panelsByAssistantId.delete(assistantIdRef);
          if (this.panel === newPanel) {
            this.panel = undefined;
          }
        });
        newPanel.webview.onDidReceiveMessage((message: WebviewInboundMessage) => {
          this.panel = newPanel;
          void this.handleWebviewMessage(message, {
            panel: newPanel,
            assistantId: assistantIdRef
          });
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
        this.panel.onDidDispose(() => {
          this.stopGeneration('manual');
          this.panel = undefined;
        });
        const panelRef = this.panel;
        this.panel.webview.onDidReceiveMessage((message: WebviewInboundMessage) => {
          void this.handleWebviewMessage(message, {
            panel: panelRef
          });
        });
      } else {
        this.panel.title = panelTitle;
        this.panel.iconPath = panelIcon;
        this.panel.reveal(vscode.ViewColumn.One);
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
      if (assistant.streaming) {
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
          this.abortController.signal
        );
        const thinkSplit = splitThinkTaggedContent(result.text);
        const contentValue = thinkSplit.content.trim() || strings.emptyResponse;
        const reasoningValue = mergeReasoningParts(result.reasoning, thinkSplit.reasoning);
        this.repository.updateLastAssistantMessage(assistant.id, selectedSession.id, (current) => ({
          id: current?.id ?? assistantMessage.id,
          role: 'assistant',
          content: contentValue,
          timestamp: nowTs(),
          model: resolved.config.modelLabel,
          reasoning: reasoningValue
        }));
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
    }
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
