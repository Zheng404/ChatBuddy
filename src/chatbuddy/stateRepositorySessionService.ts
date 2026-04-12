import * as vscode from 'vscode';

import { resolveLocale } from './i18n';
import { cloneSession, cloneSessionSummary } from './stateClone';
import { resolveLocaleString } from './utils';
import { createId, nowTs } from './utils/id';
import { ChatStorage } from './chatStorage';
import {
  ChatMessage,
  ChatSession,
  ChatSessionDetail,
  ChatSessionSummary,
  PersistedStateLite
} from './types';

type SessionServiceContext = {
  getState: () => PersistedStateLite;
  storage: ChatStorage;
  storageReady: () => boolean;
  persistLater: () => void;
  ensureStorageReady: () => void;
  getSelectedAssistantId: () => string | undefined;
  markAssistantInteracted: (assistantId: string, persist?: boolean) => void;
};

export class SessionStateService {
  constructor(private readonly context: SessionServiceContext) {}

  public getSessionsForAssistant(assistantId: string): ChatSessionSummary[] {
    if (!this.context.storageReady()) {
      return [];
    }
    return this.context.storage.listSessionsByAssistant(assistantId).map(cloneSessionSummary);
  }

  public getLatestSessionForAssistantRaw(assistantId: string): ChatSessionSummary | undefined {
    if (!this.context.storageReady()) {
      return undefined;
    }
    return this.context.storage.getLatestSessionSummary(assistantId);
  }

  public getSelectedSession(assistantId?: string): ChatSessionDetail | undefined {
    if (!this.context.storageReady()) {
      return undefined;
    }
    const state = this.context.getState();
    const targetAssistantId = assistantId ?? state.selectedAssistantId;
    if (!targetAssistantId) {
      return undefined;
    }
    const selectedSessionId = state.selectedSessionIdByAssistant[targetAssistantId];
    if (selectedSessionId) {
      const selected = this.context.storage.getSessionDetail(targetAssistantId, selectedSessionId);
      if (selected) {
        return cloneSession(selected);
      }
    }
    const latest = this.getLatestSessionForAssistantRaw(targetAssistantId);
    if (!latest) {
      return undefined;
    }
    const detail = this.context.storage.getSessionDetail(targetAssistantId, latest.id);
    return detail ? cloneSession(detail) : undefined;
  }

  public getSelectedSessionId(assistantId?: string): string | undefined {
    if (!this.context.storageReady()) {
      return undefined;
    }
    const state = this.context.getState();
    const targetAssistantId = assistantId ?? this.context.getSelectedAssistantId();
    if (!targetAssistantId) {
      return undefined;
    }
    const selectedSessionId = state.selectedSessionIdByAssistant[targetAssistantId];
    if (selectedSessionId && this.context.storage.sessionExists(targetAssistantId, selectedSessionId)) {
      return selectedSessionId;
    }
    return this.getLatestSessionForAssistantRaw(targetAssistantId)?.id;
  }

  public getSessionById(sessionId: string): ChatSessionDetail | undefined {
    if (!this.context.storageReady()) {
      return undefined;
    }
    const session = this.context.storage.getSessionDetailById(sessionId);
    return session ? cloneSession(session) : undefined;
  }

  public createSession(assistantId: string, title: string): ChatSessionDetail {
    this.context.ensureStorageReady();
    const state = this.context.getState();
    const assistant = state.assistants.find((item) => item.id === assistantId);
    const locale = resolveLocale(state.settings.locale, vscode.env.language);
    if (!assistant) {
      throw new Error(resolveLocaleString(locale, '助手不存在', 'Assistant not found'));
    }
    if (assistant.isDeleted) {
      throw new Error(resolveLocaleString(locale, '已删除助手无法创建会话', 'Cannot create session for deleted assistant'));
    }
    const timestamp = nowTs();
    const greeting = assistant.greeting.trim();
    const session: ChatSession = {
      id: createId('session'),
      assistantId,
      title,
      titleSource: 'default',
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: greeting
        ? [
            {
              id: createId('msg'),
              role: 'assistant',
              content: greeting,
              timestamp
            }
          ]
        : []
    };
    this.context.storage.insertSession(session, true);
    state.selectedSessionIdByAssistant[assistantId] = session.id;
    state.selectedAssistantId = assistantId;
    assistant.lastInteractedAt = timestamp;
    assistant.updatedAt = timestamp;
    this.context.persistLater();
    return cloneSession(session);
  }

  public selectSession(assistantId: string, sessionId: string): void {
    if (!this.context.storageReady()) {
      return;
    }
    const exists = this.context.storage.sessionExists(assistantId, sessionId);
    if (!exists) {
      return;
    }
    const state = this.context.getState();
    state.selectedAssistantId = assistantId;
    state.selectedSessionIdByAssistant[assistantId] = sessionId;
    this.context.markAssistantInteracted(assistantId, false);
    this.context.persistLater();
  }

  public renameSession(assistantId: string, sessionId: string, title: string): void {
    if (!this.context.storageReady()) {
      return;
    }
    const normalized = title.trim();
    if (!normalized) {
      return;
    }
    const session = this.getSessionById(sessionId);
    if (!session || session.assistantId !== assistantId) {
      return;
    }
    const updatedAt = nowTs();
    const changed = this.context.storage.renameSession(assistantId, sessionId, normalized, 'custom', updatedAt);
    if (!changed) {
      return;
    }
    this.context.markAssistantInteracted(assistantId, false);
    this.context.persistLater();
  }

  public generateSessionTitle(assistantId: string, sessionId: string, title: string): void {
    if (!this.context.storageReady()) {
      return;
    }
    const normalized = title.trim();
    if (!normalized) {
      return;
    }
    const session = this.getSessionById(sessionId);
    if (!session || session.assistantId !== assistantId || session.titleSource !== 'default') {
      return;
    }
    const updatedAt = nowTs();
    const changed = this.context.storage.renameSession(assistantId, sessionId, normalized, 'generated', updatedAt);
    if (!changed) {
      return;
    }
    this.context.markAssistantInteracted(assistantId, false);
    this.context.persistLater();
  }

  public deleteSession(assistantId: string, sessionId: string): void {
    if (!this.context.storageReady()) {
      return;
    }
    const removed = this.context.storage.deleteSession(assistantId, sessionId, true);
    if (!removed) {
      return;
    }
    const state = this.context.getState();
    const latest = this.getLatestSessionForAssistantRaw(assistantId);
    if (latest) {
      state.selectedSessionIdByAssistant[assistantId] = latest.id;
    } else {
      delete state.selectedSessionIdByAssistant[assistantId];
    }
    this.context.markAssistantInteracted(assistantId, false);
    this.context.persistLater();
  }

  public clearSessionsForAssistant(assistantId: string): number {
    if (!this.context.storageReady()) {
      return 0;
    }
    const removed = this.context.storage.clearSessionsForAssistant(assistantId, true);
    if (removed <= 0) {
      return 0;
    }
    const state = this.context.getState();
    delete state.selectedSessionIdByAssistant[assistantId];
    this.context.markAssistantInteracted(assistantId, false);
    this.context.persistLater();
    return removed;
  }

  public appendMessage(assistantId: string, sessionId: string, message: ChatMessage): ChatSessionDetail {
    this.context.ensureStorageReady();
    const updatedAt = nowTs();
    const changed = this.context.storage.appendMessage(assistantId, sessionId, message, updatedAt, true);
    if (!changed) {
      throw new Error('Session not found');
    }
    const state = this.context.getState();
    state.selectedSessionIdByAssistant[assistantId] = sessionId;
    state.selectedAssistantId = assistantId;
    this.context.markAssistantInteracted(assistantId, false);
    this.context.persistLater();
    const next = this.getSelectedSession(assistantId);
    if (!next || next.id !== sessionId) {
      throw new Error('Session not found');
    }
    return cloneSession(next);
  }

  public updateLastAssistantMessage(
    assistantId: string,
    sessionId: string,
    updater: (current: ChatMessage | undefined) => ChatMessage,
    persist = true
  ): ChatSessionDetail {
    this.context.ensureStorageReady();
    const updatedAt = nowTs();
    const changed = this.context.storage.updateLastAssistantMessage(assistantId, sessionId, updater, updatedAt, persist);
    if (!changed) {
      throw new Error('Session not found');
    }
    const state = this.context.getState();
    state.selectedSessionIdByAssistant[assistantId] = sessionId;
    state.selectedAssistantId = assistantId;
    this.context.markAssistantInteracted(assistantId, false);
    if (persist) {
      this.context.persistLater();
    }
    const next = this.getSelectedSession(assistantId);
    if (!next || next.id !== sessionId) {
      throw new Error('Session not found');
    }
    return cloneSession(next);
  }

  public truncateSessionMessages(assistantId: string, sessionId: string, keepCount: number): ChatSessionDetail | undefined {
    if (!Number.isFinite(keepCount) || keepCount < 0 || !this.context.storageReady()) {
      return undefined;
    }
    const updatedAt = nowTs();
    const changed = this.context.storage.truncateMessages(assistantId, sessionId, Math.floor(keepCount), updatedAt, true);
    if (!changed) {
      return undefined;
    }
    const state = this.context.getState();
    state.selectedSessionIdByAssistant[assistantId] = sessionId;
    state.selectedAssistantId = assistantId;
    this.context.markAssistantInteracted(assistantId, false);
    this.context.persistLater();
    const next = this.getSelectedSession(assistantId);
    return next && next.id === sessionId ? cloneSession(next) : undefined;
  }

  public deleteMessage(assistantId: string, sessionId: string, messageId: string): ChatSessionDetail | undefined {
    if (!this.context.storageReady()) {
      return undefined;
    }
    const updatedAt = nowTs();
    const changed = this.context.storage.deleteMessage(assistantId, sessionId, messageId, updatedAt, true);
    if (!changed) {
      const current = this.getSelectedSession(assistantId);
      return current && current.id === sessionId ? cloneSession(current) : undefined;
    }
    const state = this.context.getState();
    state.selectedSessionIdByAssistant[assistantId] = sessionId;
    state.selectedAssistantId = assistantId;
    this.context.markAssistantInteracted(assistantId, false);
    this.context.persistLater();
    const next = this.getSelectedSession(assistantId);
    return next && next.id === sessionId ? cloneSession(next) : undefined;
  }

  public editMessage(assistantId: string, sessionId: string, messageId: string, newContent: string): ChatSessionDetail | undefined {
    if (!this.context.storageReady()) {
      return undefined;
    }
    const updatedAt = nowTs();
    const changed = this.context.storage.updateMessage(assistantId, sessionId, messageId, newContent, updatedAt, true);
    if (!changed) {
      return undefined;
    }
    const current = this.getSelectedSession(assistantId);
    if (current && current.id === sessionId) {
      return cloneSession(current);
    }
    return undefined;
  }

  public clearSessionMessages(assistantId: string, sessionId: string): ChatSessionDetail | undefined {
    if (!this.context.storageReady()) {
      return undefined;
    }
    const updatedAt = nowTs();
    const changed = this.context.storage.clearSessionMessages(assistantId, sessionId, updatedAt, true);
    if (!changed) {
      return undefined;
    }
    const current = this.getSelectedSession(assistantId);
    if (current && current.id === sessionId) {
      return cloneSession(current);
    }
    return undefined;
  }

  public setSessionPanelCollapsed(collapsed: boolean): void {
    const state = this.context.getState();
    state.sessionPanelCollapsed = collapsed;
    this.context.persistLater();
  }
}
