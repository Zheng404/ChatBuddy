/**
 * 聊天控制器状态缓存管理。
 *
 * 封装 `payloadBaseCache` 的缓存策略：在流式生成期间缓存 sessions
 * 数据以避免重复的 SQLite 查询，非生成期直接穿透。
 */
import type { ChatStateRepository } from './stateRepository';
import type { AssistantProfile, ChatSessionDetail, ChatSessionSummary } from './types';

type PayloadBaseCache = {
  state: ReturnType<ChatStateRepository['getState']>;
  version: number;
  expiresAt: number;
  assistantId: string;
  selectedAssistant: AssistantProfile | undefined;
  sessions: ChatSessionSummary[];
  selectedSession: ChatSessionDetail | undefined;
};

export class ChatStateCache {
  private cache: PayloadBaseCache | undefined;

  constructor(
    private readonly repository: ChatStateRepository,
    private readonly ttlMs: number
  ) {}

  getBaseState(isGenerating: boolean): ReturnType<ChatStateRepository['getState']> {
    const currentVersion = this.repository.getVersion();
    const cached = this.cache;
    if (cached && cached.version === currentVersion && cached.expiresAt > Date.now()) {
      return cached.state;
    }
    if (!isGenerating) {
      this.cache = undefined;
      return this.repository.getState();
    }
    const state = this.repository.getState();
    const assistant = this.repository.getSelectedAssistant();
    const assistantId = assistant?.id || '';
    const sessions = assistant ? this.repository.getSessionsForAssistant(assistant.id) : [];
    const selectedSession = assistant ? this.repository.getSelectedSession(assistant.id) : undefined;
    this.cache = {
      state,
      version: currentVersion,
      expiresAt: Date.now() + this.ttlMs,
      assistantId,
      selectedAssistant: assistant,
      sessions,
      selectedSession
    };
    return state;
  }

  getCachedSessions(assistantId: string): {
    assistant: AssistantProfile | undefined;
    sessions: ChatSessionSummary[];
    selectedSession: ChatSessionDetail | undefined;
  } {
    const cached = this.cache;
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

  clear(): void {
    this.cache = undefined;
  }
}
