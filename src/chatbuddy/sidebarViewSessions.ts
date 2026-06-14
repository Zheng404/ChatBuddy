/**
 * Sessions 侧边栏 WebviewView 的 Host 端 Provider。
 *
 * 从原 TreeView（sessionsView.ts 的 SessionsTreeProvider）迁移而来，
 * 负责展示当前选中助手下的会话列表，支持搜索过滤与会话选择状态同步。
 *
 * 与原 TreeView 行为 1:1 对齐：
 * - 展示当前选中助手（未删除）下的会话列表
 * - 按 updatedAt 倒序排列
 * - 搜索过滤：title 命中 + 内容命中（searchSessionContent）
 * - 选中态同步（comment-discussion / comment 图标切换）
 * - 不足 MIN_SESSIONS_VIEW_ROWS 时由前端补 spacer 占位
 *
 * 消息回路：
 * - Host → Webview：{ type:'state', payload } / { type:'clearSearch' } /
 *                   { type:'focusSearch' } / { type:'scrollTo', id }
 * - Webview → Host：invokeCommand / search
 *
 * 搜索关键词由 host 端持有一份（供 buildState 过滤），webview 本地也持有输入态。
 */
import * as vscode from 'vscode';

import { BaseSidebarViewProvider } from './sidebarViewBase';
import { formatSessionTooltip, toDisplayLocale } from './sidebarViewSorters';
import { SidebarInbound } from './sidebarViewTypes';
import { ChatStateRepository } from './stateRepository';
import { ChatSessionSummary, RuntimeLocale, RuntimeStrings } from './types';

/** Sessions 视图最小占位行数（与原 SessionsTreeProvider.MIN_SESSIONS_VIEW_ROWS 一致） */
const MIN_SESSIONS_VIEW_ROWS = 4;

/** 推送给前端的单个会话状态 */
export interface SessionsViewSessionState {
  id: string;
  title: string;
  updatedAt: number;
  /** host 端按 locale 格式化的本地化显示时间 */
  formattedUpdatedAt: string;
  /** host 端按 locale 格式化的 tooltip（包含标题与更新时间） */
  tooltip: string;
  isSelected: boolean;
  contextValue: 'chatbuddy.session.item';
}

/** 推送给前端的全量状态 */
export interface SessionsViewState {
  locale: RuntimeLocale;
  strings: RuntimeStrings;
  /** 当前选中的助手（无选中或已删除时为 undefined） */
  selectedAssistant: { id: string; name: string } | undefined;
  selectedSessionId: string | undefined;
  /** host 端持有的搜索关键词（归一化后的小写形式） */
  searchKeyword: string;
  sessions: SessionsViewSessionState[];
  /** 不足时由前端补 spacer 占位的行数 */
  minRows: number;
}

/** SessionsSidebarViewProvider 的依赖（由 extension.ts 注入） */
export interface SessionsSidebarViewProviderDeps {
  repository: ChatStateRepository;
  getLocale: () => RuntimeLocale;
  getStrings: () => RuntimeStrings;
}

export class SessionsSidebarViewProvider extends BaseSidebarViewProvider<SessionsViewState, SidebarInbound> {
  private readonly deps: SessionsSidebarViewProviderDeps;
  private searchKeyword = '';

  constructor(
    deps: SessionsSidebarViewProviderDeps,
    extensionUri: vscode.Uri,
    htmlBuilder: (webview: vscode.Webview) => string
  ) {
    super(extensionUri, 'chatbuddy.sessionsView', htmlBuilder, () =>
      this.postState(this.buildState())
    );
    this.deps = deps;
  }

  /** 构造当前全量状态 */
  public buildState(): SessionsViewState {
    return buildSessionsState(this.deps.repository, {
      locale: this.deps.getLocale(),
      strings: this.deps.getStrings(),
      searchKeyword: this.searchKeyword
    });
  }

  /** 处理前端入站消息 */
  protected handleMessage(message: SidebarInbound): void {
    switch (message.type) {
      case 'invokeCommand':
        // 转发执行对应命令（openSessionChat / renameSession / deleteSession / exportSession）
        void vscode.commands.executeCommand(message.command, ...(message.args ?? []));
        break;
      case 'search':
        this.searchKeyword = message.keyword.trim().toLowerCase();
        this.postState(this.buildState());
        break;
      // sessions view 不处理 toggleGroupCollapse
    }
  }

  /** 清空搜索（reset / 切换 view 等场景调用） */
  public clearSearch(): void {
    this.searchKeyword = '';
    this.postClearSearch();
    this.postState(this.buildState());
  }

  /** 通知 webview 聚焦搜索框 */
  public focusSearch(): void {
    if (!this.view || !this.isReady()) { return; }
    void this.view.webview.postMessage({ type: 'focusSearch' }).then(undefined, () => {});
  }

  /** 通知 webview 滚动到指定会话并高亮 */
  public scrollToSession(sessionId: string): void {
    if (!this.view || !this.isReady()) { return; }
    void this.view.webview.postMessage({ type: 'scrollTo', id: sessionId }).then(undefined, () => {});
  }
}

/**
 * 纯函数：构造 SessionsViewState。
 *
 * 与原 SessionsTreeProvider.getChildren / getTreeItem 行为对齐：
 * - 无选中助手或选中助手已删除 → sessions 为空数组
 * - 搜索：title 命中（大小写不敏感）或内容命中（searchSessionContent）
 * - 排序：按 updatedAt 倒序
 */
export function buildSessionsState(
  repository: ChatStateRepository,
  opts: {
    locale: RuntimeLocale;
    strings: RuntimeStrings;
    searchKeyword: string;
  }
): SessionsViewState {
  const { locale, strings } = opts;
  const keyword = opts.searchKeyword.trim().toLowerCase();

  const assistant = repository.getSelectedAssistant();
  // 无选中助手或已删除助手：sessions 为空
  if (!assistant || assistant.isDeleted) {
    return {
      locale,
      strings,
      selectedAssistant: undefined,
      selectedSessionId: undefined,
      searchKeyword: keyword,
      sessions: [],
      minRows: MIN_SESSIONS_VIEW_ROWS
    };
  }

  const selectedAssistant = { id: assistant.id, name: assistant.name };
  const selectedSessionId = repository.getSelectedSessionId(assistant.id);

  // 取该助手下的全部会话
  const allSessions = repository.getSessionsForAssistant(assistant.id);

  // 搜索过滤：title 命中或内容命中
  const matchingIds = keyword
    ? new Set(repository.searchSessionContent(assistant.id, keyword))
    : undefined;
  const filtered = allSessions.filter((session) => matchSessionSearch(session, keyword, matchingIds));

  // 按 updatedAt 倒序排列
  const sorted = filtered.slice().sort((a, b) => b.updatedAt - a.updatedAt);

  const sessions: SessionsViewSessionState[] = sorted.map((session) => {
    const title = session.title?.trim() || strings.untitledSession || '';
    return {
      id: session.id,
      title,
      updatedAt: session.updatedAt,
      formattedUpdatedAt: new Date(session.updatedAt).toLocaleString(toDisplayLocale(locale)),
      tooltip: formatSessionTooltip(strings, session, locale),
      isSelected: selectedSessionId === session.id,
      contextValue: 'chatbuddy.session.item'
    };
  });

  return {
    locale,
    strings,
    selectedAssistant,
    selectedSessionId,
    searchKeyword: keyword,
    sessions,
    minRows: MIN_SESSIONS_VIEW_ROWS
  };
}

/**
 * 判断会话是否匹配搜索关键字（与原 SessionsTreeProvider.matchSearch 一致）。
 *
 * - 关键字为空时视为全部匹配
 * - 标题（大小写不敏感）命中即匹配
 * - 否则查 searchSessionContent 返回的匹配 id 集合
 */
function matchSessionSearch(
  session: ChatSessionSummary,
  keyword: string,
  matchingIds: Set<string> | undefined
): boolean {
  if (!keyword) {
    return true;
  }
  if (session.title?.toLowerCase().includes(keyword)) {
    return true;
  }
  return matchingIds?.has(session.id) ?? false;
}
