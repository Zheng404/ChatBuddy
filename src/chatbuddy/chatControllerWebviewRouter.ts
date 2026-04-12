import * as vscode from 'vscode';

import { formatString, getStrings } from './i18n';
import { AssistantProfile, ChatSessionSummary, RuntimeLocale, WebviewInboundMessage } from './types';

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
  setSessionPanelCollapsed: (collapsed: boolean) => void;
  resolveModelOption: (modelRef: string) => { ref: string } | undefined;
  setAssistantStreaming: (assistantId: string, enabled: boolean) => void;
};

export type ChatControllerWebviewRouterArgs = {
  message: WebviewInboundMessage;
  context?: ChatControllerPanelMessageContext;
  repository: RouterRepository;
  getLocale: () => RuntimeLocale;
  hasPendingToolContinuation: boolean;
  postError: (message: string, context?: ChatControllerPanelMessageContext) => void;
  postState: (error?: string, context?: ChatControllerPanelMessageContext) => void;
  createSessionForAssistant: (assistantId: string) => string | undefined;
  ensureSession: (assistantId: string) => void;
  sessionTempModelRefBySession: Record<string, string>;
  setStreamingEnabled: (enabled: boolean) => void;
  regenerateReply: (context?: ChatControllerPanelMessageContext) => Promise<void>;
  regenerateFromMessage: (messageId: string, context?: ChatControllerPanelMessageContext) => Promise<void>;
  copyMessage: (messageId: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  editMessage: (messageId: string, newContent: string) => Promise<void>;
  clearSession: () => Promise<void>;
  sendMessage: (content: string, context?: ChatControllerPanelMessageContext) => Promise<void>;
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
    postError,
    postState,
    createSessionForAssistant,
    ensureSession,
    sessionTempModelRefBySession,
    setStreamingEnabled,
    regenerateReply,
    regenerateFromMessage,
    copyMessage,
    deleteMessage,
    editMessage,
    clearSession,
    sendMessage,
    continuePendingToolCalls,
    cancelPendingToolCalls,
    listMcpResources,
    listMcpPrompts,
    insertMcpResource,
    insertMcpPrompt,
    stopGeneration,
    confirmDangerousAction
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

  switch (message.type) {
    case 'ready':
      postState(undefined, context);
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
      const assistant = repository.getSelectedAssistant();
      if (!assistant) {
        return;
      }
      const previousSessionId = repository.getSelectedSession(assistant.id)?.id;
      repository.selectSession(assistant.id, message.sessionId);
      if (previousSessionId && previousSessionId !== message.sessionId) {
        delete sessionTempModelRefBySession[previousSessionId];
      }
      postState();
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
      const assistant = repository.getSelectedAssistant();
      if (!assistant) {
        return;
      }
      const session = repository.getSessionsForAssistant(assistant.id).find((item) => item.id === message.sessionId);
      if (!session) {
        return;
      }
      const strings = getStrings(getLocale());
      const sessionTitle = session.title?.trim() || strings.untitledSession;
      const confirmed = await confirmDangerousAction(
        formatString(strings.confirmDeleteSession, { title: sessionTitle }),
        strings.deleteAction
      );
      if (!confirmed) {
        return;
      }
      repository.deleteSession(assistant.id, message.sessionId);
      delete sessionTempModelRefBySession[message.sessionId];
      ensureSession(assistant.id);
      postState();
      return;
    }
    case 'setSessionTempModel': {
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
      return;
    }
    case 'toggleSessionPanel': {
      const state = repository.getState();
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
      await regenerateReply(context);
      return;
    case 'regenerateFromMessage':
      await regenerateFromMessage(message.messageId, context);
      return;
    case 'copyMessage':
      await copyMessage(message.messageId);
      return;
    case 'deleteMessage':
      await deleteMessage(message.messageId);
      return;
    case 'editMessage':
      await editMessage(message.messageId, message.newContent);
      return;
    case 'clearSession':
      await clearSession();
      return;
    case 'sendMessage':
      await sendMessage(message.content, context);
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
    case 'stopGeneration':
      stopGeneration('manual');
      postState(undefined, context);
      return;
    default:
      return;
  }
}
