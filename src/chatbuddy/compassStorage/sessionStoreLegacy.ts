/**
 * 会话遗留数据迁移辅助模块。
 *
 * 提取自 sessionStore.ts，包含从旧版 SQLite 行格式解析消息的纯函数。
 * 仅在 `CompassSessionStore.importFromLegacyRows` 迁移路径中使用，
 * 与主类的运行时状态完全解耦。
 */
import { ChatMessage, ChatToolRound } from '../types';
import { nowTs, warn } from '../utils';
import { toNumberValue, toRoleValue, toStringValue } from './types';

/**
 * Parse tool rounds from a legacy JSON string column.
 * Returns undefined when the value is absent or invalid.
 */
export function parseToolRounds(raw: unknown): ChatToolRound[] | undefined {
  if (typeof raw !== 'string' || !raw.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as ChatToolRound[];
    }
  } catch (err) {
    warn('Error parsing tool rounds:', err);
  }
  return undefined;
}

/**
 * Parse images from a legacy JSON string column.
 * Returns undefined when the value is absent or invalid.
 */
export function parseImages(raw: unknown): ChatMessage['images'] {
  if (typeof raw !== 'string' || !raw.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as ChatMessage['images'];
    }
  } catch (err) {
    warn('Error parsing images:', err);
  }
  return undefined;
}

/**
 * Map a legacy SQLite message row to a normalized ChatMessage.
 * Used by CompassSessionStore.importFromLegacyRows during SQLite → Compass migration.
 */
export function mapLegacyMessageRow(row: Record<string, unknown>): ChatMessage {
  return {
    id: toStringValue(row.id),
    role: toRoleValue(row.role),
    content: toStringValue(row.content),
    timestamp: toNumberValue(row.ts, nowTs()),
    model: toStringValue(row.model).trim() || undefined,
    reasoning: toStringValue(row.reasoning).trim() || undefined,
    toolRounds: parseToolRounds(row.tool_rounds),
    images: parseImages(row.images)
  };
}
