/**
 * 聊天 WebView 消息路由器。
 *
 * 将 WebView 发来的 `WebviewInboundMessage` 分发给 `ChatController`
 * 的对应处理函数，是所有用户交互操作的入口分发层。
 */
import * as vscode from 'vscode';

import { formatString, getStrings } from './i18n';
import { AssistantProfile, AssistantTemplate, ChatSessionSummary, RuntimeLocale, SessionTempParams, WebviewInboundMessage } from './types';

export type ChatControllerPanelMessageContext = {
  panel: vscode.WebviewPanel;
  assistantId?: string;
};

type RouterRepository = {
  getSelectedAssistant: () => AssistantProfile | undefined;
  getSelectedSession: (assistantId: string) => { id: string } | undefined;
  getSessionsForAssistant: (assistantId: string) => ChatSessionSummary[];
  selectSession: (assistantId: string, sessionId: string) => void;
  renameSession: (assistantId: string, sessionId: string, title: string) => void;
  deleteSession: (assistantId: string, sessionId: string) => void;
  getState: () => { sessionPanelCollapsed: boolean };
  getStateShallow: () => { sessionPanelCollapsed: boolean };
  setSessionPanelCollapsed: (collapsed: boolean) => void;
  resolveModelOption: (modelRef: string) => { ref: string } | undefined;
  setAssistantStreaming: (assistantId: string, enabled: boolean) => void;
  saveAsTemplate: (assistantId: string, name: string, description?: string) => AssistantTemplate | undefined;
  createAssistantFromTemplate: (templateId: string) => AssistantProfile | undefined;
  deleteTemplate: (templateId: string) => boolean;
  renameTemplate: (templateId: string, name: string) => boolean;
};

export type ChatControllerWebviewRouterArgs = {
  message: WebviewInboundMessage;
  context?: ChatControllerPanelMessageContext;
  repository: RouterRepository;
  getLocale: () => RuntimeLocale;
  hasPendingToolContinuation: boolean;
  /**
   * 实时读取生成状态的 getter。路由过程中（跨 await 后）生成状态可能变化，
   * 通过 getter 读取保证关键分支看到最新值，避免基于过期快照放行写操作。
   */
  isGenerating: () => boolean;
  handleReady: (context?: ChatControllerPanelMessageContext) => void;
  postError: (message: string, context?: ChatControllerPanelMessageContext) => void;
  postState: (error?: string, context?: ChatControllerPanelMessageContext) => void;
  createSessionForAssistant: (assistantId: string) => string | undefined;
  ensureSession: (assistantId: string) => void;
  sessionTempModelRefBySession: Record<string, string>;
  sessionTempParamsBySession: Record<string, SessionTempParams>;
  setStreamingEnabled: (enabled: boolean) => void;
  regenerateReply: (context?: ChatControllerPanelMessageContext, confirmed?: boolean) => Promise<void>;
  regenerateFromMessage: (messageId: string, context?: ChatControllerPanelMessageContext, confirmed?: boolean) => Promise<void>;
  copyMessage: (messageId: string) => Promise<void>;
  deleteMessage: (messageId: string, confirmed?: boolean) => Promise<void>;
  editMessage: (messageId: string, newContent: string, regenerate?: boolean) => Promise<void>;
  clearSession: (confirmed?: boolean) => Promise<void>;
  sendMessage: (content: string, images: Array<{ base64: string; mimeType: string }> | undefined, files: Array<{ name: string; content: string; language?: string }> | undefined, context?: ChatControllerPanelMessageContext) => Promise<void>;
  selectFiles: (context?: ChatControllerPanelMessageContext) => Promise<void>;
  selectImages: (context?: ChatControllerPanelMessageContext) => Promise<void>;
  continuePendingToolCalls: (context?: ChatControllerPanelMessageContext) => Promise<void>;
  cancelPendingToolCalls: (context?: ChatControllerPanelMessageContext) => void;
  listMcpResources: (context?: ChatControllerPanelMessageContext) => Promise<void>;
  listMcpPrompts: (context?: ChatControllerPanelMessageContext) => Promise<void>;
  insertMcpResource: (serverId: string, uri: string, context?: ChatControllerPanelMessageContext) => Promise<void>;
  insertMcpPrompt: (
    serverId: string,
    name: string,
    args: Record<string, string>,
    context?: ChatControllerPanelMessageContext
  ) => Promise<void>;
  stopGeneration: (reason?: 'manual' | 'timeout') => void;
  confirmDangerousAction: (message: string, actionLabel: string) => Promise<boolean>;
};

export async function routeChatControllerWebviewMessage(args: ChatControllerWebviewRouterArgs): Promise<void> {
  const {
    message,
    context,
    repository,
    getLocale,
    hasPendingToolContinuation,
    isGenerating,
    handleReady,
    postError,
    postState,
    createSessionForAssistant,
    sessionTempParamsBySession,
    setStreamingEnabled,
    regenerateReply,
    regenerateFromMessage,
    copyMessage,
    deleteMessage,
    editMessage,
    clearSession,
    sendMessage,
    selectFiles,
    selectImages,
    continuePendingToolCalls,
    cancelPendingToolCalls,
    listMcpResources,
    listMcpPrompts,
    insertMcpResource,
    insertMcpPrompt,
    stopGeneration
  } = args;

  if (
    hasPendingToolContinuation &&
    message.type !== 'ready' &&
    message.type !== 'continueToolCalls' &&
    message.type !== 'cancelToolCalls'
  ) {
    const strings = getStrings(getLocale());
    const notice = strings.toolContinuationReadonly || strings.generationBusy;
    postError(notice, context);
    postState(notice, context);
    return;
  }

  // Block state-changing messages during generation to prevent data corruption.
  // 实时从 getter 读取，避免路由过程中状态切换导致基于过期快照放行写操作。
  if (isGenerating()) {
    const allowedDuringGeneration = new Set<string>([
      'stopGeneration',
      'toggleSessionPanel',
      'ready'
    ]);
    if (!allowedDuringGeneration.has(message.type)) {
      return;
    }
  }

  switch (message.type) {
    case 'ready':
      handleReady(context);
      return;
    case 'createSession': {
      const assistant = repository.getSelectedAssistant();
      if (!assistant || assistant.isDeleted) {
        return;
      }
      createSessionForAssistant(assistant.id);
      postState();
      return;
    }
    case 'selectSession': {
      await handleSelectSession(message, args);
      return;
    }
    case 'renameSession': {
      const assistant = repository.getSelectedAssistant();
      if (!assistant) {
        return;
      }
      repository.renameSession(assistant.id, message.sessionId, message.title);
      postState();
      return;
    }
    case 'deleteSession': {
      await handleDeleteSession(message, args);
      return;
    }
    case 'setSessionTempModel': {
      await handleSetSessionTempModel(message, args);
      return;
    }
    case 'setSessionTempParams': {
      const assistant = repository.getSelectedAssistant();
      if (!assistant || assistant.isDeleted) {
        return;
      }
      const session = repository.getSelectedSession(assistant.id);
      if (!session) {
        return;
      }
      sessionTempParamsBySession[session.id] = message.params;
      postState();
      return;
    }
    case 'clearSessionTempParams': {
      const assistant = repository.getSelectedAssistant();
      if (!assistant || assistant.isDeleted) {
        return;
      }
      const session = repository.getSelectedSession(assistant.id);
      if (!session) {
        return;
      }
      delete sessionTempParamsBySession[session.id];
      postState();
      return;
    }
    case 'toggleSessionPanel': {
      const state = repository.getStateShallow();
      repository.setSessionPanelCollapsed(!state.sessionPanelCollapsed);
      postState();
      return;
    }
    case 'setStreaming': {
      const assistant = repository.getSelectedAssistant();
      if (!assistant || assistant.isDeleted) {
        return;
      }
      setStreamingEnabled(message.enabled);
      repository.setAssistantStreaming(assistant.id, message.enabled);
      postState();
      return;
    }
    case 'regenerateReply':
      await regenerateReply(context, message.confirmed);
      return;
    case 'regenerateFromMessage':
      await regenerateFromMessage(message.messageId, context, message.confirmed);
      return;
    case 'copyMessage':
      await copyMessage(message.messageId);
      return;
    case 'deleteMessage':
      await deleteMessage(message.messageId, message.confirmed);
      return;
    case 'editMessage':
      await editMessage(message.messageId, message.newContent, message.regenerate);
      return;
    case 'clearSession':
      await clearSession(message.confirmed);
      return;
    case 'sendMessage':
      await sendMessage(message.content, message.images, message.files, context);
      return;
    case 'continueToolCalls':
      await continuePendingToolCalls(context);
      return;
    case 'cancelToolCalls':
      cancelPendingToolCalls(context);
      return;
    case 'listMcpResources':
      await listMcpResources(context);
      return;
    case 'listMcpPrompts':
      await listMcpPrompts(context);
      return;
    case 'readMcpResource':
      await insertMcpResource(message.serverId, message.uri, context);
      return;
    case 'getMcpPrompt':
      await insertMcpPrompt(message.serverId, message.name, message.args, context);
      return;
    case 'selectFiles':
      await selectFiles(context);
      return;
    case 'selectImages':
      await selectImages(context);
      return;
    case 'stopGeneration':
      stopGeneration('manual');
      return;
    case 'saveAsTemplate': {
      repository.saveAsTemplate(message.assistantId, message.name, message.description);
      postState(undefined, context);
      return;
    }
    case 'createAssistantFromTemplate': {
      const newAssistant = repository.createAssistantFromTemplate(message.templateId);
      if (newAssistant) {
        postState(undefined, context);
      }
      return;
    }
    case 'deleteTemplate': {
      repository.deleteTemplate(message.templateId);
      postState(undefined, context);
      return;
    }
    case 'renameTemplate': {
      repository.renameTemplate(message.templateId, message.name);
      postState(undefined, context);
      return;
    }
    default: {
      // 穷尽检查：若 WebviewInboundMessage 新增消息类型而此处未处理，
      // TypeScript 会因 `_exhaustive: never` 编译失败，强制开发者补全分支。
      const _exhaustive: never = message;
      void _exhaustive;
      return;
    }
  }
}

// ─── 提取的复杂 case 处理函数（降低主路由 complexity） ────────────────

async function handleSelectSession(
  message: Extract<WebviewInboundMessage, { type: 'selectSession' }>,
  args: ChatControllerWebviewRouterArgs
): Promise<void> {
  const { repository, postState, sessionTempModelRefBySession, sessionTempParamsBySession } = args;
  const assistant = repository.getSelectedAssistant();
  if (!assistant) {
    return;
  }
  const previousSessionId = repository.getSelectedSession(assistant.id)?.id;
  repository.selectSession(assistant.id, message.sessionId);
  if (previousSessionId && previousSessionId !== message.sessionId) {
    delete sessionTempModelRefBySession[previousSessionId];
    delete sessionTempParamsBySession[previousSessionId];
  }
  postState();
}

async function handleDeleteSession(
  message: Extract<WebviewInboundMessage, { type: 'deleteSession' }>,
  args: ChatControllerWebviewRouterArgs
): Promise<void> {
  const { repository, postState, sessionTempModelRefBySession, sessionTempParamsBySession, ensureSession, confirmDangerousAction, getLocale } = args;
  const assistant = repository.getSelectedAssistant();
  if (!assistant) {
    return;
  }
  const session = repository.getSessionsForAssistant(assistant.id).find((item) => item.id === message.sessionId);
  if (!session) {
    return;
  }
  // 前端 webview 已确认时跳过 Host 端 VS Code 原生对话框（A 类：webview 内触发）
  // 保留兜底：confirmed 未传时仍走 Host 端确认（防御性）
  if (!message.confirmed) {
    const strings = getStrings(getLocale());
    const sessionTitle = session.title?.trim() || strings.untitledSession;
    const confirmed = await confirmDangerousAction(
      formatString(strings.confirmDeleteSession, { title: sessionTitle }),
      strings.deleteAction
    );
    if (!confirmed) {
      return;
    }
  }
  repository.deleteSession(assistant.id, message.sessionId);
  delete sessionTempModelRefBySession[message.sessionId];
  delete sessionTempParamsBySession[message.sessionId];
  ensureSession(assistant.id);
  postState();
}

async function handleSetSessionTempModel(
  message: Extract<WebviewInboundMessage, { type: 'setSessionTempModel' }>,
  args: ChatControllerWebviewRouterArgs
): Promise<void> {
  const { repository, postState, postError, getLocale, sessionTempModelRefBySession } = args;
  const assistant = repository.getSelectedAssistant();
  if (!assistant || assistant.isDeleted) {
    return;
  }
  const session = repository.getSelectedSession(assistant.id);
  if (!session) {
    return;
  }
  const modelRef = message.modelRef.trim();
  if (!modelRef) {
    delete sessionTempModelRefBySession[session.id];
    postState();
    return;
  }
  const option = repository.resolveModelOption(modelRef);
  if (!option) {
    postError(getStrings(getLocale()).modelUnavailable);
    return;
  }
  sessionTempModelRefBySession[session.id] = option.ref;
  postState();
}
