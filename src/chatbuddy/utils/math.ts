/**
 * 将数值限制在指定范围内
 * @param value 输入值
 * @param min 最小值
 * @param max 最大值
 * @param fallback 无效值时的回退值
 */
export function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}
