import * as fs from 'fs';
import * as path from 'path';

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

import { ChatMessage, ChatSessionDetail, ChatSessionSummary, ChatToolRound } from './types';
import { error, nowTs } from './utils';

const DB_FILE_NAME = 'chatbuddy.sqlite';
const SCHEMA_VERSION = 2;
const PREVIEW_MAX_LENGTH = 240;

type SessionTitleSource = ChatSessionDetail['titleSource'];
type ChatRole = ChatMessage['role'];
type SqlParam = string | number | null | Uint8Array;

function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toNumberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toRoleValue(value: unknown): ChatRole {
  if (value === 'user' || value === 'assistant' || value === 'system') {
    return value;
  }
  return 'assistant';
}

function toTitleSource(value: unknown): SessionTitleSource {
  if (value === 'default' || value === 'generated' || value === 'custom') {
    return value;
  }
  return 'default';
}

function buildPreview(messages: ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = toStringValue(messages[index].content).trim();
    if (!content) {
      continue;
    }
    return content.slice(0, PREVIEW_MAX_LENGTH);
  }
  return undefined;
}

function mapMessageRow(row: Record<string, unknown>): ChatMessage {
  const content = toStringValue(row.content);
  const reasoning = toStringValue(row.reasoning).trim();
  const model = toStringValue(row.model).trim();
  const toolRoundsRaw = toStringValue(row.tool_rounds).trim();
  let toolRounds: ChatToolRound[] | undefined;
  if (toolRoundsRaw) {
    try {
      const parsed = JSON.parse(toolRoundsRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        toolRounds = parsed;
      }
    } catch {
      // Ignore malformed tool_rounds data.
    }
  }
  return {
    id: toStringValue(row.id),
    role: toRoleValue(row.role),
    content,
    timestamp: toNumberValue(row.ts, nowTs()),
    model: model ? model : undefined,
    reasoning: reasoning ? reasoning : undefined,
    toolRounds
  };
}

export class ChatStorage {
  private static sqlJsPromise: Promise<SqlJsStatic> | undefined;

  private db: Database | undefined;
  private dbPath = '';
  private persistQueue: Promise<void> = Promise.resolve();

  public async initialize(globalStoragePath: string): Promise<void> {
    await fs.promises.mkdir(globalStoragePath, { recursive: true });
    this.dbPath = path.join(globalStoragePath, DB_FILE_NAME);

    const SQL = await this.getSqlJs();
    const data = await this.tryReadDatabaseFile(this.dbPath);
    this.db = data ? new SQL.Database(data) : new SQL.Database();
    this.applySchema();
    this.setKv('schemaVersion', String(SCHEMA_VERSION), false);
    await this.flush();
  }

  public hasAnySession(): boolean {
    return this.countSessions() > 0;
  }

  public countSessions(): number {
    const row = this.queryOne('SELECT COUNT(1) AS value FROM sessions_meta');
    return toNumberValue(row?.value, 0);
  }

  public listSessionsByAssistant(assistantId: string): ChatSessionSummary[] {
    const rows = this.queryAll(
      `SELECT id, assistant_id, title, title_source, created_at, updated_at, message_count, preview
         FROM sessions_meta
        WHERE assistant_id = ?
        ORDER BY updated_at DESC`,
      [assistantId]
    );
    return rows.map((row) => this.mapSummaryRow(row));
  }

  public getSessionSummary(assistantId: string, sessionId: string): ChatSessionSummary | undefined {
    const row = this.queryOne(
      `SELECT id, assistant_id, title, title_source, created_at, updated_at, message_count, preview
         FROM sessions_meta
        WHERE assistant_id = ? AND id = ?`,
      [assistantId, sessionId]
    );
    return row ? this.mapSummaryRow(row) : undefined;
  }

  public getLatestSessionSummary(assistantId: string): ChatSessionSummary | undefined {
    const row = this.queryOne(
      `SELECT id, assistant_id, title, title_source, created_at, updated_at, message_count, preview
         FROM sessions_meta
        WHERE assistant_id = ?
        ORDER BY updated_at DESC
        LIMIT 1`,
      [assistantId]
    );
    return row ? this.mapSummaryRow(row) : undefined;
  }

  public getSessionDetailById(sessionId: string): ChatSessionDetail | undefined {
    const meta = this.queryOne(
      `SELECT id, assistant_id, title, title_source, created_at, updated_at
         FROM sessions_meta
        WHERE id = ?`,
      [sessionId]
    );
    if (!meta) {
      return undefined;
    }
    return this.buildDetailFromMeta(meta);
  }

  public getSessionDetail(assistantId: string, sessionId: string): ChatSessionDetail | undefined {
    const meta = this.queryOne(
      `SELECT id, assistant_id, title, title_source, created_at, updated_at
         FROM sessions_meta
        WHERE assistant_id = ? AND id = ?`,
      [assistantId, sessionId]
    );
    if (!meta) {
      return undefined;
    }
    return this.buildDetailFromMeta(meta);
  }

  public sessionExists(assistantId: string, sessionId: string): boolean {
    return !!this.queryOne(
      `SELECT 1 AS ok
         FROM sessions_meta
        WHERE assistant_id = ? AND id = ?
        LIMIT 1`,
      [assistantId, sessionId]
    );
  }

  public insertSession(session: ChatSessionDetail, persist = true): void {
    this.runInTransaction(() => {
      this.upsertSessionMeta(session, session.messages.length, buildPreview(session.messages));
      this.deleteSessionMessagesInternal(session.id);
      this.insertMessagesInternal(session.id, session.messages);
    });
    if (persist) {
      this.schedulePersist();
    }
  }

  public renameSession(assistantId: string, sessionId: string, title: string, titleSource: SessionTitleSource, updatedAt: number): boolean {
    const db = this.ensureDb();
    db.run(
      `UPDATE sessions_meta
          SET title = ?, title_source = ?, updated_at = ?
        WHERE assistant_id = ? AND id = ?`,
      [title, titleSource, updatedAt, assistantId, sessionId]
    );
    if (db.getRowsModified() <= 0) {
      return false;
    }
    this.schedulePersist();
    return true;
  }

  public appendMessage(assistantId: string, sessionId: string, message: ChatMessage, updatedAt: number, persist = true): boolean {
    if (!this.sessionExists(assistantId, sessionId)) {
      return false;
    }
    const nextSeq = this.getNextSeq(sessionId);
    const messageCount = nextSeq + 1;
    const db = this.ensureDb();
    db.run(
      `INSERT INTO messages(id, session_id, role, content, reasoning, model, ts, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        sessionId,
        message.role,
        message.content,
        message.reasoning ?? null,
        message.model ?? null,
        message.timestamp,
        nextSeq
      ]
    );
    const messageContent = toStringValue(message.content).trim();
    const preview = messageContent ? messageContent.slice(0, PREVIEW_MAX_LENGTH) : undefined;
    db.run(
      `UPDATE sessions_meta
          SET updated_at = ?, message_count = ?, preview = ?
        WHERE id = ?`,
      [updatedAt, messageCount, preview ?? null, sessionId]
    );
    if (persist) {
      this.schedulePersist();
    }
    return true;
  }

  public updateLastAssistantMessage(
    assistantId: string,
    sessionId: string,
    updater: (current: ChatMessage | undefined) => ChatMessage,
    updatedAt: number,
    persist = true
  ): boolean {
    if (!this.sessionExists(assistantId, sessionId)) {
      return false;
    }

    // Lightweight: only fetch message_count for fallbackCount computation
    const metaRow = this.queryOne(
      `SELECT message_count FROM sessions_meta WHERE id = ?`,
      [sessionId]
    );
    const existingCount = toNumberValue(metaRow?.message_count, 0);

    const target = this.queryOne(
      `SELECT id, role, content, reasoning, model, ts, seq, tool_rounds
         FROM messages
        WHERE session_id = ? AND role = 'assistant'
        ORDER BY seq DESC
        LIMIT 1`,
      [sessionId]
    );
    const current = target ? mapMessageRow(target) : undefined;
    const next = updater(current);

    const db = this.ensureDb();
    if (target) {
      db.run(
        `UPDATE messages
            SET id = ?, role = ?, content = ?, reasoning = ?, model = ?, ts = ?, tool_rounds = ?
          WHERE session_id = ? AND seq = ?`,
        [
          next.id,
          next.role,
          next.content,
          next.reasoning ?? null,
          next.model ?? null,
          next.timestamp,
          next.toolRounds ? JSON.stringify(next.toolRounds) : null,
          sessionId,
          toNumberValue(target.seq)
        ]
      );
    } else {
      const nextSeq = this.getNextSeq(sessionId);
      db.run(
        `INSERT INTO messages(id, session_id, role, content, reasoning, model, ts, seq, tool_rounds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [next.id, sessionId, next.role, next.content, next.reasoning ?? null, next.model ?? null, next.timestamp, nextSeq, next.toolRounds ? JSON.stringify(next.toolRounds) : null]
      );
    }

    // Pass fallbackCount so updateSessionMetaFromMessages can skip the COUNT query
    this.updateSessionMetaFromMessages(sessionId, updatedAt, existingCount + (target ? 0 : 1));
    if (persist) {
      this.schedulePersist();
    }
    return true;
  }

  public truncateMessages(assistantId: string, sessionId: string, keepCount: number, updatedAt: number, persist = true): boolean {
    if (!Number.isFinite(keepCount) || keepCount < 0) {
      return false;
    }
    if (!this.sessionExists(assistantId, sessionId)) {
      return false;
    }
    const normalizedKeepCount = Math.floor(keepCount);
    const db = this.ensureDb();
    db.run(
      `DELETE FROM messages
        WHERE session_id = ? AND seq >= ?`,
      [sessionId, normalizedKeepCount]
    );
    this.updateSessionMetaFromMessages(sessionId, updatedAt);
    if (persist) {
      this.schedulePersist();
    }
    return true;
  }

  public deleteMessage(assistantId: string, sessionId: string, messageId: string, updatedAt: number, persist = true): boolean {
    if (!this.sessionExists(assistantId, sessionId)) {
      return false;
    }
    const target = this.queryOne(
      `SELECT seq
         FROM messages
        WHERE session_id = ? AND id = ?
        LIMIT 1`,
      [sessionId, messageId]
    );
    if (!target) {
      return false;
    }
    const seq = toNumberValue(target.seq, -1);
    if (seq < 0) {
      return false;
    }

    const db = this.ensureDb();
    this.runInTransaction(() => {
      db.run(
        `DELETE FROM messages
          WHERE session_id = ? AND id = ?`,
        [sessionId, messageId]
      );
      db.run(
        `UPDATE messages
            SET seq = seq - 1
          WHERE session_id = ? AND seq > ?`,
        [sessionId, seq]
      );
      this.updateSessionMetaFromMessages(sessionId, updatedAt);
    });

    if (persist) {
      this.schedulePersist();
    }
    return true;
  }

  public deleteSession(assistantId: string, sessionId: string, persist = true): boolean {
    if (!this.sessionExists(assistantId, sessionId)) {
      return false;
    }
    this.runInTransaction(() => {
      const db = this.ensureDb();
      db.run('DELETE FROM messages WHERE session_id = ?', [sessionId]);
      db.run('DELETE FROM sessions_meta WHERE assistant_id = ? AND id = ?', [assistantId, sessionId]);
    });
    if (persist) {
      this.schedulePersist();
    }
    return true;
  }

  public clearSessionsForAssistant(assistantId: string, persist = true): number {
    const before = this.listSessionsByAssistant(assistantId).length;
    if (before <= 0) {
      return 0;
    }
    this.runInTransaction(() => {
      const db = this.ensureDb();
      db.run('DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions_meta WHERE assistant_id = ?)', [assistantId]);
      db.run('DELETE FROM sessions_meta WHERE assistant_id = ?', [assistantId]);
    });
    if (persist) {
      this.schedulePersist();
    }
    return before;
  }

  public clearSessionsForAssistants(assistantIds: string[], persist = true): void {
    const normalizedIds = assistantIds.map((value) => value.trim()).filter((value) => value.length > 0);
    if (!normalizedIds.length) {
      return;
    }
    this.runInTransaction(() => {
      const db = this.ensureDb();
      const placeholders = normalizedIds.map(() => '?').join(',');
      db.run(
        `DELETE FROM messages
          WHERE session_id IN (
            SELECT id
              FROM sessions_meta
             WHERE assistant_id IN (${placeholders})
          )`,
        normalizedIds
      );
      db.run(`DELETE FROM sessions_meta WHERE assistant_id IN (${placeholders})`, normalizedIds);
    });
    if (persist) {
      this.schedulePersist();
    }
  }

  public replaceAllSessions(sessions: ChatSessionDetail[], persist = true): void {
    this.runInTransaction(() => {
      const db = this.ensureDb();
      db.run('DELETE FROM messages');
      db.run('DELETE FROM sessions_meta');
      for (const session of sessions) {
        this.upsertSessionMeta(session, session.messages.length, buildPreview(session.messages));
        this.insertMessagesInternal(session.id, session.messages);
      }
    });
    if (persist) {
      this.schedulePersist();
    }
  }

  public listAllSessions(): ChatSessionDetail[] {
    const rows = this.queryAll(
      `SELECT id, assistant_id, title, title_source, created_at, updated_at
         FROM sessions_meta
        ORDER BY created_at ASC, id ASC`
    );
    return rows.map((row) => this.buildDetailFromMeta(row));
  }

  public getKv(key: string): string | undefined {
    const row = this.queryOne('SELECT value FROM kv WHERE key = ?', [key]);
    const value = row ? toStringValue(row.value) : '';
    return value ? value : undefined;
  }

  public setKv(key: string, value: string, persist = true): void {
    const db = this.ensureDb();
    db.run(
      `INSERT INTO kv(key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value]
    );
    if (persist) {
      this.schedulePersist();
    }
  }

  public async flush(): Promise<void> {
    await this.enqueuePersist();
  }

  public async close(): Promise<void> {
    await this.flush();
    const db = this.db;
    this.db = undefined;
    db?.close();
  }

  private async getSqlJs(): Promise<SqlJsStatic> {
    if (!ChatStorage.sqlJsPromise) {
      ChatStorage.sqlJsPromise = initSqlJs({
        locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`)
      });
    }
    return ChatStorage.sqlJsPromise;
  }

  private async tryReadDatabaseFile(filePath: string): Promise<Uint8Array | undefined> {
    try {
      const content = await fs.promises.readFile(filePath);
      return new Uint8Array(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  private ensureDb(): Database {
    if (!this.db) {
      throw new Error('ChatStorage is not initialized');
    }
    return this.db;
  }

  private applySchema(): void {
    const db = this.ensureDb();
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions_meta (
        id TEXT PRIMARY KEY,
        assistant_id TEXT NOT NULL,
        title TEXT NOT NULL,
        title_source TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        preview TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        reasoning TEXT,
        model TEXT,
        ts INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        PRIMARY KEY (session_id, seq)
      );
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id, id);
      CREATE INDEX IF NOT EXISTS idx_sessions_assistant_updated ON sessions_meta(assistant_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, seq);
    `);

    // Schema migration: add tool_rounds column
    const currentVersion = Number(this.getKv('schemaVersion')) || 1;
    if (currentVersion < 2) {
      try {
        db.run(`ALTER TABLE messages ADD COLUMN tool_rounds TEXT`);
      } catch {
        // Column may already exist from a previous attempt.
      }
    }
  }

  private mapSummaryRow(row: Record<string, unknown>): ChatSessionSummary {
    const preview = toStringValue(row.preview).trim();
    return {
      id: toStringValue(row.id),
      assistantId: toStringValue(row.assistant_id),
      title: toStringValue(row.title),
      titleSource: toTitleSource(row.title_source),
      createdAt: toNumberValue(row.created_at, nowTs()),
      updatedAt: toNumberValue(row.updated_at, nowTs()),
      messageCount: toNumberValue(row.message_count, 0),
      preview: preview ? preview : undefined
    };
  }

  private buildDetailFromMeta(meta: Record<string, unknown>): ChatSessionDetail {
    const sessionId = toStringValue(meta.id);
    const messages = this.queryAll(
      `SELECT id, role, content, reasoning, model, ts, tool_rounds
         FROM messages
        WHERE session_id = ?
        ORDER BY seq ASC`,
      [sessionId]
    ).map((row) => mapMessageRow(row));

    return {
      id: sessionId,
      assistantId: toStringValue(meta.assistant_id),
      title: toStringValue(meta.title),
      titleSource: toTitleSource(meta.title_source),
      createdAt: toNumberValue(meta.created_at, nowTs()),
      updatedAt: toNumberValue(meta.updated_at, nowTs()),
      messages
    };
  }

  private upsertSessionMeta(session: ChatSessionDetail, messageCount: number, preview?: string): void {
    const db = this.ensureDb();
    db.run(
      `INSERT INTO sessions_meta(id, assistant_id, title, title_source, created_at, updated_at, message_count, preview)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         assistant_id = excluded.assistant_id,
         title = excluded.title,
         title_source = excluded.title_source,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         message_count = excluded.message_count,
         preview = excluded.preview`,
      [
        session.id,
        session.assistantId,
        session.title,
        session.titleSource,
        session.createdAt,
        session.updatedAt,
        messageCount,
        preview ?? null
      ]
    );
  }

  private insertMessagesInternal(sessionId: string, messages: ChatMessage[]): void {
    if (!messages.length) {
      return;
    }
    const db = this.ensureDb();
    const stmt = db.prepare(
      `INSERT INTO messages(id, session_id, role, content, reasoning, model, ts, seq, tool_rounds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    try {
      for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        stmt.run([
          message.id,
          sessionId,
          message.role,
          message.content,
          message.reasoning ?? null,
          message.model ?? null,
          message.timestamp,
          index,
          message.toolRounds ? JSON.stringify(message.toolRounds) : null
        ]);
      }
    } finally {
      stmt.free();
    }
  }

  private deleteSessionMessagesInternal(sessionId: string): void {
    const db = this.ensureDb();
    db.run('DELETE FROM messages WHERE session_id = ?', [sessionId]);
  }

  public clearSessionMessages(assistantId: string, sessionId: string, updatedAt: number, persist = true): boolean {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assistantId kept for API consistency
    const db = this.ensureDb();
    try {
      this.runInTransaction(() => {
        db.run('DELETE FROM messages WHERE session_id = ? AND role <> ?', [sessionId, 'system']);
        this.updateSessionMetaFromMessages(sessionId, updatedAt);
      });
      if (persist) {
        this.schedulePersist();
      }
      return true;
    } catch (e) {
      error('Failed to clear session messages:', e);
      return false;
    }
  }

  public updateMessage(assistantId: string, sessionId: string, messageId: string, newContent: string, updatedAt: number, persist = true): boolean {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      UPDATE messages
      SET content = ?
      WHERE id = ? AND session_id = ?
    `);
    try {
      stmt.run([newContent, messageId, sessionId]);
      this.updateSessionMetaFromMessages(sessionId, updatedAt);
      if (persist) {
        this.schedulePersist();
      }
      return true;
    } catch (e) {
      error('Failed to update message:', e);
      return false;
    } finally {
      stmt.free();
    }
  }

  private getNextSeq(sessionId: string): number {
    const row = this.queryOne(
      `SELECT COALESCE(MAX(seq), -1) + 1 AS value
         FROM messages
        WHERE session_id = ?`,
      [sessionId]
    );
    return toNumberValue(row?.value, 0);
  }

  private updateSessionMetaFromMessages(sessionId: string, updatedAt: number, fallbackCount?: number): void {
    // Single query: get count, max seq, and latest message content in one pass
    const stats = this.queryOne(
      `SELECT COUNT(1) AS count,
              MAX(seq) AS max_seq,
              (SELECT content FROM messages m2
                 WHERE m2.session_id = messages.session_id
                 ORDER BY m2.seq DESC LIMIT 1) AS latest_content
         FROM messages
        WHERE session_id = ?`,
      [sessionId]
    );
    const count = toNumberValue(stats?.count, fallbackCount ?? 0);
    let preview: string | undefined;
    if (count > 0) {
      const content = toStringValue(stats?.latest_content).trim();
      preview = content ? content.slice(0, PREVIEW_MAX_LENGTH) : undefined;
    }
    const db = this.ensureDb();
    db.run(
      `UPDATE sessions_meta
          SET updated_at = ?, message_count = ?, preview = ?
        WHERE id = ?`,
      [updatedAt, count, preview ?? null, sessionId]
    );
  }

  private runInTransaction(task: () => void): void {
    const db = this.ensureDb();
    db.run('BEGIN TRANSACTION');
    try {
      task();
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
  }

  private queryAll(sql: string, params: SqlParam[] = []): Array<Record<string, unknown>> {
    const db = this.ensureDb();
    const stmt = db.prepare(sql, params);
    const rows: Array<Record<string, unknown>> = [];
    try {
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as Record<string, unknown>);
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  private queryOne(sql: string, params: SqlParam[] = []): Record<string, unknown> | undefined {
    const rows = this.queryAll(sql, params);
    return rows.length > 0 ? rows[0] : undefined;
  }

  private schedulePersist(): void {
    void this.enqueuePersist();
  }

  private async enqueuePersist(): Promise<void> {
    const persistTask = async () => {
      const db = this.ensureDb();
      const binary = db.export();
      await fs.promises.writeFile(this.dbPath, Buffer.from(binary));
    };
    this.persistQueue = this.persistQueue.then(persistTask, persistTask);
    this.persistQueue = this.persistQueue.catch((err) => {
      error('ChatStorage persist error:', err);
    });
    await this.persistQueue;
  }
}
