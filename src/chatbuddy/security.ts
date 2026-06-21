/**
 * 安全工具模块
 * 提供输入验证与清理能力
 */
import { warn } from './utils';

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
    if (parsed.username || parsed.password) {
      return false;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (err) {
    warn('Error validating URL:', err);
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
 * 验证并清理助手名称
 * @param name - 助手名称
 * @returns 清理后的名称
 */
export function sanitizeAssistantName(name: string): string {
  return sanitizeFreeText(name, 100);
}

/**
 * 验证并清理助手备注（note）。
 *
 * 与名称共享不可见字符过滤逻辑，但允许更长的字符上限（500），
 * 因为 note 用于描述性文本，语义上需要比名称更宽松的容量。
 * @param note - 助手备注
 * @returns 清理后的备注
 */
export function sanitizeAssistantNote(note: string): string {
  return sanitizeFreeText(note, 500);
}

/**
 * 验证并清理分组名称
 * @param name - 分组名称
 * @returns 清理后的名称
 */
export function sanitizeGroupName(name: string): string {
  return sanitizeAssistantName(name);
}

/**
 * 自由文本清理的共享实现：去除首尾空白、限制长度，并过滤掉
 * 各类不可见 / 控制字符（ASCII 控制字符、零宽字符、双向控制、
 * BOM、格式字符、软连字符、Tag 字符），防止显示混乱或注入攻击。
 */
function sanitizeFreeText(input: string, maxLength: number): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  let sanitized = input.trim();
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }
  sanitized = Array.from(sanitized)
    .filter((char) => {
      const code = char.codePointAt(0)!;
      // ASCII 控制字符
      if (code < 32 || code === 127) { return false; }
      // 零宽字符 U+200B..U+200F (含 ZWNJ/ZWJ)
      if (code >= 0x200B && code <= 0x200F) { return false; }
      // 双向控制 U+202A..U+202E
      if (code >= 0x202A && code <= 0x202E) { return false; }
      // BOM
      if (code === 0xFEFF) { return false; }
      // 格式字符 U+2060..U+206F (Word Joiner 等)
      if (code >= 0x2060 && code <= 0x206F) { return false; }
      // 软连字符、阿拉伯格式字符
      if (code === 0x00AD) { return false; }
      // Tag characters U+E0000..U+E007F
      if (code >= 0xE0000 && code <= 0xE007F) { return false; }
      return true;
    })
    .join('');

  return sanitized;
}
