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
import { LRUCache, nowTs, warn, error } from '../utils';
import {
  appendTextFile,
  ensureDir,
  fileExists,
  listFilesRecursively,
  readBase64File,
  readJsonFileSafe,
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

/**
 * 原子追加的字节阈值。超过此阈值的追加写入会降级为全量重写，
 * 避免多 IDE 并发追加时 JSONL 行交错损坏会话文件。
 *
 * POSIX 保证不超过 PIPE_BUF 字节的写入在管道/常规文件上是原子的。
 * macOS 的 PIPE_BUF 为 512 字节，Linux 为 4096 字节。运行时按平台取值，
 * 确保 macOS 多 IDE 共享存储场景下的安全性。
 */
const ATOMIC_APPEND_THRESHOLD = process.platform === 'darwin' ? 512 : 4096;

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
  /**
   * 已检测到损坏 JSONL 行的会话文件路径集合。
   *
   * `readSessionMessages` 发现无法解析的行时会将文件路径加入此集合，
   * `validateSnapshot` 会据此返回校验失败，让 migrator/用户感知数据损坏。
   * 损坏行的原始内容会被保留到 `{filePath}.corrupt` sidecar 文件以便人工恢复。
   */
  private readonly corruptedSessionFiles = new Set<string>();

  public async load(paths: CompassPaths): Promise<void> {
    // 修复竞态窗口：先异步读取磁盘数据到临时结构，磁盘数据就绪后再操作内存。
    //
    // 原实现先 clear() 内存再 await 磁盘读取，在两者之间的异步窗口内，对已存在会话的
    // 写操作（appendMessage / updateLastAssistantMessage / renameSession / deleteMessage 等）
    // 会因 sessionExists() 返回 false 而失败，导致数据丢失。
    //
    // 新实现将所有异步 I/O 前置到 clear 之前。由于 JavaScript 单线程模型，clear 之后到
    // rebuildSearchIndex 之间是同步原子执行的（无 await），不会有任何并发写操作插入。
    // load 期间（await 磁盘读取时）的所有写操作会正常工作，结果在后续快照中被完整捕获。
    const diskSummaries = new Map<string, SessionSummaryInternal>();
    const diskMessages = new Map<string, ChatMessage[]>();

    // index 文件损坏（JSON 解析失败）时降级为空 index，保持 load() 继续工作。
    // migrator 的 validateSnapshot 会独立检测 index 损坏并触发恢复流程。
    // readJsonFileSafe 会在损坏时记录 error 日志，避免静默降级。
    const indexPayload = await readJsonFileSafe<CompassIndexFile>(paths.indexPath);
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
      diskSummaries.set(summary.id, summary);
      diskMessages.set(summary.id, hydratedMessages);
    }

    // 磁盘数据就绪后，保存完整的内存状态快照（包括 summaries 和 messages）。
    // 此刻内存中包含 load 前的数据 + load 期间（await 磁盘读取时）的所有写操作结果。
    // 防止其他 IDE 触发 reload 时丢失本地新生成但未 persist 的会话。
    const savedSummaries = new Map(this.sessionSummaries);
    const savedMessages = new Map(this.sessionMessages.entries());
    const savedAppends = new Map(this.pendingAppends);
    const savedRewrites = new Set(this.pendingRewrites);

    // 以下 clear + fill + merge 全部同步执行，不会有并发写操作插入
    this.sessionSummaries.clear();
    this.sessionMessages.clear();
    this.pendingAppends.clear();
    this.pendingRewrites.clear();
    this.indexDirty = false;

    // 用磁盘数据填充内存
    for (const [sessionId, summary] of diskSummaries) {
      this.sessionSummaries.set(sessionId, summary);
      this.sessionMessages.set(sessionId, diskMessages.get(sessionId) ?? []);
    }

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

        // 当会话因本地元数据更新被标记为 pendingRewrites 时，appendMessage 不会写入
        // pendingAppends，导致本地新增的消息可能不在 pendingAppends 中。
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
          // 共享存储模式下，追加超过 PIPE_BUF（macOS 512 / Linux 4096 字节）的内容不保证原子性。
          // 降级为全量重写，避免多 IDE 并发追加导致 JSONL 行交错。
          if (Buffer.byteLength(content, 'utf-8') > ATOMIC_APPEND_THRESHOLD) {
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
    // readJsonFileSafe 在损坏时降级为 undefined 并记录 error 日志（避免静默吞错）
    const diskIndex = await readJsonFileSafe<CompassIndexFile>(paths.indexPath);
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

    // 额外保障：即使 validateSessionFile 漏检，load() 期间发现的损坏行
    //（记录在 corruptedSessionFiles 中）也应让快照校验失败。
    // 损坏行的原始内容已保留到 {file}.corrupt sidecar 文件，用户可人工恢复。
    if (this.corruptedSessionFiles.size > 0) {
      const fileList = [...this.corruptedSessionFiles].sort().join(', ');
      return {
        valid: false,
        reason: `Session files contain malformed JSONL lines (corrupt sidecar files written for recovery): ${fileList}`
      };
    }

    return { valid: true };
  }

  /**
   * 扫描磁盘上未被索引引用的孤儿会话文件（`sessions/{assistantId}/{sessionId}.jsonl`），
   * 尝试解析其中的消息并重新加入 `sessionSummaries`。
   *
   * 用于 migrator 自修复场景：当索引与磁盘会话文件出现不一致（如其他 IDE 写入会话
   * 但索引尚未同步，或索引损坏丢失部分条目）时，优先保留磁盘上的真实数据，再让
   * `persist()` 重建索引，避免触发 `persist()` 的孤儿清理路径直接删除这些文件。
   *
   * - 路径层级不符合 `sessions/{assistantId}/{sessionId}.jsonl` 的文件会被忽略
   * - 已知 sessionId 跳过（即使 assistantId 不同，避免重复 adoption 造成歧义）
   * - 消息全部解析失败的孤儿文件被跳过（保留在磁盘上，留待人工处理）
   * - 返回成功恢复的会话数量
   */
  public async adoptOrphanSessionFiles(paths: CompassPaths): Promise<number> {
    let sessionFiles: string[] = [];
    try {
      sessionFiles = await listFilesRecursively(paths.sessionsPath, '.jsonl');
    } catch (err) {
      warn('Error listing session files for orphan adoption:', err);
      return 0;
    }

    let adopted = 0;
    for (const sessionFilePath of sessionFiles) {
      const relativePath = path.relative(paths.sessionsPath, sessionFilePath);
      // 期望相对路径形如 `{assistantId}/{sessionId}.jsonl`
      const parts = relativePath.split(path.sep);
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        continue;
      }
      const assistantId = parts[0];
      const fileName = parts[1];
      if (!fileName.endsWith('.jsonl')) {
        continue;
      }
      const sessionId = fileName.slice(0, -'.jsonl'.length);
      if (!sessionId) {
        continue;
      }

      // 已在索引中（或本轮已 adopt）的会话，跳过避免重复
      if (this.sessionSummaries.has(sessionId)) {
        continue;
      }

      const messages = await this.readSessionMessages(sessionFilePath);
      if (messages.length === 0) {
        // 无法解析出任何有效消息，保留磁盘文件但暂不 adoption
        warn(`Skipping orphan session file with no valid messages: ${sessionFilePath}`);
        continue;
      }

      const firstTs = messages[0]?.timestamp ?? nowTs();
      const lastTs = messages[messages.length - 1]?.timestamp ?? firstTs;
      const summary: SessionSummaryInternal = {
        id: sessionId,
        assistantId,
        // 标题丢失，让 UI 通过 titleSource='default' 走默认逻辑（取首条用户消息）
        title: '',
        titleSource: 'default',
        createdAt: firstTs,
        updatedAt: lastTs,
        messageCount: messages.length,
        preview: buildPreview(messages)
      };
      this.sessionSummaries.set(sessionId, summary);
      this.sessionMessages.set(sessionId, messages);
      for (const message of messages) {
        this.indexMessage(sessionId, message);
      }
      // 标记为完整重写，确保 persist 阶段重新写出文件并纳入 expectedSessionFiles
      this.pendingRewrites.add(sessionId);
      this.indexDirty = true;
      adopted += 1;
    }
    return adopted;
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
    // 导入新数据后，旧的损坏标记不再适用（新会话集合可能完全不同）
    this.corruptedSessionFiles.clear();
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
    /** 收集本次加载发现的损坏行，用于写入 sidecar 恢复文件 */
    const corruptedLines: Array<{ lineIndex: number; line: string; error: string }> = [];
    let lineIndex = 0;
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const line of lines) {
      lineIndex++;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== 'object') {
          // 非对象行视为损坏（JSON 合法但结构错误），同样需要恢复
          throw new Error(`Line ${lineIndex} parsed to a non-object value`);
        }
        messages.push(normalizeMessageInput(parsed as ChatMessage, nowTs()));
      } catch (parseError) {
        const reason = parseError instanceof Error ? parseError.message : String(parseError);
        // 截断原始行内容，避免单行过长导致日志爆炸（保留前 200 字符用于诊断）
        const linePreview = line.length > 200 ? `${line.slice(0, 200)}…(+${line.length - 200} chars)` : line;
        // 升级为 error 级别日志（含完整上下文：文件路径、行号、原始行预览、错误信息）
        error(
          `[Compass] Malformed JSONL line in session file: ${filePath}\n` +
            `  line ${lineIndex}: ${reason}\n` +
            `  content preview: ${linePreview}`
        );
        corruptedLines.push({ lineIndex, line, error: reason });
      }
    }

    // 发现损坏行：保留原始内容到 sidecar 文件以便人工恢复，并标记文件需要校验失败
    if (corruptedLines.length > 0) {
      this.corruptedSessionFiles.add(filePath);
      await this.persistCorruptedLines(filePath, corruptedLines).catch((writeErr) => {
        // sidecar 写入失败不应影响主加载流程，但仍需记录以便诊断
        error(`[Compass] Failed to write corrupt-line sidecar for ${filePath}:`, writeErr);
      });
    } else {
      // 文件已恢复正常（如人工修复后），清理标记
      this.corruptedSessionFiles.delete(filePath);
    }
    return messages;
  }

  /**
   * 将损坏的 JSONL 行写入 sidecar 文件 `{filePath}.corrupt`，便于人工恢复。
   *
   * 每行格式为 JSON 对象：`{lineIndex, line, error, discoveredAt}`。
   * 采用覆盖模式，反映「最近一次加载时发现的损坏行」，避免重复加载导致无限增长。
   */
  private async persistCorruptedLines(
    filePath: string,
    corruptedLines: Array<{ lineIndex: number; line: string; error: string }>
  ): Promise<void> {
    const sidecarPath = `${filePath}.corrupt`;
    const discoveredAt = new Date().toISOString();
    const payload = corruptedLines.map((entry) => ({
      lineIndex: entry.lineIndex,
      line: entry.line,
      error: entry.error,
      discoveredAt
    }));
    await writeJsonAtomic(sidecarPath, payload);
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
