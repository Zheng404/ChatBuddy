/**
 * 共享状态合并工具函数。
 *
 * 提供 `mergeById`、`getItemTimestamp` 和 `mergeLocalBackup`，
 * 供 stateRepository 和 stateRepositoryPersistenceService 共用，避免 DRY 违反。
 */

import type { LocalBackupSettings } from './types';

/**
 * 获取对象的时间戳用于比较新旧：优先 updatedAt，其次 createdAt，最后回退 0。
 */
export function getItemTimestamp(item: { updatedAt?: number; createdAt?: number }): number {
  return item.updatedAt ?? item.createdAt ?? 0;
}

/**
 * 按 ID 合并两个数组。
 * - 当 second 的时间戳**严格大于** existing 时，second 覆盖
 * - 当时间戳相等时，也使用 second（磁盘数据优先），确保跨 IDE 同步时不丢失更新
 * - 如果只有一侧存在，直接保留
 * - 可选 deletedIds 集合排除已删除的项（防止从磁盘复活）
 *
 * 注意：返回数组中的对象是原始引用（不做深拷贝），
 * 调用方在修改合并结果中的对象时应注意引用别名问题。
 */
export function mergeById<T extends { id: string; updatedAt?: number; createdAt?: number }>(
  firstItems: T[],
  secondItems: T[],
  deletedIds?: ReadonlySet<string>
): T[] {
  const result = new Map<string, T>();
  for (const item of firstItems) {
    result.set(item.id, item);
  }
  for (const secondItem of secondItems) {
    // 跳过已删除的项，防止从磁盘复活
    if (deletedIds && deletedIds.has(secondItem.id)) {
      continue;
    }
    const existing = result.get(secondItem.id);
    if (!existing) {
      result.set(secondItem.id, secondItem);
      continue;
    }
    const existingTs = getItemTimestamp(existing);
    const secondTs = getItemTimestamp(secondItem);
    if (secondTs >= existingTs) {
      result.set(secondItem.id, secondItem);
    }
  }
  // Map 保持插入顺序：memory 项保持原有位置，disk 新增项追加到末尾。
  // 不按 ID 排序，保留用户的自定义排列。
  return Array.from(result.values());
}

/**
 * 字段级合并 localBackup 设置。
 * @param primary 主方（persist 时为 memory，reload 时为 disk）
 * @param fallback 备用方（persist 时为 disk，reload 时为 memory）
 * 避免全有或全无合并导致不同 IDE 的不同字段修改互相覆盖。
 *
 * 注意：不使用 ?? 运算符，因为 false ?? true === true，
 * 会将用户显式设置的 false 值错误地覆盖为 fallback 的 true。
 */
export function mergeLocalBackup(
  primary: LocalBackupSettings | undefined,
  fallback: LocalBackupSettings | undefined
): LocalBackupSettings | undefined {
  if (!primary) { return fallback; }
  if (!fallback) { return primary; }
  function pick<T>(a: T, b: T): T;
  function pick<T>(a: T | undefined, b: T | undefined): T | undefined;
  function pick<T>(a: T | undefined, b: T | undefined): T | undefined {
    return a !== undefined ? a : b;
  }
  return {
    enabled: pick(primary.enabled, fallback.enabled),
    directory: pick(primary.directory, fallback.directory),
    intervalHours: pick(primary.intervalHours, fallback.intervalHours),
    maxCount: pick(primary.maxCount, fallback.maxCount),
    maxAgeDays: pick(primary.maxAgeDays, fallback.maxAgeDays),
  };
}
