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

  constructor(private readonly context: ProviderContext) {}

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
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
    const nodes = sessions.map((session) => ({
        kind: 'session' as const,
        assistantId: assistant.id,
        session
      }));
    return Promise.resolve(this.appendSpacers(nodes));
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
