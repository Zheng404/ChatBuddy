/**
 * 共享状态合并工具函数。
 *
 * 提供 `mergeById` 和 `getItemTimestamp`，供 stateRepository 和
 * stateRepositoryPersistenceService 共用，避免 DRY 违反。
 */

/**
 * 获取对象的时间戳用于比较新旧：优先 updatedAt，其次 createdAt，最后回退 0。
 */
export function getItemTimestamp(item: { updatedAt?: number; createdAt?: number }): number {
  return item.updatedAt ?? item.createdAt ?? 0;
}

/**
 * 按 ID 合并两个数组，第一个参数的项在时间戳相等时优先保留。
 * 时间戳严格更新（secondTs > firstTs）时，第二个参数的项覆盖。
 * 如果只有一侧存在，直接保留。
 *
 * 注意：返回数组中的对象是原始引用（不做深拷贝），
 * 调用方在修改合并结果中的对象时应注意引用别名问题。
 */
export function mergeById<T extends { id: string; updatedAt?: number; createdAt?: number }>(
  firstItems: T[],
  secondItems: T[]
): T[] {
  const result = new Map<string, T>();
  for (const item of firstItems) {
    result.set(item.id, item);
  }
  for (const secondItem of secondItems) {
    const existing = result.get(secondItem.id);
    if (!existing) {
      result.set(secondItem.id, secondItem);
      continue;
    }
    const existingTs = getItemTimestamp(existing);
    const secondTs = getItemTimestamp(secondItem);
    if (secondTs > existingTs) {
      result.set(secondItem.id, secondItem);
    }
  }
  return Array.from(result.values());
}
