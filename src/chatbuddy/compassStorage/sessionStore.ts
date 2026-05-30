/**
 * Compass 会话存储模块。
 *
 * 管理会话索引（`index.compass.json`）和消息文件（`{assistantId}/{sessionId}.jsonl`）
 * 的加载、持久化、CRUD 和验证。
 *
 * 消息以 JSON Lines 格式存储，每行一个规范化后的消息对象。
 */
import * as fs from 'fs';
import * as path from 'path';
import { ChatMessage, ChatSessionDetail, ChatSessionSummary, ChatToolRound } from '../types';
import { LRUCache, nowTs, warn } from '../utils';
import {
  appendTextFile,
  ensureDir,
  fileExists,
  listFilesRecursively,
  readBase64File,
  readJsonFile,
  readTextFile,
  removeEmptyDirectoriesRecursively,
  removeFileIfExists,
  writeBase64File,
  writeJsonAtomic,
  writeTextAtomic
} from './io';
import { CompassPaths, getImageFilePath, getSessionFilePath, generateImagePath } from './paths';
import {
  buildPreview,
  cloneMessage,
  cloneSummary,
  CompassValidationResult,
  CompassIndexFile,
  normalizeMessageInput,
  normalizeSummary,
  SessionSummaryInternal,
  toNumberValue,
  toRoleValue,
  toStringValue,
  toTitleSource
} from './types';

/** 内存中保留的最大会话数量（LRU 淘汰） */
const MAX_SESSIONS_IN_MEMORY = 50;

function parseToolRounds(raw: unknown): ChatToolRound[] | undefined {
  if (typeof raw !== 'string' || !raw.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as ChatToolRound[];
    }
  } catch (err) {
    warn('Error parsing tool rounds:', err);
  }
  return undefined;
}

function parseImages(raw: unknown): ChatMessage['images'] {
  if (typeof raw !== 'string' || !raw.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as ChatMessage['images'];
    }
  } catch (err) {
    warn('Error parsing images:', err);
  }
  return undefined;
}

function mapLegacyMessageRow(row: Record<string, unknown>): ChatMessage {
  return {
    id: toStringValue(row.id),
    role: toRoleValue(row.role),
    content: toStringValue(row.content),
    timestamp: toNumberValue(row.ts, nowTs()),
    model: toStringValue(row.model).trim() || undefined,
    reasoning: toStringValue(row.reasoning).trim() || undefined,
    toolRounds: parseToolRounds(row.tool_rounds),
    images: parseImages(row.images)
  };
}

export class CompassSessionStore {
  private readonly sessionSummaries = new Map<string, SessionSummaryInternal>();
  /** 使用 LRU 缓存限制内存中的会话消息数量，超出限制时自动淘汰最少使用的会话 */
  private readonly sessionMessages = new LRUCache<string, ChatMessage[]>(MAX_SESSIONS_IN_MEMORY);
  /** 追踪待追加的消息（仅追加模式，不涉及编辑/删除） */
  private readonly pendingAppends = new Map<string, ChatMessage[]>();
  /** 追踪需要完整重写的会话（编辑、删除、清空等操作） */
  private readonly pendingRewrites = new Set<string>();
  /** 索引级别脏标记（insert/rename/delete 等不触发 pendingAppends/Rewrites 但需要重写索引） */
  private indexDirty = false;
  /** 倒排搜索索引：token -> session IDs */
  private readonly searchIndex = new Map<string, Set<string>>();

  public async load(paths: CompassPaths): Promise<void> {
    // 保存完整的内存状态快照（包括 summaries 和 messages）
    // 防止其他 IDE 触发 reload 时丢失本地新生成但未 persist 的会话
    const savedSummaries = new Map(this.sessionSummaries);
    const savedMessages = new Map(this.sessionMessages.entries());
    const savedAppends = new Map(this.pendingAppends);
    const savedRewrites = new Set(this.pendingRewrites);

    this.sessionSummaries.clear();
    this.sessionMessages.clear();
    this.pendingAppends.clear();
    this.pendingRewrites.clear();
    this.indexDirty = false;

    const indexPayload = await readJsonFile<CompassIndexFile>(paths.indexPath);
    const sessions = Array.isArray(indexPayload?.sessions) ? indexPayload.sessions : [];

    for (const rawSummary of sessions) {
      const summary = normalizeSummary(rawSummary, nowTs());
      if (!summary.id || !summary.assistantId) {
        continue;
      }
      const sessionFilePath = getSessionFilePath(paths, summary.assistantId, summary.id);
      const messages = await this.readSessionMessages(sessionFilePath);
      const hydratedMessages = await this.hydrateImages(messages, paths);
      summary.messageCount = hydratedMessages.length;
      summary.preview = buildPreview(hydratedMessages);
      this.sessionSummaries.set(summary.id, summary);
      this.sessionMessages.set(summary.id, hydratedMessages);
    }

    // 捕获异步磁盘读取期间新增的 pending 数据（流式生成等场景）
    // 这些数据在 save 快照之后、clear 之后才写入，不在 savedAppends/savedRewrites 中

    // 捕获异步 I/O 期间新创建的会话（不在 savedSummaries 中，也不在磁盘上）
    // 这些会话已在 maps 中（insertSession 写入 cleared maps），但 restore 逻辑只遍历 savedSummaries
    for (const [sid, summary] of this.sessionSummaries) {
      if (!savedSummaries.has(sid)) {
        savedSummaries.set(sid, summary);
        savedMessages.set(sid, this.sessionMessages.get(sid) ?? []);
        savedRewrites.add(sid);
      }
    }

    for (const [sid, msgs] of this.pendingAppends) {
      const existing = savedAppends.get(sid) ?? [];
      existing.push(...msgs);
      savedAppends.set(sid, existing);
    }
    for (const sid of this.pendingRewrites) {
      savedRewrites.add(sid);
    }
    // 清除 interim 数据（将在下方 restore 逻辑中重新合并）
    this.pendingAppends.clear();
    this.pendingRewrites.clear();

    // 恢复内存中独有但磁盘上不存在的数据（新生成未 persist 的会话）
    // 以及合并已存在会话的本地元数据变更（如标题重命名）和未持久化的消息
    for (const [sessionId, summary] of savedSummaries) {
      if (!this.sessionSummaries.has(sessionId)) {
        // 磁盘上没有这个会话，保留内存中的完整版本
        const messages = savedMessages.get(sessionId) ?? [];
        this.sessionSummaries.set(sessionId, summary);
        this.sessionMessages.set(sessionId, messages);
        // 标记为需要完整重写（因为它还没被 persist 到磁盘）
        this.pendingRewrites.add(sessionId);
      } else {
        // 会话在磁盘和内存都存在：如果本地版本更新，合并元数据变更
        const diskSummary = this.sessionSummaries.get(sessionId)!;
        if (summary.updatedAt > diskSummary.updatedAt) {
          diskSummary.title = summary.title;
          diskSummary.titleSource = summary.titleSource;
          diskSummary.updatedAt = summary.updatedAt;
          this.pendingRewrites.add(sessionId);
          this.pendingAppends.delete(sessionId);
        }

        // 修复：当会话标记为 pendingRewrites 时，appendMessage 不会写入 pendingAppends，
        // 导致异步磁盘读取期间（load 清空 maps 后、磁盘数据加载前）到达的消息丢失。
        // 此处将磁盘消息与 reload 前的内存消息合并（按 ID 去重），确保不丢失数据。
        if (this.pendingRewrites.has(sessionId) && !savedAppends.has(sessionId)) {
          const savedMsgs = savedMessages.get(sessionId);
          if (savedMsgs && savedMsgs.length > 0) {
            const diskMsgs = this.sessionMessages.get(sessionId) ?? [];
            const existingIds = new Set(diskMsgs.map((m) => m.id));
            let hasNew = false;
            for (const msg of savedMsgs) {
              if (!existingIds.has(msg.id)) {
                diskMsgs.push(msg);
                existingIds.add(msg.id);
                hasNew = true;
              }
            }
            if (hasNew) {
              this.sessionMessages.set(sessionId, diskMsgs);
              diskSummary.messageCount = diskMsgs.length;
              diskSummary.preview = buildPreview(diskMsgs);
            }
          }
        }
      }
    }

    // 恢复本地未持久化的追加消息（通过 message id 去重）
    for (const [sessionId, pendingMessages] of savedAppends) {
      const existingMessages = this.sessionMessages.get(sessionId);
      if (!existingMessages) {
        // 会话可能已被其他 IDE 删除，跳过
        continue;
      }
      const existingIds = new Set(existingMessages.map((m) => m.id));
      const messagesToRestore: ChatMessage[] = [];
      for (const msg of pendingMessages) {
        if (!existingIds.has(msg.id)) {
          existingMessages.push(msg);
          messagesToRestore.push(msg);
          existingIds.add(msg.id);
        }
      }
      if (messagesToRestore.length > 0) {
        const summary = this.sessionSummaries.get(sessionId);
        if (summary) {
          summary.messageCount = existingMessages.length;
          summary.preview = buildPreview(existingMessages);
        }
        this.pendingAppends.set(sessionId, messagesToRestore);
      }
    }

    // 恢复需要重写的会话标记
    for (const sessionId of savedRewrites) {
      if (this.sessionMessages.has(sessionId)) {
        this.pendingRewrites.add(sessionId);
      }
    }

    this.rebuildSearchIndex();
  }

  public async persist(paths: CompassPaths): Promise<void> {
    const indexPayload: CompassIndexFile = {
      sessions: [...this.sessionSummaries.values()]
        .map((summary) => normalizeSummary(summary, nowTs()))
        .sort((a, b) => {
          const byCreatedAt = a.createdAt - b.createdAt;
          if (byCreatedAt !== 0) {
            return byCreatedAt;
          }
          return a.id.localeCompare(b.id);
        })
    };

    await ensureDir(paths.sessionsPath);

    // 先写 session 文件，再写 index，确保 reader 看到有效的 index 时文件已存在
    const expectedSessionFiles = new Set<string>();
    await ensureDir(paths.imagesPath);

    for (const summary of indexPayload.sessions) {
      const sessionFilePath = getSessionFilePath(paths, summary.assistantId, summary.id);
      expectedSessionFiles.add(sessionFilePath);

      const sessionId = summary.id;
      const hasPendingAppends = this.pendingAppends.has(sessionId);
      const needsRewrite = this.pendingRewrites.has(sessionId);

      if (hasPendingAppends && !needsRewrite) {
        // 仅追加新消息（高效路径）
        const pendingMessages = this.pendingAppends.get(sessionId) ?? [];
        if (pendingMessages.length > 0) {
          const messagesForPersist = await this.extractImagesToFiles(
            pendingMessages.map((message) => normalizeMessageInput(message, nowTs())),
            paths,
            sessionId
          );
          const content = messagesForPersist.map((message) => JSON.stringify(message)).join('\n');
          // 共享存储模式下，追加超过 PIPE_BUF（4096 字节）的内容不保证原子性。
          // 降级为全量重写，避免多 IDE 并发追加导致 JSONL 行交错。
          if (Buffer.byteLength(content, 'utf-8') > 4096) {
            // 降级：将所有消息（现有 + 新追加）全量重写
            const messages = (this.sessionMessages.get(sessionId) ?? []).map((message) =>
              normalizeMessageInput(message, nowTs())
            );
            const allMessagesForPersist = await this.extractImagesToFiles(messages, paths, sessionId);
            const fullContent = allMessagesForPersist.map((message) => JSON.stringify(message)).join('\n');
            await writeTextAtomic(sessionFilePath, fullContent ? `${fullContent}\n` : '');
          } else {
            await appendTextFile(sessionFilePath, content ? `${content}\n` : '');
          }
        }
      } else {
        // 完整重写（新会话、编辑、删除、清空等）
        const messages = (this.sessionMessages.get(sessionId) ?? []).map((message) =>
          normalizeMessageInput(message, nowTs())
        );
        const messagesForPersist = await this.extractImagesToFiles(messages, paths, sessionId);
        const content = messagesForPersist.map((message) => JSON.stringify(message)).join('\n');
        await writeTextAtomic(sessionFilePath, content ? `${content}\n` : '');
      }
    }

    // session 文件全部写入后，再写 index（确保引用完整性）
    await writeJsonAtomic(paths.indexPath, indexPayload);

    // 清理已处理的 pending 状态
    this.pendingAppends.clear();
    this.pendingRewrites.clear();
    this.indexDirty = false;

    // 读取磁盘 index，发现其他 IDE 创建但本 IDE 未知的会话
    // 这些会话的文件必须保留，否则会造成数据丢失
    const diskIndex = await readJsonFile<CompassIndexFile>(paths.indexPath).catch(() => undefined);
    if (diskIndex?.sessions && Array.isArray(diskIndex.sessions)) {
      for (const rawSummary of diskIndex.sessions) {
        const summary = normalizeSummary(rawSummary, nowTs());
        if (summary.id && summary.assistantId && !this.sessionSummaries.has(summary.id)) {
          // 其他 IDE 创建的会话，保留其文件
          const filePath = getSessionFilePath(paths, summary.assistantId, summary.id);
          expectedSessionFiles.add(filePath);
        }
      }
    }

    const existingSessionFiles = await listFilesRecursively(paths.sessionsPath, '.jsonl').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    });
    for (const filePath of existingSessionFiles) {
      if (!expectedSessionFiles.has(filePath)) {
        await removeFileIfExists(filePath);
      }
    }
    await removeEmptyDirectoriesRecursively(paths.sessionsPath);
  }

  public hasAnySession(): boolean {
    return this.countSessions() > 0;
  }

  public isDirty(): boolean {
    return this.pendingAppends.size > 0 || this.pendingRewrites.size > 0 || this.indexDirty;
  }

  public countSessions(): number {
    return this.sessionSummaries.size;
  }

  public hasData(): boolean {
    return this.sessionSummaries.size > 0 || this.sessionMessages.size > 0;
  }

  public async validateSnapshot(paths: CompassPaths): Promise<CompassValidationResult> {
    const [indexExists, sessionFiles] = await Promise.all([
      fileExists(paths.indexPath),
      listFilesRecursively(paths.sessionsPath, '.jsonl').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return [];
        }
        throw error;
      })
    ]);

    if (!indexExists) {
      if (sessionFiles.length > 0) {
        return { valid: false, reason: 'Session index is missing while session files still exist' };
      }
      return { valid: true };
    }

    const rawIndex = await readTextFile(paths.indexPath);
    if (!rawIndex || !rawIndex.trim()) {
      return { valid: false, reason: 'Session index file is empty' };
    }

    let parsedIndex: unknown;
    try {
      parsedIndex = JSON.parse(rawIndex);
    } catch (err) {
      warn('Error parsing session index:', err);
      return { valid: false, reason: 'Session index file is not valid JSON' };
    }

    if (!parsedIndex || typeof parsedIndex !== 'object' || !Array.isArray((parsedIndex as CompassIndexFile).sessions)) {
      return { valid: false, reason: 'Session index file has an invalid shape' };
    }

    const expectedSessionFiles = new Set<string>();
    const sessionIds = new Set<string>();
    for (const rawSummary of (parsedIndex as CompassIndexFile).sessions) {
      const summary = normalizeSummary(rawSummary, nowTs());
      if (!summary.id || !summary.assistantId) {
        return { valid: false, reason: 'Session index contains a summary without id or assistantId' };
      }
      if (sessionIds.has(summary.id)) {
        return { valid: false, reason: `Session index contains duplicate session id: ${summary.id}` };
      }
      sessionIds.add(summary.id);

      const sessionFilePath = getSessionFilePath(paths, summary.assistantId, summary.id);
      expectedSessionFiles.add(sessionFilePath);
      const sessionValidation = await this.validateSessionFile(sessionFilePath);
      if (!sessionValidation.valid) {
        return sessionValidation;
      }
    }

    for (const sessionFilePath of sessionFiles) {
      if (!expectedSessionFiles.has(sessionFilePath)) {
        return { valid: false, reason: `Found orphan session file not referenced by the index: ${sessionFilePath}` };
      }
    }

    return { valid: true };
  }

  public listSessionsByAssistant(assistantId: string): ChatSessionSummary[] {
    return [...this.sessionSummaries.values()]
      .filter((summary) => summary.assistantId === assistantId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((summary) => cloneSummary(summary));
  }

  public searchSessionIdsByContent(assistantId: string, keyword: string): string[] {
    const normalizedKeyword = toStringValue(keyword).trim().toLowerCase();
    if (!normalizedKeyword) {
      return [];
    }

    // For very short keywords, fall back to linear scan
    if (normalizedKeyword.length < 2) {
      return this.fallbackSearch(assistantId, normalizedKeyword);
    }

    const tokens = normalizedKeyword.split(/[\s\p{P}]+/u).filter((t) => t.length >= 2);

    // If no valid tokens, fall back to linear scan
    if (tokens.length === 0) {
      return this.fallbackSearch(assistantId, normalizedKeyword);
    }

    let result: Set<string> | undefined;
    for (const token of tokens) {
      const sessions = this.searchIndex.get(token);
      if (!sessions) {
        return [];
      }
      if (!result) {
        result = new Set(sessions);
      } else {
        for (const sid of result) {
          if (!sessions.has(sid)) {
            result.delete(sid);
          }
        }
      }
    }

    if (!result) {
      return [];
    }

    // Filter by assistantId
    const filtered: string[] = [];
    for (const sessionId of result) {
      const summary = this.sessionSummaries.get(sessionId);
      if (summary && summary.assistantId === assistantId) {
        filtered.push(sessionId);
      }
    }
    return filtered;
  }

  private fallbackSearch(assistantId: string, keyword: string): string[] {
    const sessionIds: string[] = [];
    for (const summary of this.sessionSummaries.values()) {
      if (summary.assistantId !== assistantId) {
        continue;
      }
      const messages = this.sessionMessages.get(summary.id) ?? [];
      if (messages.some((message) => toStringValue(message.content).toLowerCase().includes(keyword))) {
        sessionIds.push(summary.id);
      }
    }
    return sessionIds;
  }

  private indexMessage(sessionId: string, message: ChatMessage): void {
    const text = toStringValue(message.content);
    if (!text) {
      return;
    }

    // Simple tokenization: split by whitespace and punctuation
    const tokens = text.toLowerCase().split(/[\s\p{P}]+/u).filter((t) => t.length >= 2);

    for (const token of tokens) {
      const sessions = this.searchIndex.get(token);
      if (sessions) {
        sessions.add(sessionId);
      } else {
        this.searchIndex.set(token, new Set([sessionId]));
      }
    }
  }

  private removeSessionFromIndex(sessionId: string): void {
    for (const sessions of this.searchIndex.values()) {
      sessions.delete(sessionId);
    }
  }

  private reindexSession(sessionId: string): void {
    this.removeSessionFromIndex(sessionId);
    const messages = this.sessionMessages.get(sessionId) ?? [];
    for (const message of messages) {
      this.indexMessage(sessionId, message);
    }
  }

  private rebuildSearchIndex(): void {
    this.searchIndex.clear();
    for (const [sessionId, messages] of this.sessionMessages.entries()) {
      for (const message of messages) {
        this.indexMessage(sessionId, message);
      }
    }
  }

  public getSessionSummary(assistantId: string, sessionId: string): ChatSessionSummary | undefined {
    const summary = this.sessionSummaries.get(sessionId);
    if (!summary || summary.assistantId !== assistantId) {
      return undefined;
    }
    return cloneSummary(summary);
  }

  public getLatestSessionSummary(assistantId: string): ChatSessionSummary | undefined {
    const sessions = this.listSessionsByAssistant(assistantId);
    return sessions.length > 0 ? sessions[0] : undefined;
  }

  public getSessionDetailById(sessionId: string): ChatSessionDetail | undefined {
    const summary = this.sessionSummaries.get(sessionId);
    if (!summary) {
      return undefined;
    }
    return this.buildDetail(summary);
  }

  public getSessionDetail(assistantId: string, sessionId: string): ChatSessionDetail | undefined {
    const summary = this.sessionSummaries.get(sessionId);
    if (!summary || summary.assistantId !== assistantId) {
      return undefined;
    }
    return this.buildDetail(summary);
  }

  public sessionExists(assistantId: string, sessionId: string): boolean {
    const summary = this.sessionSummaries.get(sessionId);
    return !!summary && summary.assistantId === assistantId;
  }

  public insertSession(session: ChatSessionDetail): void {
    const normalizedMessages = (Array.isArray(session.messages) ? session.messages : []).map((message) =>
      normalizeMessageInput(cloneMessage(message), nowTs())
    );
    const summary: SessionSummaryInternal = {
      id: toStringValue(session.id),
      assistantId: toStringValue(session.assistantId),
      title: toStringValue(session.title),
      titleSource: toTitleSource(session.titleSource),
      createdAt: toNumberValue(session.createdAt, nowTs()),
      updatedAt: toNumberValue(session.updatedAt, nowTs()),
      messageCount: normalizedMessages.length,
      preview: buildPreview(normalizedMessages)
    };
    this.sessionSummaries.set(summary.id, summary);
    this.sessionMessages.set(summary.id, normalizedMessages);
    for (const message of normalizedMessages) {
      this.indexMessage(summary.id, message);
    }
    // 新会话首次 persist 需要完整重写（JSONL 文件可能不存在）
    this.pendingRewrites.add(summary.id);
    this.pendingAppends.delete(summary.id);
  }

  public renameSession(
    assistantId: string,
    sessionId: string,
    title: string,
    titleSource: ChatSessionDetail['titleSource'],
    updatedAt: number
  ): boolean {
    const summary = this.sessionSummaries.get(sessionId);
    if (!summary || summary.assistantId !== assistantId) {
      return false;
    }
    summary.title = title;
    summary.titleSource = titleSource;
    summary.updatedAt = updatedAt;
    // 标记为需要重写，确保 reload 时标题变更不会丢失
    this.pendingRewrites.add(sessionId);
    this.pendingAppends.delete(sessionId);
    return true;
  }

  public appendMessage(assistantId: string, sessionId: string, message: ChatMessage, updatedAt: number): boolean {
    if (!this.sessionExists(assistantId, sessionId)) {
      return false;
    }
    const normalized = normalizeMessageInput(cloneMessage(message), nowTs());
    const messages = this.ensureSessionMessages(sessionId);
    messages.push(normalized);
    this.indexMessage(sessionId, normalized);
    this.updateSummaryFromMessages(sessionId, updatedAt);

    // 追踪待追加的消息（仅追加模式）
    const pending = this.pendingAppends.get(sessionId);
    if (pending) {
      pending.push(normalized);
    } else if (!this.pendingRewrites.has(sessionId)) {
      this.pendingAppends.set(sessionId, [normalized]);
    }
    return true;
  }

  public updateLastAssistantMessage(
    assistantId: string,
    sessionId: string,
    updater: (current: ChatMessage | undefined) => ChatMessage,
    updatedAt: number
  ): boolean {
    if (!this.sessionExists(assistantId, sessionId)) {
      return false;
    }

    const messages = this.ensureSessionMessages(sessionId);
    let targetIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant') {
        targetIndex = index;
        break;
      }
    }

    const current = targetIndex >= 0 ? cloneMessage(messages[targetIndex]) : undefined;
    const next = normalizeMessageInput(cloneMessage(updater(current)), nowTs());

    if (targetIndex >= 0) {
      messages[targetIndex] = next;
    } else {
      messages.push(next);
    }

    this.pendingRewrites.add(sessionId);
    this.pendingAppends.delete(sessionId);
    this.reindexSession(sessionId);
    this.updateSummaryFromMessages(sessionId, updatedAt);
    return true;
  }

  public truncateMessages(assistantId: string, sessionId: string, keepCount: number, updatedAt: number): boolean {
    if (!Number.isFinite(keepCount) || keepCount < 0) {
      return false;
    }
    if (!this.sessionExists(assistantId, sessionId)) {
      return false;
    }
    const normalizedKeepCount = Math.floor(keepCount);
    const messages = this.ensureSessionMessages(sessionId);
    if (messages.length > normalizedKeepCount) {
      messages.splice(normalizedKeepCount);
    }
    this.pendingRewrites.add(sessionId);
    this.pendingAppends.delete(sessionId);
    this.reindexSession(sessionId);
    this.updateSummaryFromMessages(sessionId, updatedAt);
    return true;
  }

  public truncateMessagesAfter(assistantId: string, sessionId: string, messageId: string, updatedAt: number): boolean {
    if (!this.sessionExists(assistantId, sessionId)) {
      return false;
    }
    const messages = this.ensureSessionMessages(sessionId);
    const targetIndex = messages.findIndex((message) => message.id === messageId);
    if (targetIndex < 0) {
      return false;
    }
    messages.splice(targetIndex + 1);
    this.pendingRewrites.add(sessionId);
    this.pendingAppends.delete(sessionId);
    this.reindexSession(sessionId);
    this.updateSummaryFromMessages(sessionId, updatedAt);
    return true;
  }

  public deleteMessage(assistantId: string, sessionId: string, messageId: string, updatedAt: number): boolean {
    if (!this.sessionExists(assistantId, sessionId)) {
      return false;
    }
    const messages = this.ensureSessionMessages(sessionId);
    const targetIndex = messages.findIndex((message) => message.id === messageId);
    if (targetIndex < 0) {
      return false;
    }
    messages.splice(targetIndex, 1);
    this.pendingRewrites.add(sessionId);
    this.pendingAppends.delete(sessionId);
    this.reindexSession(sessionId);
    this.updateSummaryFromMessages(sessionId, updatedAt);
    return true;
  }

  public deleteSession(assistantId: string, sessionId: string): boolean {
    if (!this.sessionExists(assistantId, sessionId)) {
      return false;
    }
    this.sessionSummaries.delete(sessionId);
    this.sessionMessages.delete(sessionId);
    this.pendingAppends.delete(sessionId);
    this.pendingRewrites.delete(sessionId);
    this.removeSessionFromIndex(sessionId);
    this.indexDirty = true;
    return true;
  }

  /**
   * Delete image files associated with a session.
   * Should be called after deleteSession and before persist.
   */
  public async cleanupImagesForSession(sessionId: string, paths: CompassPaths): Promise<void> {
    try {
      const imagesDir = paths.imagesPath;
      if (!(await fileExists(imagesDir))) {
        return;
      }
      const entries = await fs.promises.readdir(imagesDir);
      const prefix = `${sessionId}_`;
      for (const entry of entries) {
        if (entry.startsWith(prefix)) {
          await removeFileIfExists(path.join(imagesDir, entry));
        }
      }
    } catch (err) {
      warn('Error cleaning up session images:', err);
    }
  }

  /**
   * Extract image base64 data to files and replace with path references.
   * Returns new message array with base64 removed and path added.
   */
  private async extractImagesToFiles(
    messages: ChatMessage[],
    paths: CompassPaths,
    sessionId: string
  ): Promise<ChatMessage[]> {
    const result: ChatMessage[] = [];
    for (const message of messages) {
      if (!message.images || message.images.length === 0) {
        result.push(message);
        continue;
      }
      const newImages: ChatMessage['images'] = [];
      for (let i = 0; i < message.images.length; i++) {
        const img = message.images[i];
        // Already persisted and no base64 to re-save
        if (img.path && !img.base64) {
          newImages.push({ base64: '', mimeType: img.mimeType, path: img.path });
          continue;
        }
        // No data at all, skip
        if (!img.base64) {
          newImages.push({ base64: '', mimeType: img.mimeType });
          continue;
        }
        // Has base64 data — write to file (reuse existing path for import scenario)
        const imagePath = img.path || generateImagePath(img.mimeType, sessionId, message.id, i);
        const fullPath = getImageFilePath(paths, imagePath);
        await writeBase64File(fullPath, img.base64);
        newImages.push({ base64: '', mimeType: img.mimeType, path: imagePath });
      }
      result.push({ ...message, images: newImages });
    }
    return result;
  }

  /**
   * Load images for a specific message on demand.
   * Updates the in-memory message with loaded base64 data.
   */
  public async loadMessageImages(sessionId: string, messageId: string, paths: CompassPaths): Promise<ChatMessage['images']> {
    const messages = this.sessionMessages.get(sessionId);
    if (!messages) { return undefined; }
    const message = messages.find(m => m.id === messageId);
    if (!message?.images) { return undefined; }

    const loaded = await Promise.all(
      message.images.map(async (img) => {
        if (img.base64) { return img; }
        if (img.path) {
          try {
            const fullPath = getImageFilePath(paths, img.path);
            const base64 = await readBase64File(fullPath);
            if (base64) {
              return { ...img, base64 };
            }
          } catch (err) {
            warn('Error loading image:', err);
          }
        }
        return img;
      })
    );

    // Update in-memory message with loaded images
    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex >= 0) {
      messages[msgIndex] = { ...message, images: loaded };
    }

    return loaded;
  }

  /**
   * Hydrate images by preserving paths for lazy loading.
   * Base64 data is no longer eagerly loaded to reduce startup I/O.
   */
  private async hydrateImages(
    messages: ChatMessage[],
    _paths: CompassPaths
  ): Promise<ChatMessage[]> {
    // Lazy loading: image paths are already preserved in persisted messages.
    // base64 data will be loaded on demand via loadMessageImages().
    return messages;
  }

  public clearSessionsForAssistant(assistantId: string): number {
    const targetSessionIds = [...this.sessionSummaries.values()]
      .filter((summary) => summary.assistantId === assistantId)
      .map((summary) => summary.id);

    if (targetSessionIds.length <= 0) {
      return 0;
    }

    for (const sessionId of targetSessionIds) {
      this.sessionSummaries.delete(sessionId);
      this.sessionMessages.delete(sessionId);
      this.pendingAppends.delete(sessionId);
      this.pendingRewrites.delete(sessionId);
      this.removeSessionFromIndex(sessionId);
    }

    this.indexDirty = true;
    return targetSessionIds.length;
  }

  public clearSessionsForAssistants(assistantIds: string[]): void {
    const normalizedIds = new Set(
      assistantIds.map((value) => value.trim()).filter((value) => value.length > 0)
    );
    if (!normalizedIds.size) {
      return;
    }

    const targetSessionIds = [...this.sessionSummaries.values()]
      .filter((summary) => normalizedIds.has(summary.assistantId))
      .map((summary) => summary.id);

    for (const sessionId of targetSessionIds) {
      this.sessionSummaries.delete(sessionId);
      this.sessionMessages.delete(sessionId);
      this.pendingAppends.delete(sessionId);
      this.pendingRewrites.delete(sessionId);
      this.removeSessionFromIndex(sessionId);
    }
    this.indexDirty = true;
  }

  public replaceAllSessions(sessions: ChatSessionDetail[]): void {
    this.sessionSummaries.clear();
    this.sessionMessages.clear();
    this.pendingAppends.clear();
    this.pendingRewrites.clear();
    this.searchIndex.clear();
    this.indexDirty = true;
    for (const session of sessions) {
      this.insertSession(session);
    }
  }

  public listAllSessions(): ChatSessionDetail[] {
    return [...this.sessionSummaries.values()]
      .sort((a, b) => {
        const byCreatedAt = a.createdAt - b.createdAt;
        if (byCreatedAt !== 0) {
          return byCreatedAt;
        }
        return a.id.localeCompare(b.id);
      })
      .map((summary) => this.buildDetail(summary));
  }

  public clearSessionMessages(assistantId: string, sessionId: string, updatedAt: number): boolean {
    if (!this.sessionExists(assistantId, sessionId)) {
      return false;
    }
    const messages = this.ensureSessionMessages(sessionId);
    const next = messages.filter((message) => message.role === 'system');
    this.sessionMessages.set(sessionId, next);
    this.pendingRewrites.add(sessionId);
    this.pendingAppends.delete(sessionId);
    this.reindexSession(sessionId);
    this.updateSummaryFromMessages(sessionId, updatedAt);
    return true;
  }

  public updateMessage(
    assistantId: string,
    sessionId: string,
    messageId: string,
    newContent: string,
    updatedAt: number
  ): boolean {
    if (!this.sessionExists(assistantId, sessionId)) {
      return false;
    }
    const messages = this.ensureSessionMessages(sessionId);
    const target = messages.find((message) => message.id === messageId);
    if (!target) {
      return false;
    }
    target.content = newContent;
    this.pendingRewrites.add(sessionId);
    this.pendingAppends.delete(sessionId);
    this.reindexSession(sessionId);
    this.updateSummaryFromMessages(sessionId, updatedAt);
    return true;
  }

  public importFromLegacyRows(sessionRows: Array<Record<string, unknown>>, messageRows: Array<Record<string, unknown>>): void {
    this.sessionSummaries.clear();
    this.sessionMessages.clear();
    this.pendingAppends.clear();
    this.pendingRewrites.clear();

    for (const row of sessionRows) {
      const summary = normalizeSummary(
        {
          id: toStringValue(row.id),
          assistantId: toStringValue(row.assistant_id),
          title: toStringValue(row.title),
          titleSource: toTitleSource(row.title_source),
          createdAt: toNumberValue(row.created_at, nowTs()),
          updatedAt: toNumberValue(row.updated_at, nowTs()),
          messageCount: toNumberValue(row.message_count, 0),
          preview: toStringValue(row.preview).trim() || undefined
        },
        nowTs()
      );
      if (!summary.id || !summary.assistantId) {
        continue;
      }
      this.sessionSummaries.set(summary.id, summary);
      this.sessionMessages.set(summary.id, []);
    }

    for (const row of messageRows) {
      const sessionId = toStringValue(row.session_id);
      if (!sessionId) {
        continue;
      }
      const messages = this.sessionMessages.get(sessionId) ?? [];
      messages.push(mapLegacyMessageRow(row));
      this.sessionMessages.set(sessionId, messages);
    }

    for (const [sessionId, summary] of this.sessionSummaries.entries()) {
      const messages = this.sessionMessages.get(sessionId) ?? [];
      summary.messageCount = messages.length;
      summary.preview = buildPreview(messages);
      // 标记所有迁移的会话为需要完整重写
      this.pendingRewrites.add(sessionId);
    }

    this.rebuildSearchIndex();
    this.indexDirty = true;
  }

  private buildDetail(summary: SessionSummaryInternal): ChatSessionDetail {
    const messages = this.ensureSessionMessages(summary.id).map((message) => cloneMessage(message));
    return {
      id: summary.id,
      assistantId: summary.assistantId,
      title: summary.title,
      titleSource: summary.titleSource,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      messages
    };
  }

  private ensureSessionMessages(sessionId: string): ChatMessage[] {
    const existing = this.sessionMessages.get(sessionId);
    if (existing) {
      return existing;
    }
    const created: ChatMessage[] = [];
    this.sessionMessages.set(sessionId, created);
    return created;
  }

  private updateSummaryFromMessages(sessionId: string, updatedAt: number): void {
    const summary = this.sessionSummaries.get(sessionId);
    if (!summary) {
      return;
    }
    const messages = this.ensureSessionMessages(sessionId);
    summary.updatedAt = updatedAt;
    summary.messageCount = messages.length;
    summary.preview = buildPreview(messages);
  }

  private async readSessionMessages(filePath: string): Promise<ChatMessage[]> {
    const content = await readTextFile(filePath);
    if (!content) {
      return [];
    }

    const messages: ChatMessage[] = [];
    let lineIndex = 0;
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const line of lines) {
      lineIndex++;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== 'object') {
          continue;
        }
        messages.push(normalizeMessageInput(parsed as ChatMessage, nowTs()));
      } catch (parseError) {
        console.warn(`[Compass] Skipping malformed JSONL line ${lineIndex}: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }
    }
    return messages;
  }

  private async validateSessionFile(filePath: string): Promise<CompassValidationResult> {
    if (!(await fileExists(filePath))) {
      return { valid: false, reason: `Session file is missing: ${filePath}` };
    }

    const content = await readTextFile(filePath);
    if (content === undefined) {
      return { valid: false, reason: `Session file could not be read: ${filePath}` };
    }

    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== 'object') {
          return { valid: false, reason: `Session file contains a non-object message line: ${filePath}` };
        }
      } catch (err) {
        warn('Error parsing session JSONL line:', err);
        return { valid: false, reason: `Session file contains malformed JSONL: ${filePath}` };
      }
    }

    return { valid: true };
  }
}
