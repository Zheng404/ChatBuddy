/**
 * Codicon 工具函数模块
 * 提供 JSON 解析、CSS 处理等辅助功能
 */

/**
 * 将字符串转换为 CSS 字符串字面量（转义特殊字符）
 * @param value - 原始字符串
 * @returns 转义后的字符串
 */
export function toCssStringLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 将字符串转换为 CSS content 属性字面量
 * @param value - 原始字符串
 * @returns 转义后的字符串
 */
export function toCssContentLiteral(value: string): string {
  return value.replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

/**
 * 规范化 CSS token，确保只包含安全字符
 * @param value - 待规范化的值
 * @param fallback - 当值无效时的回退值
 * @returns 规范化后的字符串
 */
export function normalizeCssToken(value: unknown, fallback: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return fallback;
  }
  const normalized = String(value).trim();
  return /^[a-zA-Z0-9 _.-]+$/.test(normalized) ? normalized : fallback;
}

/**
 * 移除 JSON 字符串中的注释（支持单行和多行注释）
 * @param source - 原始 JSON 字符串
 * @returns 移除注释后的字符串
 */
function stripJsonComments(source: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = i + 1 < source.length ? source[i + 1] : '';

    if (inLineComment) {
      if (ch === '\n' || ch === '\r') {
        inLineComment = false;
        result += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      result += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      escaped = false;
      result += ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    result += ch;
  }

  return result;
}

/**
 * 移除 JSON 字符串中的尾随逗号
 * @param source - 原始 JSON 字符串
 * @returns 移除尾随逗号后的字符串
 */
function stripTrailingCommas(source: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      result += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      escaped = false;
      result += ch;
      continue;
    }

    if (ch !== ',') {
      result += ch;
      continue;
    }

    let j = i + 1;
    while (j < source.length && /\s/.test(source[j])) {
      j += 1;
    }
    const nextNonSpace = j < source.length ? source[j] : '';
    if (nextNonSpace === '}' || nextNonSpace === ']') {
      continue;
    }
    result += ch;
  }

  return result;
}

/**
 * 解析类 JSON 字符串（支持注释和尾随逗号）
 * @param raw - 原始字符串
 * @returns 解析后的对象，失败返回 undefined
 */
export function parseJsonLike<T>(raw: string): T | undefined {
  let content = raw;
  // 处理各种 BOM 格式
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  } else if (content.charCodeAt(0) === 0xfffe) {
    // UTF-16 LE BOM
    content = content.slice(2);
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    // fallthrough
  }

  try {
    const cleaned = stripTrailingCommas(stripJsonComments(content));
    return JSON.parse(cleaned) as T;
  } catch {
    return undefined;
  }
}

/**
 * 规范化主题 token（转小写并规范化空格）
 * @param value - 原始字符串
 * @returns 规范化后的字符串
 */
export function normalizeThemeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 规范化字体族名称（移除引号和 !important）
 * @param value - 原始字体族名称
 * @returns 规范化后的字体族名称
 */
export function normalizeFontFamilyToken(value: string): string {
  return value.replace(/!important/gi, '').trim().replace(/^['"]|['"]$/g, '').trim();
}
