/**
 * 检查值是否为字符串
 * @param value 待检查的值
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * 检查值是否为非null的对象
 * @param value 待检查的值
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 检查值是否为非空数组
 * @param value 待检查的值
 */
export function isNonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

/**
 * 检查值是否为数字
 * @param value 待检查的值
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

/**
 * 检查值是否为布尔值
 * @param value 待检查的值
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}
