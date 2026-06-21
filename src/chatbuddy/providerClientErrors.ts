/**
 * Provider HTTP 错误处理共享模块。
 *
 * 提取自 providerClient.ts 与 providerClientModelFetchers.ts 的重复定义，
 * 消除两者之间的循环依赖（原 modelFetchers 因循环引用无法 import providerClient）。
 *
 * 提供：
 * - HttpError：携带 HTTP 状态码的错误类型，用于重试逻辑判断。
 * - ensureSuccess：统一的非 2xx 响应抛错逻辑。
 * - toErrorMessage：HTTP 状态码到本地化消息的映射。
 */
import { getStrings } from './i18n';
import { PROVIDER_LIMITS } from './constants';
import { RuntimeLocale } from './types';

/**
 * 将 HTTP 状态码映射为本地化的简短错误消息。
 * @param status - HTTP 状态码
 * @param fallback - 无法识别状态码时使用的兜底消息
 * @param locale - 运行时区域设置
 */
export function toErrorMessage(status: number, fallback: string, locale: RuntimeLocale): string {
  const strings = getStrings(locale);
  if (status === 401) {
    return strings.authFailed;
  }
  if (status === 403) {
    return strings.accessDenied;
  }
  if (status === 429) {
    return strings.rateLimited;
  }
  if (status >= 500) {
    return strings.serviceUnavailable;
  }
  return fallback;
}

/** 携带 HTTP 状态码的错误类型，重试逻辑据此判断是否可重试。 */
export class HttpError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * 当响应非 2xx 时抛出 HttpError。
 * 响应体文本会被截断到 PROVIDER_LIMITS.ERROR_RESPONSE_TRUNCATE_LENGTH 以避免过长。
 * @param response - fetch 返回的 Response 对象
 * @param locale - 运行时区域设置
 * @throws {HttpError} 当 response.ok 为 false 时
 */
export async function ensureSuccess(response: Response, locale: RuntimeLocale): Promise<void> {
  if (response.ok) {
    return;
  }
  const text = await response.text();
  const fallback =
    locale === 'zh-CN'
      ? `请求失败（${response.status}）：${text.slice(0, PROVIDER_LIMITS.ERROR_RESPONSE_TRUNCATE_LENGTH)}`
      : `Request failed (${response.status}): ${text.slice(0, PROVIDER_LIMITS.ERROR_RESPONSE_TRUNCATE_LENGTH)}`;
  throw new HttpError(response.status, toErrorMessage(response.status, fallback, locale));
}
