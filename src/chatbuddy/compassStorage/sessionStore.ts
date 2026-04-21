import { ChatMessage, ChatSessionDetail, ChatSessionSummary, ChatToolRound } from '../types';
import { nowTs } from '../utils';
import {
  ensureDir,
  fileExists,
  listFilesRecursively,
  readJsonFile,
  readTextFile,
  removeEmptyDirectoriesRecursively,
  removeFileIfExists,
  writeJsonAtomic,
  writeTextAtomic
} from './io';
import { CompassPaths, getSessionFilePath } from './paths';
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

  public async load(paths: CompassPaths): Promise<void> {
    this.sessionSummaries.clear();
    this.sessionMessages.clear();

    const indexPayload = await readJsonFile<CompassIndexFile>(paths.indexPath);
    const sessions = Array.isArray(indexPayload?.sessions) ? indexPayload.sessions : [];

    for (const rawSummary of sessions) {
      const summary = normalizeSummary(rawSummary, nowTs());
      if (!summary.id || !summary.assistantId) {
        continue;
      }
      const sessionFilePath = getSessionFilePath(paths, summary.assistantId, summary.id);
      const messages = await this.readSessionMessages(sessionFilePath);
      summary.messageCount = messages.length;
      summary.preview = buildPreview(messages);
      this.sessionSummaries.set(summary.id, summary);
      this.sessionMessages.set(summary.id, messages);
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
    await writeJsonAtomic(paths.indexPath, indexPayload);

    const expectedSessionFiles = new Set<string>();
    for (const summary of indexPayload.sessions) {
      const sessionFilePath = getSessionFilePath(paths, summary.assistantId, summary.id);
      expectedSessionFiles.add(sessionFilePath);
      const messages = (this.sessionMessages.get(summary.id) ?? []).map((message) =>
        normalizeMessageInput(message, nowTs())
      );
      const content = messages.map((message) => JSON.stringify(message)).join('\n');
      await writeTextAtomic(sessionFilePath, content ? `${content}\n` : '');
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
    return true;
  }

  public appendMessage(assistantId: string, sessionId: string, message: ChatMessage, updatedAt: number): boolean {
    if (!this.sessionExists(assistantId, sessionId)) {
      return false;
    }
    const messages = this.ensureSessionMessages(sessionId);
    messages.push(normalizeMessageInput(cloneMessage(message), nowTs()));
    this.updateSummaryFromMessages(sessionId, updatedAt);
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
    this.updateSummaryFromMessages(sessionId, updatedAt);
    return true;
  }

  public deleteSession(assistantId: string, sessionId: string): boolean {
    if (!this.sessionExists(assistantId, sessionId)) {
      return false;
    }
    this.sessionSummaries.delete(sessionId);
    this.sessionMessages.delete(sessionId);
    return true;
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
    }
  }

  public replaceAllSessions(sessions: ChatSessionDetail[]): void {
    this.sessionSummaries.clear();
    this.sessionMessages.clear();
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
    this.updateSummaryFromMessages(sessionId, updatedAt);
    return true;
  }

  public importFromLegacyRows(sessionRows: Array<Record<string, unknown>>, messageRows: Array<Record<string, unknown>>): void {
    this.sessionSummaries.clear();
    this.sessionMessages.clear();

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
