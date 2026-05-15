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
import { nowTs } from '../utils';
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

function parseToolRounds(raw: unknown): ChatToolRound[] | undefined {
  if (typeof raw !== 'string' || !raw.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as ChatToolRound[];
    }
  } catch {
    // Ignore malformed tool_rounds payload.
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
  } catch {
    // Ignore malformed images payload.
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
  private readonly sessionMessages = new Map<string, ChatMessage[]>();
  /** 追踪待追加的消息（仅追加模式，不涉及编辑/删除） */
  private readonly pendingAppends = new Map<string, ChatMessage[]>();
  /** 追踪需要完整重写的会话（编辑、删除、清空等操作） */
  private readonly pendingRewrites = new Set<string>();

  public async load(paths: CompassPaths): Promise<void> {
    // 保存完整的内存状态快照（包括 summaries 和 messages）
    // 防止其他 IDE 触发 reload 时丢失本地新生成但未 persist 的会话
    const savedSummaries = new Map(this.sessionSummaries);
    const savedMessages = new Map(this.sessionMessages);
    const savedAppends = new Map(this.pendingAppends);
    const savedRewrites = new Set(this.pendingRewrites);

    this.sessionSummaries.clear();
    this.sessionMessages.clear();
    this.pendingAppends.clear();
    this.pendingRewrites.clear();

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

    // 恢复内存中独有但磁盘上不存在的数据（新生成未 persist 的会话）
    // 以及合并已存在会话的本地元数据变更（如标题重命名）
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
          await appendTextFile(sessionFilePath, content ? `${content}\n` : '');
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
    } catch {
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
    const normalizedKeyword = toStringValue(keyword);
    if (!normalizedKeyword) {
      return [];
    }
    const sessionIds: string[] = [];
    for (const summary of this.sessionSummaries.values()) {
      if (summary.assistantId !== assistantId) {
        continue;
      }
      const messages = this.sessionMessages.get(summary.id) ?? [];
      if (messages.some((message) => toStringValue(message.content).includes(normalizedKeyword))) {
        sessionIds.push(summary.id);
      }
    }
    return sessionIds;
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
    } catch {
      // Ignore cleanup errors
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
   * Hydrate images by reading base64 from files.
   */
  private async hydrateImages(
    messages: ChatMessage[],
    paths: CompassPaths
  ): Promise<ChatMessage[]> {
    const result: ChatMessage[] = [];
    for (const message of messages) {
      if (!message.images || message.images.length === 0) {
        result.push(message);
        continue;
      }
      const newImages: ChatMessage['images'] = [];
      for (const img of message.images) {
        if (img.path && !img.base64) {
          const fullPath = getImageFilePath(paths, img.path);
          const base64 = await readBase64File(fullPath);
          if (base64) {
            newImages.push({ base64, mimeType: img.mimeType, path: img.path });
          } else {
            // File missing, keep path but no base64
            newImages.push({ base64: '', mimeType: img.mimeType, path: img.path });
          }
        } else {
          newImages.push(img);
        }
      }
      result.push({ ...message, images: newImages });
    }
    return result;
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
    }

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
    }
  }

  public replaceAllSessions(sessions: ChatSessionDetail[]): void {
    this.sessionSummaries.clear();
    this.sessionMessages.clear();
    this.pendingAppends.clear();
    this.pendingRewrites.clear();
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
    }
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
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== 'object') {
          continue;
        }
        messages.push(normalizeMessageInput(parsed as ChatMessage, nowTs()));
      } catch {
        // Ignore malformed jsonl line.
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
      } catch {
        return { valid: false, reason: `Session file contains malformed JSONL: ${filePath}` };
      }
    }

    return { valid: true };
  }
}
