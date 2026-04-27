/**
 * 存储适配器模块。
 *
 * `ChatStorage` 是 `StatePersistenceService` 与底层 Compass 存储之间的桥梁，
 * 负责初始化存储目录、协调 CompassMigrator 迁移、以及提供状态/会话/密钥的读写接口。
 * 同时保留对旧版 VS Code `globalState` 的兼容层。
 */
import * as fs from 'fs';
import * as path from 'path';

import { ChatMessage, ChatSessionDetail, ChatSessionSummary, PersistedStateLite } from './types';
import { error } from './utils';
import {
  CompassKvStore,
  CompassMigrator,
  CompassSessionStore,
  CompassSettingsStore,
  createCompassPaths,
  type CompassPaths
} from './compassStorage';
import { ensureDir, fileExists, moveDirectoryContents, removeEmptyDirectoriesRecursively } from './compassStorage/io';
import { COMPASS_META_DIR_NAME, COMPASS_SESSIONS_DIR_NAME } from './compassStorage/paths';

export const COMPASS_STATE_STORE_KEY = 'chatbuddy.state.compass';
export const COMPASS_PROVIDER_API_KEYS_STORE_KEY = 'chatbuddy.providerApiKeys.compass';

export class ChatStorage {
  private paths: CompassPaths | undefined;
  private readonly sessionStore = new CompassSessionStore();
  private readonly kvStore = new CompassKvStore();
  private readonly settingsStore = new CompassSettingsStore();
  private persistQueue: Promise<void> = Promise.resolve();

  public async initialize(globalStoragePath: string): Promise<void> {
    this.paths = createCompassPaths(globalStoragePath);
    const paths = this.requirePaths();

    await this.migrateLegacyRootLayout(paths);
    await ensureDir(paths.metaPath);
    await ensureDir(paths.sessionsPath);
    await ensureDir(paths.imagesPath);

    await this.sessionStore.load(paths);
    await this.kvStore.load(paths);
    await this.settingsStore.load(paths);

    const migrator = new CompassMigrator({
      paths,
      sessionStore: this.sessionStore,
      kvStore: this.kvStore,
      settingsStore: this.settingsStore
    });
    await migrator.migrateIfNeeded();
  }

  public hasAnySession(): boolean {
    return this.sessionStore.hasAnySession();
  }

  public countSessions(): number {
    return this.sessionStore.countSessions();
  }

  public listSessionsByAssistant(assistantId: string): ChatSessionSummary[] {
    return this.sessionStore.listSessionsByAssistant(assistantId);
  }

  public searchSessionIdsByContent(assistantId: string, keyword: string): string[] {
    return this.sessionStore.searchSessionIdsByContent(assistantId, keyword);
  }

  public getSessionSummary(assistantId: string, sessionId: string): ChatSessionSummary | undefined {
    return this.sessionStore.getSessionSummary(assistantId, sessionId);
  }

  public getLatestSessionSummary(assistantId: string): ChatSessionSummary | undefined {
    return this.sessionStore.getLatestSessionSummary(assistantId);
  }

  public getSessionDetailById(sessionId: string): ChatSessionDetail | undefined {
    return this.sessionStore.getSessionDetailById(sessionId);
  }

  public getSessionDetail(assistantId: string, sessionId: string): ChatSessionDetail | undefined {
    return this.sessionStore.getSessionDetail(assistantId, sessionId);
  }

  public sessionExists(assistantId: string, sessionId: string): boolean {
    return this.sessionStore.sessionExists(assistantId, sessionId);
  }

  public insertSession(session: ChatSessionDetail, persist = true): void {
    this.sessionStore.insertSession(session);
    if (persist) {
      this.schedulePersist();
    }
  }

  public renameSession(
    assistantId: string,
    sessionId: string,
    title: string,
    titleSource: ChatSessionDetail['titleSource'],
    updatedAt: number
  ): boolean {
    const changed = this.sessionStore.renameSession(assistantId, sessionId, title, titleSource, updatedAt);
    if (changed) {
      this.schedulePersist();
    }
    return changed;
  }

  public appendMessage(
    assistantId: string,
    sessionId: string,
    message: ChatMessage,
    updatedAt: number,
    persist = true
  ): boolean {
    const changed = this.sessionStore.appendMessage(assistantId, sessionId, message, updatedAt);
    if (changed && persist) {
      this.schedulePersist();
    }
    return changed;
  }

  public updateLastAssistantMessage(
    assistantId: string,
    sessionId: string,
    updater: (current: ChatMessage | undefined) => ChatMessage,
    updatedAt: number,
    persist = true
  ): boolean {
    const changed = this.sessionStore.updateLastAssistantMessage(assistantId, sessionId, updater, updatedAt);
    if (changed && persist) {
      this.schedulePersist();
    }
    return changed;
  }

  public truncateMessages(
    assistantId: string,
    sessionId: string,
    keepCount: number,
    updatedAt: number,
    persist = true
  ): boolean {
    const changed = this.sessionStore.truncateMessages(assistantId, sessionId, keepCount, updatedAt);
    if (changed && persist) {
      this.schedulePersist();
    }
    return changed;
  }

  public truncateMessagesAfter(
    assistantId: string,
    sessionId: string,
    messageId: string,
    updatedAt: number,
    persist = true
  ): boolean {
    const changed = this.sessionStore.truncateMessagesAfter(assistantId, sessionId, messageId, updatedAt);
    if (changed && persist) {
      this.schedulePersist();
    }
    return changed;
  }

  public deleteMessage(
    assistantId: string,
    sessionId: string,
    messageId: string,
    updatedAt: number,
    persist = true
  ): boolean {
    const changed = this.sessionStore.deleteMessage(assistantId, sessionId, messageId, updatedAt);
    if (changed && persist) {
      this.schedulePersist();
    }
    return changed;
  }

  public async deleteSession(assistantId: string, sessionId: string, persist = true): Promise<boolean> {
    const paths = this.paths;
    const changed = this.sessionStore.deleteSession(assistantId, sessionId);
    if (changed && paths) {
      await this.sessionStore.cleanupImagesForSession(sessionId, paths);
    }
    if (changed && persist) {
      this.schedulePersist();
    }
    return changed;
  }

  public async clearSessionsForAssistant(assistantId: string, persist = true): Promise<number> {
    const paths = this.paths;
    const sessionIds = this.sessionStore.listSessionsByAssistant(assistantId).map(s => s.id);
    const removed = this.sessionStore.clearSessionsForAssistant(assistantId);
    if (removed > 0 && paths) {
      for (const sessionId of sessionIds) {
        await this.sessionStore.cleanupImagesForSession(sessionId, paths);
      }
    }
    if (removed > 0 && persist) {
      this.schedulePersist();
    }
    return removed;
  }

  public clearSessionsForAssistants(assistantIds: string[], persist = true): void {
    const paths = this.paths;
    const sessionIds: string[] = [];
    if (paths) {
      for (const assistantId of assistantIds) {
        const sessions = this.sessionStore.listSessionsByAssistant(assistantId);
        for (const session of sessions) {
          sessionIds.push(session.id);
        }
      }
    }
    this.sessionStore.clearSessionsForAssistants(assistantIds);
    if (paths) {
      for (const sessionId of sessionIds) {
        void this.sessionStore.cleanupImagesForSession(sessionId, paths);
      }
    }
    if (persist) {
      this.schedulePersist();
    }
  }

  public replaceAllSessions(sessions: ChatSessionDetail[], persist = true): void {
    this.sessionStore.replaceAllSessions(sessions);
    if (persist) {
      this.schedulePersist();
    }
  }

  public listAllSessions(): ChatSessionDetail[] {
    return this.sessionStore.listAllSessions();
  }

  public listAllKv(): Record<string, string> {
    return this.kvStore.listAll();
  }

  public getKv(key: string): string | undefined {
    const compatValue = this.settingsStore.getKvCompat(
      key,
      COMPASS_STATE_STORE_KEY,
      COMPASS_PROVIDER_API_KEYS_STORE_KEY
    );
    if (key === COMPASS_STATE_STORE_KEY || key === COMPASS_PROVIDER_API_KEYS_STORE_KEY) {
      return compatValue;
    }
    return this.kvStore.get(key);
  }

  public setKv(key: string, value: string, persist = true): void {
    const handledBySettingsStore = this.settingsStore.setKvCompat(
      key,
      value,
      COMPASS_STATE_STORE_KEY,
      COMPASS_PROVIDER_API_KEYS_STORE_KEY
    );
    if (!handledBySettingsStore) {
      this.kvStore.set(key, value);
    }
    if (persist) {
      this.schedulePersist();
    }
  }

  public replaceAllKv(entries: Record<string, string>, persist = true): void {
    const filteredEntries = Object.fromEntries(
      Object.entries(entries).filter(
        ([key]) => key !== COMPASS_STATE_STORE_KEY && key !== COMPASS_PROVIDER_API_KEYS_STORE_KEY
      )
    );
    this.kvStore.replaceAll(filteredEntries);
    if (persist) {
      this.schedulePersist();
    }
  }

  public readStateLite(): PersistedStateLite | Record<string, unknown> | undefined {
    return this.settingsStore.readStateLite();
  }

  public writeStateLite(state: PersistedStateLite, persist = true): void {
    this.settingsStore.writeStateLite(state);
    if (persist) {
      this.schedulePersist();
    }
  }

  public readProviderApiKeys(): Record<string, string> {
    return this.settingsStore.getProviderApiKeys();
  }

  public writeProviderApiKeys(providerApiKeys: Record<string, string>, persist = true): void {
    this.settingsStore.setProviderApiKeys(providerApiKeys);
    if (persist) {
      this.schedulePersist();
    }
  }

  public async flush(): Promise<void> {
    await this.enqueuePersist();
  }

  public async close(): Promise<void> {
    await this.flush();
  }

  public clearSessionMessages(assistantId: string, sessionId: string, updatedAt: number, persist = true): boolean {
    try {
      const changed = this.sessionStore.clearSessionMessages(assistantId, sessionId, updatedAt);
      if (changed && persist) {
        this.schedulePersist();
      }
      return changed;
    } catch (e) {
      error('Failed to clear session messages:', e);
      return false;
    }
  }

  public updateMessage(
    assistantId: string,
    sessionId: string,
    messageId: string,
    newContent: string,
    updatedAt: number,
    persist = true
  ): boolean {
    try {
      const changed = this.sessionStore.updateMessage(assistantId, sessionId, messageId, newContent, updatedAt);
      if (changed && persist) {
        this.schedulePersist();
      }
      return changed;
    } catch (e) {
      error('Failed to update message:', e);
      return false;
    }
  }

  private schedulePersist(): void {
    void this.enqueuePersist();
  }

  private async migrateLegacyRootLayout(paths: CompassPaths): Promise<void> {
    const legacyRootPath = await this.findLegacyNestedRootPath(paths);
    if (!legacyRootPath) {
      return;
    }

    await moveDirectoryContents(legacyRootPath, paths.rootPath);
    await removeEmptyDirectoriesRecursively(legacyRootPath);

    const oldRootStillExists = await fileExists(legacyRootPath);
    if (oldRootStillExists) {
      error(`Legacy storage root still contains files after migration: ${legacyRootPath}`);
    }
  }

  private async findLegacyNestedRootPath(paths: CompassPaths): Promise<string | undefined> {
    if ((await fileExists(paths.metaPath)) || (await fileExists(paths.sessionsPath))) {
      return undefined;
    }

    let rootEntries: fs.Dirent[];
    try {
      rootEntries = await fs.promises.readdir(paths.rootPath, { withFileTypes: true });
    } catch (readError) {
      if ((readError as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return undefined;
      }
      throw readError;
    }

    const candidates: string[] = [];
    for (const entry of rootEntries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidatePath = path.join(paths.rootPath, entry.name);
      if (await this.isLegacyNestedRootCandidate(candidatePath)) {
        candidates.push(candidatePath);
      }
    }

    if (candidates.length > 1) {
      error(`Multiple legacy storage roots detected, skipping automatic migration: ${candidates.join(', ')}`);
      return undefined;
    }
    return candidates[0];
  }

  private async isLegacyNestedRootCandidate(candidatePath: string): Promise<boolean> {
    return (
      (await fileExists(path.join(candidatePath, COMPASS_META_DIR_NAME))) ||
      (await fileExists(path.join(candidatePath, COMPASS_SESSIONS_DIR_NAME)))
    );
  }

  private async enqueuePersist(): Promise<void> {
    const paths = this.requirePaths();
    const persistTask = async () => {
      await ensureDir(paths.metaPath);
      await ensureDir(paths.sessionsPath);
      await this.sessionStore.persist(paths);
      await this.kvStore.persist(paths);
      await this.settingsStore.persist(paths);
    };

    this.persistQueue = this.persistQueue.then(persistTask, persistTask);
    this.persistQueue = this.persistQueue.catch((err) => {
      error('ChatStorage persist error:', err);
    });
    await this.persistQueue;
  }

  private requirePaths(): CompassPaths {
    if (!this.paths) {
      throw new Error('ChatStorage is not initialized');
    }
    return this.paths;
  }
}
