export const DEFAULT_GROUP_ID = 'group_default';
export const DELETED_GROUP_ID = 'group_deleted';
const DEFAULT_GROUP_LEGACY_NAMES = new Set(['default', '默认', '默认分组']);

export function isLegacyDefaultGroupName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.length > 0 && DEFAULT_GROUP_LEGACY_NAMES.has(normalized);
}
