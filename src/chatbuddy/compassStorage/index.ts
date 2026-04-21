/**
 * Compass 结构化存储公共 API 聚合模块。
 *
 * 统一导出 Compass 存储的所有公共类型、类和函数，
 * 供 `ChatStateRepository` 和 `StatePersistenceService` 消费。
 */
export { CompassKvStore } from './kvStore';
export { CompassMigrator, type CompassMigratorContext } from './migrator';
export {
  COMPASS_LAYOUT_VERSION,
  COMPASS_META_DIR_NAME,
  COMPASS_SESSIONS_DIR_NAME,
  LEGACY_PROVIDER_API_KEYS_KEY,
  LEGACY_STATE_KEY,
  STRUCTURED_STATE_COMMIT_FILE_NAME,
  createCompassPaths,
  type CompassPaths
} from './paths';
export { CompassSessionStore } from './sessionStore';
export {
  CompassSettingsStore,
  persistedStateLiteToStructuredStateDocument,
  structuredStateDocumentToPersistedStateLite
} from './settingsStore';
export type { StructuredStateCommitFile, StructuredStateDocument } from './types';
