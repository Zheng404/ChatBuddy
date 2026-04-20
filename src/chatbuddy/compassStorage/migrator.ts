import * as fs from 'fs';

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

import { fileExists, readJsonFile, writeJsonAtomic } from './io';
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
    if (marker?.name === 'compass' && (marker.layoutVersion ?? 1) >= COMPASS_LAYOUT_VERSION) {
      return;
    }

    if (this.context.settingsStore.hasStructuredState()) {
      await this.writeMarker('existing-structured');
      return;
    }

    const convertedLegacyPayload = this.context.settingsStore.migrateLegacyPayloadToStructured();
    if (convertedLegacyPayload) {
      await this.persistStores();
      await this.writeMarker('existing-compass');
      return;
    }

    if (await fileExists(this.context.paths.legacyDbPath)) {
      await this.loadFromLegacySqlite(this.context.paths.legacyDbPath);
      await this.persistStores();
      await this.writeMarker('sqlite', this.context.paths.legacyDbPath);
      return;
    }

    if (this.context.sessionStore.hasData() || this.context.kvStore.hasData() || this.context.settingsStore.hasAnyData()) {
      await this.persistStores();
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
      this.context.settingsStore.setLegacyStatePayload(undefined);
      this.context.settingsStore.setLegacyProviderApiKeysPayload(undefined);

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
