/**
 * Assistants / RecycleBin 侧边栏 WebviewView 的 Host 端 Provider。
 *
 * 从原 TreeView（assistantsView.ts 的 AssistantsTreeProvider）迁移而来，
 * 同时服务主视图（mode='main'，活跃助手）与回收站视图（mode='recycle'，已删除助手）。
 *
 * 与原 TreeView 行为 1:1 对齐：
 * - main 模式：按分组展示活跃助手，支持折叠 / 搜索
 * - recycle 模式：平铺展示已删除助手，无分组，最少占 4 行（spacer 占位）
 * - 默认分组在搜索时始终保留；自定义分组无命中时隐藏
 *
 * 消息回路：
 * - Host → Webview：{ type:'state', payload } / { type:'clearSearch' } /
 *                   { type:'focusSearch' } / { type:'scrollTo', id }
 * - Webview → Host：invokeCommand / toggleGroupCollapse / search
 *
 * 搜索关键词由 host 端持有一份（供 buildState 过滤），webview 本地也持有输入态。
 */
import * as vscode from 'vscode';

import { DEFAULT_GROUP_ID, DELETED_GROUP_ID } from './constants';
import { BaseSidebarViewProvider } from './sidebarViewBase';
import {
  compareAssistants,
  compareGroups,
  getAssistantContextValue,
  getGroupContextValue,
  getGroupDisplayName,
  matchAssistantSearch
} from './sidebarViewSorters';
import { SidebarInbound } from './sidebarViewTypes';
import { ChatStateRepository } from './stateRepository';
import { AssistantGroup, AssistantGroupKind, AssistantProfile, RuntimeLocale, RuntimeStrings } from './types';

export type AssistantsViewMode = 'main' | 'recycle';

/** 回收站视图最小占位行数（与原 AssistantsTreeProvider.MIN_RECYCLE_VIEW_ROWS 一致） */
const MIN_RECYCLE_VIEW_ROWS = 4;

/** 推送给前端的单个分组状态 */
export interface AssistantsGroupState {
  id: string;
  /** 原始存储名（可能为空，命令回传时需要） */
  name: string;
  kind: AssistantGroupKind;
  /** 本地化显示名（默认分组为「默认分组」等） */
  displayName: string;
  /** 'chatbuddy.group.default' | 'chatbuddy.group.custom' */
  contextValue: string;
  collapsed: boolean;
  /** renameGroup 命令需要，用于判断默认分组是否被自定义过 */
  createdAt: number;
  updatedAt: number;
}

/** 推送给前端的单个助手状态 */
export interface AssistantsAssistantState {
  id: string;
  name: string;
  note: string;
  avatar: string | undefined;
  groupId: string;
  pinned: boolean;
  isDeleted: boolean;
  /** 'chatbuddy.assistant.active' | 'chatbuddy.assistant.pinned' | 'chatbuddy.assistant.deleted' */
  contextValue: string;
}

/** 推送给前端的全量状态 */
export interface AssistantsViewState {
  mode: AssistantsViewMode;
  locale: RuntimeLocale;
  strings: RuntimeStrings;
  selectedAssistantId: string | undefined;
  collapsedGroupIds: string[];
  groups: AssistantsGroupState[];
  assistants: AssistantsAssistantState[];
  /** host 端持有的搜索关键词（归一化后的小写形式） */
  searchKeyword: string;
  /** recycle 模式下的最小占位行数 */
  minRecycleRows: number;
}

/** AssistantsSidebarViewProvider 的依赖（由 extension.ts 注入） */
export interface AssistantsSidebarViewProviderDeps {
  repository: ChatStateRepository;
  getLocale: () => RuntimeLocale;
  getStrings: () => RuntimeStrings;
}

export class AssistantsSidebarViewProvider extends BaseSidebarViewProvider<AssistantsViewState, SidebarInbound> {
  private readonly deps: AssistantsSidebarViewProviderDeps;
  private searchKeyword = '';

  constructor(
    deps: AssistantsSidebarViewProviderDeps,
    extensionUri: vscode.Uri,
    htmlBuilder: (webview: vscode.Webview) => string,
    public readonly mode: AssistantsViewMode
  ) {
    super(
      extensionUri,
      mode === 'recycle' ? 'chatbuddy.recycleBinView' : 'chatbuddy.assistantsView',
      htmlBuilder,
      // onReady 握手完成后立即推送初始状态
      () => this.postState(this.buildState())
    );
    this.deps = deps;
  }

  /** 构造当前全量状态 */
  public buildState(): AssistantsViewState {
    return buildAssistantsState(this.deps.repository, this.mode, {
      locale: this.deps.getLocale(),
      strings: this.deps.getStrings(),
      searchKeyword: this.searchKeyword,
      selectedAssistantId: this.deps.repository.getSelectedAssistantId()
    });
  }

  /** 处理前端入站消息 */
  protected handleMessage(message: SidebarInbound): void {
    switch (message.type) {
      case 'invokeCommand':
        // 转发执行对应命令（pin/edit/delete/restore/renameGroup 等）
        void vscode.commands.executeCommand(message.command, ...(message.args ?? []));
        break;
      case 'toggleGroupCollapse':
        // setGroupCollapsed 内部会 bump()，由 refreshAll 统一推送新状态
        this.deps.repository.setGroupCollapsed(message.groupId, message.collapsed);
        break;
      case 'search':
        this.searchKeyword = message.keyword.trim().toLowerCase();
        this.postState(this.buildState());
        break;
    }
  }

  /** 清空搜索（reset / 切换 view 等场景调用） */
  public clearSearch(): void {
    this.searchKeyword = '';
    this.postClearSearch();
    this.postState(this.buildState());
  }

  /** 折叠全部分组（仅 main 模式有意义） */
  public collapseAll(): void {
    const groups = this.deps.repository.getGroups();
    for (const group of groups) {
      if (group.id !== DELETED_GROUP_ID) {
        this.deps.repository.setGroupCollapsed(group.id, true);
      }
    }
    // setGroupCollapsed 已 bump()，由 refreshAll 推送
  }

  /** 通知 webview 聚焦搜索框（仅 main 模式有意义） */
  public focusSearch(): void {
    if (!this.view || !this.isReady()) { return; }
    void this.view.webview.postMessage({ type: 'focusSearch' }).then(undefined, () => {});
  }

  /** 通知 webview 滚动到指定助手并高亮 */
  public scrollToAssistant(assistantId: string): void {
    if (!this.view || !this.isReady()) { return; }
    void this.view.webview.postMessage({ type: 'scrollTo', id: assistantId }).then(undefined, () => {});
  }
}

/**
 * 纯函数：构造 AssistantsViewState。
 *
 * 与原 AssistantsTreeProvider.getChildren 行为对齐：
 * - main 模式：分组排序后过滤无命中的自定义分组（默认分组始终保留），助手按 groupId 归属各分组
 * - recycle 模式：无分组，助手平铺
 */
export function buildAssistantsState(
  repository: ChatStateRepository,
  mode: AssistantsViewMode,
  opts: {
    locale: RuntimeLocale;
    strings: RuntimeStrings;
    searchKeyword: string;
    selectedAssistantId: string | undefined;
  }
): AssistantsViewState {
  const { locale, strings, selectedAssistantId } = opts;
  const keyword = opts.searchKeyword.trim().toLowerCase();
  const collapsedGroupIds = repository.getStateShallow().collapsedGroupIds;

  // 助手过滤：main 取活跃，recycle 取已删除；再按搜索关键词过滤；最后按统一规则排序
  const visibleAssistants = repository
    .getAssistants()
    .filter((a) => (mode === 'recycle' ? a.isDeleted : !a.isDeleted))
    .filter((a) => matchAssistantSearch(a, keyword))
    .sort(compareAssistants);

  const assistants: AssistantsAssistantState[] = visibleAssistants.map((a) => ({
    id: a.id,
    name: a.name,
    note: a.note.trim(),
    avatar: a.avatar?.trim() || undefined,
    groupId: a.groupId,
    pinned: a.pinned,
    isDeleted: a.isDeleted,
    contextValue: getAssistantContextValue(a)
  }));

  if (mode === 'recycle') {
    return {
      mode,
      locale,
      strings,
      selectedAssistantId,
      collapsedGroupIds,
      groups: [],
      assistants,
      searchKeyword: keyword,
      minRecycleRows: MIN_RECYCLE_VIEW_ROWS
    };
  }

  // main 模式：分组排序后过滤无命中的自定义分组（默认分组始终保留）
  const sortedGroups = repository
    .getGroups()
    .filter((g) => g.id !== DELETED_GROUP_ID)
    .sort(compareGroups);

  const groups: AssistantsGroupState[] = sortedGroups
    .filter((g) => groupHasVisibleAssistants(g, visibleAssistants, keyword))
    .map((g) => ({
      id: g.id,
      name: g.name,
      kind: g.kind,
      displayName: getGroupDisplayName(g, strings),
      contextValue: getGroupContextValue(g),
      collapsed: collapsedGroupIds.includes(g.id),
      createdAt: g.createdAt,
      updatedAt: g.updatedAt
    }));

  return {
    mode,
    locale,
    strings,
    selectedAssistantId,
    collapsedGroupIds,
    groups,
    assistants,
    searchKeyword: keyword,
    minRecycleRows: MIN_RECYCLE_VIEW_ROWS
  };
}

/**
 * 判断分组是否有可见助手（与原 AssistantsTreeProvider.groupHasVisibleAssistants 一致）。
 *
 * - 无搜索：所有分组可见（含空分组）
 * - 搜索：默认分组始终保留；自定义分组需至少有一个命中助手
 *
 * 注意：传入的 visibleAssistants 已按搜索关键词过滤，无需再匹配。
 */
function groupHasVisibleAssistants(
  group: AssistantGroup,
  visibleAssistants: AssistantProfile[],
  keyword: string
): boolean {
  if (!keyword) { return true; }
  if (group.id === DEFAULT_GROUP_ID) { return true; }
  return visibleAssistants.some((a) => a.groupId === group.id);
}
