/**
 * Compass 存储迁移器模块。
 *
 * 负责检测存储格式版本、执行从旧版 SQLite 和旧版 Compass 到当前结构化格式的
 * 自动迁移，并在启动时验证数据完整性。
 *
 * 迁移策略：
 * 1. 检查迁移标记，确认是否需要迁移
 * 2. 验证当前快照完整性
 * 3. 如无效，尝试从 SQLite 恢复
 * 4. 执行必要的格式转换
 * 5. 写入新的迁移标记
 */
import * as fs from 'fs';
import * as path from 'path';

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

import { error, warn } from '../utils';
import { fileExists, readJsonFile, removeFileIfExists, writeJsonAtomic } from './io';
import {
  COMPASS_LAYOUT_VERSION,
  LEGACY_PROVIDER_API_KEYS_KEY,
  LEGACY_STATE_KEY,
  CompassPaths
} from './paths';
import { CompassKvStore } from './kvStore';
import { CompassSessionStore } from './sessionStore';
import { CompassSettingsStore } from './settingsStore';
import { CompassMigrationRecord, toStringValue } from './types';

type SqlParam = string | number | null | Uint8Array;
export const SQLITE_MIGRATION_DEPRECATION_START_VERSION = '0.3.0';
export const SQLITE_MIGRATION_SUPPORT_REMOVAL_VERSION = '0.5.0';

type CompassSnapshotValidationResult = {
  valid: boolean;
  reason?: string;
  settingsMode: 'empty' | 'legacy' | 'structured';
};

export type CompassMigratorContext = {
  paths: CompassPaths;
  sessionStore: CompassSessionStore;
  kvStore: CompassKvStore;
  settingsStore: CompassSettingsStore;
};

export class CompassMigrator {
  private static sqlJsPromise: Promise<SqlJsStatic> | undefined;

  constructor(private readonly context: CompassMigratorContext) {}

  public async migrateIfNeeded(): Promise<void> {
    const marker = await readJsonFile<CompassMigrationRecord>(this.context.paths.migrationPath);
    const hasCurrentMarker = marker?.name === 'compass' && (marker.layoutVersion ?? 1) >= COMPASS_LAYOUT_VERSION;

    if (hasCurrentMarker) {
      const trustedSnapshot = await this.validateCompassSnapshot(true);
      if (!trustedSnapshot.valid) {
        const reason = `Compass snapshot failed validation with a current migration marker: ${trustedSnapshot.reason ?? 'unknown reason'}`;
        // 先尝试自修复（容忍缺失文件，重建索引），再回退 SQLite
        if (await this.trySelfHealCompassSnapshot(reason)) {
          await this.cleanupLegacySqliteIfPresent();
          return;
        }
        await this.recoverFromLegacySqliteOrThrow(reason);
        return;
      }
      await this.cleanupLegacySqliteIfPresent();
      return;
    }

    const relaxedSnapshot = await this.validateCompassSnapshot(false);
    if (!relaxedSnapshot.valid) {
      await this.recoverFromLegacySqliteOrThrow(
        `Compass snapshot failed validation: ${relaxedSnapshot.reason ?? 'unknown reason'}`
      );
      return;
    }

    if (relaxedSnapshot.settingsMode === 'structured') {
      await this.persistStores();
      await this.assertCompassSnapshot(
        true,
        'Existing structured compass snapshot could not be validated after writing the commit marker'
      );
      await this.cleanupLegacySqliteIfPresent();
      await this.writeMarker('existing-structured');
      return;
    }

    const convertedLegacyPayload = this.context.settingsStore.migrateLegacyPayloadToStructured();
    if (convertedLegacyPayload) {
      await this.persistStores();
      await this.assertCompassSnapshot(true, 'Legacy compass payload could not be persisted safely');
      await this.cleanupLegacySqliteIfPresent();
      await this.writeMarker('existing-compass');
      return;
    }

    if (await fileExists(this.context.paths.legacyDbPath)) {
      try {
        await this.loadFromLegacySqlite(this.context.paths.legacyDbPath);
        await this.persistStores();
        await this.assertCompassSnapshot(true, 'Legacy sqlite payload could not be persisted safely');
        await this.cleanupLegacySqliteIfPresent();
        await this.writeMarker('sqlite', this.context.paths.legacyDbPath);
        return;
      } catch (e) {
        error(`Legacy sqlite migration failed at ${this.context.paths.legacyDbPath}:`, e);
        throw new Error(
          `Failed to migrate legacy sqlite data: ${e instanceof Error ? e.message : String(e)}. ` +
          `Your original sqlite file has been preserved.`
        );
      }
    }

    if (this.context.sessionStore.hasData() || this.context.kvStore.hasData() || this.context.settingsStore.hasAnyData()) {
      await this.persistStores();
      await this.assertCompassSnapshot(true, 'Existing compass snapshot could not be validated safely');
      await this.cleanupLegacySqliteIfPresent();
      await this.writeMarker('existing-compass');
      return;
    }

    await this.writeMarker('fresh');
  }

  private async writeMarker(source: CompassMigrationRecord['source'], legacyPath?: string): Promise<void> {
    const payload: CompassMigrationRecord = {
      name: 'compass',
      layoutVersion: COMPASS_LAYOUT_VERSION,
      source,
      migratedAt: new Date().toISOString(),
      legacyPath
    };
    await writeJsonAtomic(this.context.paths.migrationPath, payload);
  }

  private async persistStores(): Promise<void> {
    await this.context.sessionStore.persist(this.context.paths);
    await this.context.kvStore.persist(this.context.paths);
    await this.context.settingsStore.persist(this.context.paths);
  }

  private async cleanupLegacySqliteIfPresent(): Promise<void> {
    if (!(await fileExists(this.context.paths.legacyDbPath))) {
      return;
    }
    await removeFileIfExists(this.context.paths.legacyDbPath);
  }

  private static readonly SESSION_HEALABLE_PATTERNS = [
    'Session file is missing',
    'Found orphan session file'
  ];

  /**
   * 当已有 Compass 迁移标记但快照验证失败时，尝试自修复。
   * 仅限会话文件缺失/孤儿等非致命不一致场景。
   * Settings/KV 损坏等严重问题不在此处理，仍走 SQLite 恢复或抛出异常。
   */
  private async trySelfHealCompassSnapshot(reason: string): Promise<boolean> {
    const healable = CompassMigrator.SESSION_HEALABLE_PATTERNS.some(p => reason.includes(p));
    if (!healable) {
      return false;
    }
    error(`Compass snapshot validation failed (${reason}). Attempting session self-heal...`);
    try {
      await this.context.sessionStore.load(this.context.paths);
      await this.context.kvStore.load(this.context.paths);
      await this.context.settingsStore.load(this.context.paths);
      await this.persistStores();
      const snapshot = await this.validateCompassSnapshot(true);
      if (snapshot.valid) {
        error('Compass session self-heal succeeded.');
        return true;
      }
      error(`Compass self-heal failed: snapshot still invalid after repair (${snapshot.reason ?? 'unknown reason'}).`);
      return false;
    } catch (e) {
      error(`Compass self-heal failed with exception: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  private async recoverFromLegacySqliteOrThrow(reason: string): Promise<void> {
    if (!(await fileExists(this.context.paths.legacyDbPath))) {
      error(reason);
      throw new Error(reason);
    }

    error(`${reason}. Falling back to legacy sqlite at ${this.context.paths.legacyDbPath}`);
    await this.loadFromLegacySqlite(this.context.paths.legacyDbPath);
    await this.persistStores();
    await this.assertCompassSnapshot(true, 'Legacy sqlite recovery produced an invalid compass snapshot');
    await this.cleanupLegacySqliteIfPresent();
    await this.writeMarker('sqlite', this.context.paths.legacyDbPath);
  }

  private async validateCompassSnapshot(
    requireStructuredCommit: boolean
  ): Promise<CompassSnapshotValidationResult> {
    const [sessionSnapshot, kvSnapshot, settingsSnapshot] = await Promise.all([
      this.context.sessionStore.validateSnapshot(this.context.paths),
      this.context.kvStore.validateSnapshot(this.context.paths),
      this.context.settingsStore.validateSnapshot(this.context.paths, requireStructuredCommit)
    ]);

    if (!settingsSnapshot.valid) {
      return {
        valid: false,
        reason: settingsSnapshot.reason,
        settingsMode: settingsSnapshot.mode
      };
    }
    if (!sessionSnapshot.valid) {
      return {
        valid: false,
        reason: sessionSnapshot.reason,
        settingsMode: settingsSnapshot.mode
      };
    }
    if (!kvSnapshot.valid) {
      return {
        valid: false,
        reason: kvSnapshot.reason,
        settingsMode: settingsSnapshot.mode
      };
    }

    return {
      valid: true,
      settingsMode: settingsSnapshot.mode
    };
  }

  private async assertCompassSnapshot(requireStructuredCommit: boolean, message: string): Promise<void> {
    const snapshot = await this.validateCompassSnapshot(requireStructuredCommit);
    if (snapshot.valid) {
      return;
    }

    const fullMessage = `${message}: ${snapshot.reason ?? 'unknown reason'}`;
    error(fullMessage);
    throw new Error(fullMessage);
  }

  private async loadFromLegacySqlite(dbPath: string): Promise<void> {
    let SQL: SqlJsStatic;
    try {
      SQL = await this.getSqlJs();
    } catch (e) {
      error('Failed to initialize sql.js for legacy migration:', e);
      throw new Error(`Cannot initialize sql.js: ${e instanceof Error ? e.message : String(e)}`);
    }

    let db: Database;
    try {
      const data = await fs.promises.readFile(dbPath);
      db = new SQL.Database(new Uint8Array(data));
    } catch (e) {
      error(`Failed to read legacy sqlite database at ${dbPath}:`, e);
      throw new Error(`Cannot read legacy sqlite database: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const tables = this.queryAll(
        db,
        "SELECT name FROM sqlite_master WHERE type='table'"
      );
      const tableNames = new Set(tables.map((t) => String(t.name ?? '')));
      const requiredTables = ['sessions_meta', 'messages', 'kv'];
      const missingTables = requiredTables.filter((t) => !tableNames.has(t));
      if (missingTables.length > 0) {
        throw new Error(
          `Legacy sqlite database is missing required tables: ${missingTables.join(', ')}. ` +
          `Found tables: ${Array.from(tableNames).join(', ') || '(none)'}`
        );
      }

      const sessionColumns = this.getTableColumns(db, 'sessions_meta');
      const sessionSelectColumns = ['id', 'assistant_id', 'title', 'created_at', 'updated_at', 'message_count']
        .concat(sessionColumns.includes('title_source') ? ['title_source'] : [])
        .concat(sessionColumns.includes('preview') ? ['preview'] : [])
        .join(', ');
      const sessionRows = this.queryAll(
        db,
        `SELECT ${sessionSelectColumns} FROM sessions_meta ORDER BY created_at ASC, id ASC`
      );

      const messageColumns = this.getTableColumns(db, 'messages');
      const messageSelectColumns = ['session_id', 'id', 'role', 'content', 'ts', 'seq']
        .concat(messageColumns.includes('model') ? ['model'] : [])
        .concat(messageColumns.includes('reasoning') ? ['reasoning'] : [])
        .concat(messageColumns.includes('tool_rounds') ? ['tool_rounds'] : [])
        .concat(messageColumns.includes('images') ? ['images'] : [])
        .join(', ');
      const messageRows = this.queryAll(
        db,
        `SELECT ${messageSelectColumns} FROM messages ORDER BY session_id ASC, seq ASC`
      );

      const kvRows = this.queryAll(db, 'SELECT key, value FROM kv');

      this.context.sessionStore.importFromLegacyRows(sessionRows, messageRows);
      this.context.kvStore.clear();
      this.context.settingsStore.clearAllData();

      for (const row of kvRows) {
        const key = toStringValue(row.key).trim();
        if (!key) {
          continue;
        }
        const value = toStringValue(row.value);
        if (key === LEGACY_STATE_KEY) {
          this.context.settingsStore.setLegacyStatePayload(value);
          continue;
        }
        if (key === LEGACY_PROVIDER_API_KEYS_KEY) {
          this.context.settingsStore.setLegacyProviderApiKeysPayload(value);
          continue;
        }
        if (key !== 'schemaVersion') {
          this.context.kvStore.set(key, value);
        }
      }

      this.context.settingsStore.migrateLegacyPayloadToStructured();
    } finally {
      db.close();
    }
  }

  private queryAll(db: Database, sql: string, params: SqlParam[] = []): Array<Record<string, unknown>> {
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

  private getTableColumns(db: Database, tableName: string): string[] {
    const rows = this.queryAll(db, `PRAGMA table_info(${tableName})`);
    return rows.map((row) => String(row.name ?? ''));
  }

  private async getSqlJs(): Promise<SqlJsStatic> {
    if (!CompassMigrator.sqlJsPromise) {
      CompassMigrator.sqlJsPromise = initSqlJs({
        locateFile: (file: string) => {
          try {
            return require.resolve(`sql.js/dist/${file}`);
          } catch (err) {
            warn('Error resolving sql.js file:', err);
            return path.join(__dirname, '../../../node_modules/sql.js/dist', file);
          }
        }
      });
    }
    return CompassMigrator.sqlJsPromise;
  }
}
