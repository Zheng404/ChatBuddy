/**
 * 侧边栏视图共用纯函数集合。
 *
 * 从助手视图（assistantsView）和会话视图（sessionsView）中提取出的无副作用辅助函数，
 * 供旧的 TreeProvider 与未来的 WebviewView Provider 共同复用。
 *
 * 包含：
 * - 分组/助手的排序比较（compareGroups、compareAssistants）
 * - 助手与分组的 contextValue 计算（getGroupContextValue、getAssistantContextValue）
 * - 分组显示名解析（getGroupDisplayName）
 * - 助手搜索匹配（matchAssistantSearch）
 * - 会话 tooltip 格式化与本地化显示（toDisplayLocale、formatSessionTooltip）
 */
import { DEFAULT_GROUP_ID, DELETED_GROUP_ID, isLegacyDefaultGroupName } from './constants';
import { resolveLocaleString } from './utils';
import { AssistantGroup, AssistantProfile, ChatSessionSummary, RuntimeLocale } from './types';

/**
 * 比较两个分组的排序顺序。
 *
 * 排序规则：先按分组类型权重（default < custom < deleted），
 * 同为 custom 时按名称（中文拼音）排序，其余按创建时间升序。
 */
export function compareGroups(a: AssistantGroup, b: AssistantGroup): number {
  const weight: Record<AssistantGroup['kind'], number> = {
    default: 0,
    custom: 1,
    deleted: 2
  };
  const byType = weight[a.kind] - weight[b.kind];
  if (byType !== 0) {
    return byType;
  }
  if (a.kind === 'custom' && b.kind === 'custom') {
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  }
  return a.createdAt - b.createdAt;
}

/**
 * 比较两个助手的排序顺序。
 *
 * 排序规则：置顶优先，其次按最近交互时间倒序，最后按名称（中文拼音）排序。
 */
export function compareAssistants(a: AssistantProfile, b: AssistantProfile): number {
  if (a.pinned !== b.pinned) {
    return a.pinned ? -1 : 1;
  }
  if (a.lastInteractedAt !== b.lastInteractedAt) {
    return b.lastInteractedAt - a.lastInteractedAt;
  }
  return a.name.localeCompare(b.name, 'zh-Hans-CN');
}

/**
 * 解析分组的显示名称。
 *
 * 默认分组在未自定义名称（或为旧版默认名且未被修改）时返回本地化的「默认分组」，
 * 已删除分组返回本地化的「回收站」名称，其余返回自定义名称。
 */
export function getGroupDisplayName(group: AssistantGroup, strings: Record<string, string>): string {
  if (group.id === DEFAULT_GROUP_ID) {
    const customName = group.name.trim();
    if (!customName || (group.updatedAt === group.createdAt && isLegacyDefaultGroupName(customName))) {
      return strings.defaultGroupName;
    }
    return customName;
  }
  if (group.id === DELETED_GROUP_ID) {
    return strings.deletedGroupName;
  }
  return group.name;
}

/**
 * 计算分组的 contextValue，用于区分默认分组、已删除分组与自定义分组。
 */
export function getGroupContextValue(group: AssistantGroup): string {
  if (group.id === DEFAULT_GROUP_ID) {
    return 'chatbuddy.group.default';
  }
  if (group.id === DELETED_GROUP_ID) {
    return 'chatbuddy.group.deleted';
  }
  return 'chatbuddy.group.custom';
}

/**
 * 计算助手的 contextValue，用于区分已删除、置顶与普通活跃助手。
 */
export function getAssistantContextValue(assistant: AssistantProfile): string {
  if (assistant.isDeleted) {
    return 'chatbuddy.assistant.deleted';
  }
  if (assistant.pinned) {
    return 'chatbuddy.assistant.pinned';
  }
  return 'chatbuddy.assistant.active';
}

/**
 * 判断助手是否匹配搜索关键字。
 *
 * 关键字为空时视为全部匹配；否则在助手名称与备注中做大小写不敏感的包含判断。
 */
export function matchAssistantSearch(assistant: AssistantProfile, keyword: string): boolean {
  if (!keyword) {
    return true;
  }
  const haystack = `${assistant.name} ${assistant.note}`.toLowerCase();
  return haystack.includes(keyword);
}

/**
 * 将运行时本地化标识转换为浏览器 toLocaleString 等接口可识别的显示用 locale 字符串。
 */
export function toDisplayLocale(locale: RuntimeLocale): string {
  return resolveLocaleString(locale, 'zh-CN', 'en-US');
}

/**
 * 格式化会话的 tooltip 文本。
 *
 * 由标题（缺省时使用本地化的「未命名会话」）与本地化的更新时间组成。
 */
export function formatSessionTooltip(
  strings: Record<string, string>,
  session: ChatSessionSummary,
  locale: RuntimeLocale
): string {
  const fallbackTitle = strings.untitledSession || '';
  const title = session.title?.trim() || fallbackTitle;
  const updated = new Date(session.updatedAt).toLocaleString(toDisplayLocale(locale));
  return `${title}\n${updated}`;
}
