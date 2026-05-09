export const DEFAULT_GROUP_ID = 'group_default';
export const DELETED_GROUP_ID = 'group_deleted';
const DEFAULT_GROUP_LEGACY_NAMES = new Set(['default', '默认', '默认分组']);

/** Default parameters for auto title generation. */
export const TITLE_GENERATION = {
  MAX_TOKENS: 4000,
  TEMPERATURE: 0.5,
  CONTEXT_COUNT: 4,
  RECENT_MESSAGES: 6,
  TIMEOUT_MS: 30000,
  ABORT_TIMEOUT_MS: 15000,
} as const;

/** Timeout boundaries and defaults for provider requests. */
export const TIMEOUT = {
  MIN_MS: 5000,
  MAX_MS: 300000,
  DEFAULT_MS: 300000,
  CONNECTION_TEST_MS: 30000,
} as const;

/** Provider request limits and defaults. */
export const PROVIDER_LIMITS = {
  /** Maximum tokens allowed across all providers (16-bit unsigned integer). */
  MAX_TOKENS: 65535,
  /** Default number of context messages to include. */
  DEFAULT_CONTEXT_COUNT: 16,
  /** Fallback model ID for connection testing. */
  DEFAULT_TEST_MODEL: 'gpt-4o-mini',
  /** Per-provider-kind fallback models for connection testing. */
  DEFAULT_TEST_MODELS_BY_KIND: {
    openai: 'gpt-4o-mini',
    gemini: 'gemini-2.0-flash',
    openrouter: 'openai/gpt-4o-mini',
    ollama: 'llama3',
    custom: 'gpt-4o-mini',
  } as Record<string, string>,
  /** Maximum length of error response preview in characters. */
  ERROR_RESPONSE_TRUNCATE_LENGTH: 500,
} as const;

/** MCP tool calling constraints. */
export const MCP_LIMITS = {
  /** Maximum allowed tool rounds per request. */
  MAX_TOOL_ROUNDS: 20,
} as const;

/** Local backup defaults and constraints. */
export const LOCAL_BACKUP = {
  DEFAULT_INTERVAL_HOURS: 24,
  DEFAULT_MAX_COUNT: 10,
  DEFAULT_MAX_AGE_DAYS: 30,
  MIN_INTERVAL_HOURS: 1,
} as const;

export function isLegacyDefaultGroupName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.length > 0 && DEFAULT_GROUP_LEGACY_NAMES.has(normalized);
}
