export const DEFAULT_GROUP_ID = 'group_default';
export const DELETED_GROUP_ID = 'group_deleted';
const DEFAULT_GROUP_LEGACY_NAMES = new Set(['default', '默认', '默认分组']);

/** Default parameters for auto title generation. */
export const TITLE_GENERATION = {
  MAX_TOKENS: 4000,
  TEMPERATURE: 0.5,
  CONTEXT_COUNT: 4,
  TIMEOUT_MS: 30000,
  ABORT_TIMEOUT_MS: 15000,
} as const;

/** Timeout boundaries and defaults for provider requests. */
export const TIMEOUT = {
  MIN_MS: 5000,
  MAX_MS: 300000,
  DEFAULT_MS: 60000,
  CONNECTION_TEST_MS: 30000,
} as const;

export function isLegacyDefaultGroupName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.length > 0 && DEFAULT_GROUP_LEGACY_NAMES.has(normalized);
}
