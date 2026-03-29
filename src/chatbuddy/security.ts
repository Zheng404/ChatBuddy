/**
 * 安全工具模块
 * 提供输入验证与清理能力
 */

/**
 * 验证 URL 是否安全
 * @param url - 待验证的 URL
 * @returns 是否为安全的 URL
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 验证模型名称格式
 * @param modelName - 模型名称
 * @returns 是否为有效的模型名称
 */
export function isValidModelName(modelName: string): boolean {
  if (!modelName || typeof modelName !== 'string') {
    return false;
  }

  const trimmed = modelName.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // 兼容常见模型命名：允许字母、数字、点、下划线、连字符、冒号、斜杠和加号
  return /^[a-zA-Z0-9._:/+-]+$/.test(trimmed);
}

/**
 * 限制字符串长度
 * @param input - 输入字符串
 * @param maxLength - 最大长度
 * @param suffix - 超长时的后缀（默认为 '...'）
 * @returns 限制长度后的字符串
 */
function truncateString(input: string, maxLength: number, suffix: string = '...'): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  if (input.length <= maxLength) {
    return input;
  }

  return input.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * 验证并清理助手名称
 * @param name - 助手名称
 * @returns 清理后的名称
 */
export function sanitizeAssistantName(name: string): string {
  if (!name || typeof name !== 'string') {
    return '';
  }

  let sanitized = name.trim();
  sanitized = truncateString(sanitized, 100, '');
  sanitized = Array.from(sanitized)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');

  return sanitized;
}

/**
 * 验证并清理分组名称
 * @param name - 分组名称
 * @returns 清理后的名称
 */
export function sanitizeGroupName(name: string): string {
  return sanitizeAssistantName(name);
}
