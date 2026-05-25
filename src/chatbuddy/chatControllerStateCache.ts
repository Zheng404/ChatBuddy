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
  cachedAt: number;
  assistantId: string;
  selectedAssistant: AssistantProfile | undefined;
  sessions: ChatSessionSummary[];
  selectedSession: ChatSessionDetail | undefined;
};

/** Maximum absolute age for cache entries (30s), guards against NTP clock rollback. */
const MAX_CACHE_AGE_MS = 30_000;

export class ChatStateCache {
  private cache: PayloadBaseCache | undefined;

  constructor(
    private readonly repository: ChatStateRepository,
    private readonly ttlMs: number
  ) {}

  getBaseState(isGenerating: boolean): ReturnType<ChatStateRepository['getState']> {
    const currentVersion = this.repository.getVersion();
    const cached = this.cache;
    const now = Date.now();
    if (cached && cached.version === currentVersion && cached.expiresAt > now && now - cached.cachedAt < MAX_CACHE_AGE_MS) {
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
      expiresAt: now + this.ttlMs,
      cachedAt: now,
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
    const now = Date.now();
    if (cached && cached.version === this.repository.getVersion() && cached.assistantId === assistantId && cached.expiresAt > now && now - cached.cachedAt < MAX_CACHE_AGE_MS) {
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
