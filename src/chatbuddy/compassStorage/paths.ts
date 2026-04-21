import * as path from 'path';

export const LEGACY_DB_FILE_NAME = 'chatbuddy.sqlite';
export const LEGACY_STATE_KEY = 'chatbuddy.sqlite.state.v1';
export const LEGACY_PROVIDER_API_KEYS_KEY = 'chatbuddy.sqlite.providerApiKeys.v1';

export const COMPASS_META_DIR_NAME = 'meta';
export const COMPASS_SESSIONS_DIR_NAME = 'sessions';

export const COMPASS_INDEX_FILE_NAME = 'index.compass.json';
export const COMPASS_KV_FILE_NAME = 'kv.compass.json';
export const COMPASS_MIGRATION_FILE_NAME = 'chatbuddy.migration.compass.json';
export const STRUCTURED_STATE_COMMIT_FILE_NAME = 'state.commit.json';
export const COMPASS_LAYOUT_VERSION = 3;

export const LEGACY_COMPASS_STATE_FILE_NAME = 'state.compass.json';
export const LEGACY_COMPASS_PROVIDER_API_KEYS_FILE_NAME = 'provider-api-keys.compass.json';

export const STRUCTURED_STATE_CORE_FILE_NAME = 'state.core.json';
export const STRUCTURED_UI_SELECTION_FILE_NAME = 'ui.selection.json';
export const STRUCTURED_SETTINGS_GENERAL_FILE_NAME = 'settings.general.json';
export const STRUCTURED_SETTINGS_MODEL_CONFIG_FILE_NAME = 'settings.model-config.json';
export const STRUCTURED_SETTINGS_DEFAULT_MODELS_FILE_NAME = 'settings.default-models.json';
export const STRUCTURED_SETTINGS_MCP_FILE_NAME = 'settings.mcp.json';
export const STRUCTURED_PROVIDER_API_KEYS_FILE_NAME = 'providers.api-keys.json';

export type CompassPaths = {
  globalStoragePath: string;
  legacyDbPath: string;
  rootPath: string;
  metaPath: string;
  sessionsPath: string;
  indexPath: string;
  kvPath: string;
  migrationPath: string;
  structuredStateCommitPath: string;
  legacyStatePath: string;
  legacyProviderApiKeysPath: string;
  stateCorePath: string;
  uiSelectionPath: string;
  settingsGeneralPath: string;
  settingsModelConfigPath: string;
  settingsDefaultModelsPath: string;
  settingsMcpPath: string;
  providerApiKeysPath: string;
};

export function createCompassPaths(globalStoragePath: string): CompassPaths {
  const rootPath = globalStoragePath;
  const metaPath = path.join(rootPath, COMPASS_META_DIR_NAME);
  const sessionsPath = path.join(rootPath, COMPASS_SESSIONS_DIR_NAME);
  return {
    globalStoragePath,
    legacyDbPath: path.join(globalStoragePath, LEGACY_DB_FILE_NAME),
    rootPath,
    metaPath,
    sessionsPath,
    indexPath: path.join(sessionsPath, COMPASS_INDEX_FILE_NAME),
    kvPath: path.join(metaPath, COMPASS_KV_FILE_NAME),
    migrationPath: path.join(metaPath, COMPASS_MIGRATION_FILE_NAME),
    structuredStateCommitPath: path.join(metaPath, STRUCTURED_STATE_COMMIT_FILE_NAME),
    legacyStatePath: path.join(metaPath, LEGACY_COMPASS_STATE_FILE_NAME),
    legacyProviderApiKeysPath: path.join(metaPath, LEGACY_COMPASS_PROVIDER_API_KEYS_FILE_NAME),
    stateCorePath: path.join(metaPath, STRUCTURED_STATE_CORE_FILE_NAME),
    uiSelectionPath: path.join(metaPath, STRUCTURED_UI_SELECTION_FILE_NAME),
    settingsGeneralPath: path.join(metaPath, STRUCTURED_SETTINGS_GENERAL_FILE_NAME),
    settingsModelConfigPath: path.join(metaPath, STRUCTURED_SETTINGS_MODEL_CONFIG_FILE_NAME),
    settingsDefaultModelsPath: path.join(metaPath, STRUCTURED_SETTINGS_DEFAULT_MODELS_FILE_NAME),
    settingsMcpPath: path.join(metaPath, STRUCTURED_SETTINGS_MCP_FILE_NAME),
    providerApiKeysPath: path.join(metaPath, STRUCTURED_PROVIDER_API_KEYS_FILE_NAME)
  };
}

export function getSessionFilePath(paths: CompassPaths, assistantId: string, sessionId: string): string {
  return path.join(paths.sessionsPath, assistantId, `${sessionId}.jsonl`);
}
