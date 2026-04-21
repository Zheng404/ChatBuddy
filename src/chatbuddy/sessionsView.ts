/**
 * 会话树数据提供器。
 *
 * 为 VS Code TreeView 提供当前选中助手的会话列表数据，
 * 支持搜索过滤和会话选择状态同步。
 */
import * as vscode from 'vscode';

import { getStrings, resolveLocale } from './i18n';
import { AssistantProfile, ChatSessionSummary, ChatBuddyLocaleSetting, RuntimeLocale } from './types';

export interface SessionNode {
  kind: 'session';
  assistantId: string;
  session: ChatSessionSummary;
}

interface SessionSpacerNode {
  kind: 'spacer';
  id: string;
}

type SessionsTreeNode = SessionNode | SessionSpacerNode;

import { resolveLocaleString } from './utils';

const MIN_SESSIONS_VIEW_ROWS = 4;

type ProviderContext = {
  getSelectedAssistant: () => AssistantProfile | undefined;
  getSessionsForAssistant: (assistantId: string) => ChatSessionSummary[];
  getSelectedSessionId: (assistantId?: string) => string | undefined;
  getLocaleSetting: () => ChatBuddyLocaleSetting;
  searchSessionContent: (assistantId: string, keyword: string) => string[];
};

function toDisplayLocale(locale: RuntimeLocale): string {
  return resolveLocaleString(locale, 'zh-CN', 'en-US');
}

function formatSessionTooltip(strings: Record<string, string>, session: ChatSessionSummary, locale: RuntimeLocale): string {
  const fallbackTitle = strings.untitledSession || '';
  const title = session.title?.trim() || fallbackTitle;
  const updated = new Date(session.updatedAt).toLocaleString(toDisplayLocale(locale));
  return `${title}\n${updated}`;
}

export class SessionsTreeProvider implements vscode.TreeDataProvider<SessionsTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<SessionsTreeNode | undefined | void>();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private searchKeyword = '';

  constructor(private readonly context: ProviderContext) {}

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getSearchKeyword(): string {
    return this.searchKeyword;
  }

  public setSearchKeyword(keyword: string): void {
    this.searchKeyword = keyword.trim().toLowerCase();
    this.refresh();
  }

  public clearSearchKeyword(): void {
    this.searchKeyword = '';
    this.refresh();
  }

  public getTreeItem(element: SessionsTreeNode): vscode.TreeItem {
    if (element.kind === 'spacer') {
      const item = new vscode.TreeItem(' ', vscode.TreeItemCollapsibleState.None);
      item.id = element.id;
      item.contextValue = 'chatbuddy.view.spacer';
      return item;
    }

    const locale = resolveLocale(this.context.getLocaleSetting(), vscode.env.language);
    const strings = getStrings(locale);
    const isSelected = this.context.getSelectedSessionId(element.assistantId) === element.session.id;
    const title = element.session.title?.trim() || strings.untitledSession;

    const item = new vscode.TreeItem(title, vscode.TreeItemCollapsibleState.None);
    item.id = `chatbuddy.session.${element.session.id}`;
    item.contextValue = 'chatbuddy.session.item';
    item.tooltip = formatSessionTooltip(strings, element.session, locale);
    item.description = new Date(element.session.updatedAt).toLocaleString(toDisplayLocale(locale));
    item.iconPath = new vscode.ThemeIcon(isSelected ? 'comment-discussion' : 'comment');
    item.command = {
      command: 'chatbuddy.openSessionChat',
      title: strings.openAssistant,
      arguments: [element]
    };
    return item;
  }

  public getChildren(element?: SessionsTreeNode): Thenable<SessionsTreeNode[]> {
    if (element) {
      return Promise.resolve([]);
    }
    const assistant = this.context.getSelectedAssistant();
    if (!assistant || assistant.isDeleted) {
      return Promise.resolve(this.appendSpacers([]));
    }
    const sessions = this.context.getSessionsForAssistant(assistant.id);
    const matchingIds = this.searchKeyword
      ? this.context.searchSessionContent(assistant.id, this.searchKeyword)
      : undefined;
    const filtered = sessions.filter((session) => this.matchSearch(session, matchingIds));
    const nodes = filtered.map((session) => ({
        kind: 'session' as const,
        assistantId: assistant.id,
        session
      }));
    return Promise.resolve(this.appendSpacers(nodes));
  }

  private matchSearch(session: ChatSessionSummary, matchingIds?: string[]): boolean {
    if (!this.searchKeyword) {
      return true;
    }
    if (session.title?.toLowerCase().includes(this.searchKeyword)) {
      return true;
    }
    return matchingIds?.includes(session.id) ?? false;
  }

  private appendSpacers(nodes: SessionNode[]): SessionsTreeNode[] {
    if (nodes.length >= MIN_SESSIONS_VIEW_ROWS) {
      return nodes;
    }
    const fillers: SessionSpacerNode[] = [];
    for (let index = nodes.length; index < MIN_SESSIONS_VIEW_ROWS; index += 1) {
      fillers.push({
        kind: 'spacer',
        id: `chatbuddy.session.spacer.${index}`
      });
    }
    return [...nodes, ...fillers];
  }
}
