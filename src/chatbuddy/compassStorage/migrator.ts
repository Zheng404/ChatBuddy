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

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

import { error } from '../utils';
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
        await this.recoverFromLegacySqliteOrThrow(
          `Compass snapshot failed validation with a current migration marker: ${trustedSnapshot.reason ?? 'unknown reason'}`
        );
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
      await this.loadFromLegacySqlite(this.context.paths.legacyDbPath);
      await this.persistStores();
      await this.assertCompassSnapshot(true, 'Legacy sqlite payload could not be persisted safely');
      await this.cleanupLegacySqliteIfPresent();
      await this.writeMarker('sqlite', this.context.paths.legacyDbPath);
      return;
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
    const SQL = await this.getSqlJs();
    const data = await fs.promises.readFile(dbPath);
    const db = new SQL.Database(new Uint8Array(data));

    try {
      const sessionRows = this.queryAll(
        db,
        `SELECT id, assistant_id, title, title_source, created_at, updated_at, message_count, preview
           FROM sessions_meta
          ORDER BY created_at ASC, id ASC`
      );

      const messageRows = this.queryAll(
        db,
        `SELECT session_id, id, role, content, reasoning, model, ts, seq, tool_rounds, images
           FROM messages
          ORDER BY session_id ASC, seq ASC`
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

  private async getSqlJs(): Promise<SqlJsStatic> {
    if (!CompassMigrator.sqlJsPromise) {
      CompassMigrator.sqlJsPromise = initSqlJs({
        locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`)
      });
    }
    return CompassMigrator.sqlJsPromise;
  }
}
