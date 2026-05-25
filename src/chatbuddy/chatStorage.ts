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
import { ensureDir, fileExists, getFileHash, moveDirectoryContents, readJsonFile, removeEmptyDirectoriesRecursively } from './compassStorage/io';
import { COMPASS_META_DIR_NAME, COMPASS_SESSIONS_DIR_NAME } from './compassStorage/paths';
import { SyncWatcher } from './syncWatcher';

export const COMPASS_STATE_STORE_KEY = 'chatbuddy.state.compass';
export const COMPASS_PROVIDER_API_KEYS_STORE_KEY = 'chatbuddy.providerApiKeys.compass';

export class ChatStorage {
  private paths: CompassPaths | undefined;
  private readonly sessionStore = new CompassSessionStore();
  private readonly kvStore = new CompassKvStore();
  private readonly settingsStore = new CompassSettingsStore();
  private persistQueue: Promise<void> = Promise.resolve();
  private syncWatcher: SyncWatcher | undefined;

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

  public async clearSessionsForAssistants(assistantIds: string[], persist = true): Promise<void> {
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
        await this.sessionStore.cleanupImagesForSession(sessionId, paths);
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

  public async cleanupAllImages(): Promise<void> {
    const paths = this.paths;
    if (!paths) {
      return;
    }
    try {
      const imagesDir = paths.imagesPath;
      const entries = await fs.promises.readdir(imagesDir).catch(() => [] as string[]);
      for (const entry of entries) {
        await fs.promises.unlink(path.join(imagesDir, entry)).catch(() => {});
      }
    } catch {
      // Ignore cleanup errors during reset.
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

  /**
   * 从磁盘重新读取 API keys 文件，不影响当前内存状态。
   * 用于跨 IDE reload/persist 时获取其他 IDE 写入的新 keys。
   */
  public async readProviderApiKeysFromDisk(): Promise<Record<string, string>> {
    const paths = this.paths;
    if (!paths) {
      return {};
    }
    // 仅读取 API keys 文件，避免加载全部 10 个结构化文件
    const raw = await readJsonFile(paths.providerApiKeysPath) as Record<string, string> | undefined;
    if (!raw || typeof raw !== 'object') {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' && key.trim()) {
        result[key.trim()] = value;
      }
    }
    return result;
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

  /** 设置 SyncWatcher 引用，用于写入自写标记 */
  public setSyncWatcher(syncWatcher: SyncWatcher): void {
    this.syncWatcher = syncWatcher;
  }

  /** 获取当前存储根路径 */
  public getStorageRootPath(): string | undefined {
    return this.paths?.rootPath;
  }

  /** 获取 state.core.json 的绝对路径（用于跨 IDE mtime 乐观锁） */
  public getStateCorePath(): string | undefined {
    return this.paths?.stateCorePath;
  }

  /** 获取 CompassPaths（用于外部读取磁盘全量状态） */
  public getPaths(): CompassPaths | undefined {
    return this.paths;
  }

  /**
   * 从磁盘重新加载所有状态文件到一个新的临时 CompassSettingsStore，
   * 返回完整的 PersistedStateLite 和 state.core.json 的 mtime。
   * 不影响当前内存中的 settingsStore。
   * 用于跨 IDE persist 时写前合并。
   */
  public async readFullDiskState(): Promise<{ state: PersistedStateLite | undefined; contentHash: string }> {
    const paths = this.paths;
    if (!paths) {
      return { state: undefined, contentHash: '' };
    }
    // 使用 state.core.json 的内容哈希作为乐观锁（比 mtime 精度更高）
    const contentHash = await getFileHash(paths.stateCorePath);
    if (!contentHash) {
      return { state: undefined, contentHash: '' };
    }
    // 创建临时 store 从磁盘加载所有文件
    const tempStore = new CompassSettingsStore();
    await tempStore.load(paths);
    const state = tempStore.readStateLite();
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return { state: undefined, contentHash };
    }
    return { state: state as PersistedStateLite, contentHash };
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

      // 【重要】先写自写标记，再写数据文件。
      // 确保另一个 IDE 在检测到数据变更时能正确读到本 IDE 的标记。
      // 如果标记在数据之后写入，另一个 IDE 可能在窗口期读到旧标记而误判为自写。
      if (this.syncWatcher) {
        await this.syncWatcher.writeSelfWriteMarker([]);
      }

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

  /** 从磁盘重新加载数据到内存缓存（用于跨 IDE 同步刷新） */
  public async reload(): Promise<void> {
    const paths = this.requirePaths();
    await this.settingsStore.load(paths);
    await this.sessionStore.load(paths);
    await this.kvStore.load(paths);
  }

  /** 按类别增量重新加载数据 */
  public async reloadCategories(categories: ReadonlySet<'core' | 'settings' | 'sessions' | 'images'>): Promise<void> {
    const paths = this.requirePaths();
    const needsSettings = categories.has('core') || categories.has('settings');
    const needsSessions = categories.has('sessions') || categories.has('images');

    if (needsSettings) {
      await this.settingsStore.load(paths);
      // KV 存储与 settings 关联（如 MCP 探测缓存等），一并重新加载
      await this.kvStore.load(paths);
    }
    if (needsSessions) {
      await this.sessionStore.load(paths);
    }
  }

  private requirePaths(): CompassPaths {
    if (!this.paths) {
      throw new Error('ChatStorage is not initialized');
    }
    return this.paths;
  }
}
