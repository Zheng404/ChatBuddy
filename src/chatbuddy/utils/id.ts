import { randomBytes } from 'crypto';

/**
 * 生成唯一ID
 * @param prefix ID前缀
 * @returns 格式为 {prefix}_{timestamp}_{random} 的ID
 */
export function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

/**
 * 获取当前时间戳
 * @returns 当前时间的毫秒数
 */
export function nowTs(): number {
  return Date.now();
}
