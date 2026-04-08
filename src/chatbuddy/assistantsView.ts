import * as vscode from 'vscode';

import { DEFAULT_GROUP_ID, DELETED_GROUP_ID, isLegacyDefaultGroupName } from './constants';
import { getStrings, resolveLocale } from './i18n';
import { AssistantGroup, AssistantProfile } from './types';

export type AssistantsTreeNode = AssistantGroupNode | AssistantNode | AssistantsSpacerNode;

export interface AssistantGroupNode {
  kind: 'group';
  group: AssistantGroup;
}

export interface AssistantNode {
  kind: 'assistant';
  assistant: AssistantProfile;
}

interface AssistantsSpacerNode {
  kind: 'spacer';
  id: string;
}

export type AssistantsTreeMode = 'main' | 'recycle';

type ProviderContext = {
  getGroups: () => AssistantGroup[];
  getAssistants: () => AssistantProfile[];
  getLocaleSetting: () => 'auto' | 'zh-CN' | 'en';
};

const MIN_RECYCLE_VIEW_ROWS = 4;

function compareGroups(a: AssistantGroup, b: AssistantGroup): number {
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

function compareAssistants(a: AssistantProfile, b: AssistantProfile): number {
  if (a.pinned !== b.pinned) {
    return a.pinned ? -1 : 1;
  }
  if (a.lastInteractedAt !== b.lastInteractedAt) {
    return b.lastInteractedAt - a.lastInteractedAt;
  }
  return a.name.localeCompare(b.name, 'zh-Hans-CN');
}

export class AssistantsTreeProvider implements vscode.TreeDataProvider<AssistantsTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<AssistantsTreeNode | undefined | void>();
  private searchKeyword = '';

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly context: ProviderContext, private readonly mode: AssistantsTreeMode = 'main') {}

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

  public findAssistantNode(assistantId: string): AssistantNode | undefined {
    const assistant = this.context
      .getAssistants()
      .find((item) => item.id === assistantId && (this.mode === 'recycle' ? item.isDeleted : !item.isDeleted));
    if (!assistant) {
      return undefined;
    }
    return {
      kind: 'assistant',
      assistant
    };
  }

  public getTreeItem(element: AssistantsTreeNode): vscode.TreeItem {
    const locale = resolveLocale(this.context.getLocaleSetting(), vscode.env.language);
    const strings = getStrings(locale);

    if (element.kind === 'spacer') {
      const item = new vscode.TreeItem(' ', vscode.TreeItemCollapsibleState.None);
      item.id = element.id;
      item.contextValue = 'chatbuddy.view.spacer';
      return item;
    }

    if (element.kind === 'group') {
      const group = element.group;
      const label = this.getGroupDisplayName(group, strings);
      const item = new vscode.TreeItem(
        label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.contextValue = this.getGroupContextValue(group);
      item.id = `chatbuddy.group.${group.id}`;
      item.tooltip = label;
      return item;
    }

    const assistant = element.assistant;
    const note = assistant.note.trim();
    const item = new vscode.TreeItem(assistant.name, vscode.TreeItemCollapsibleState.None);
    item.id = `chatbuddy.assistant.${assistant.id}`;
    item.description = note || undefined;
    item.tooltip = assistant.isDeleted
      ? `${assistant.name}${note ? `\n${note}` : ''}\n${strings.assistantArchivedReadonly}`
      : `${assistant.name}${note ? `\n${note}` : ''}`;
    item.contextValue = this.getAssistantContextValue(assistant);
    const avatar = assistant.avatar?.trim();
    item.iconPath = new vscode.ThemeIcon(avatar || 'account');
    item.command = {
      command: 'chatbuddy.openAssistantChat',
      title: strings.openAssistant,
      arguments: [assistant.id]
    };
    return item;
  }

  public getChildren(element?: AssistantsTreeNode): Thenable<AssistantsTreeNode[]> {
    const groups = this.context
      .getGroups()
      .filter((group) => group.id !== DELETED_GROUP_ID)
      .sort(compareGroups);
    const assistants = this.context
      .getAssistants()
      .filter((assistant) => (this.mode === 'recycle' ? assistant.isDeleted : !assistant.isDeleted))
      .sort(compareAssistants);

    if (this.mode === 'recycle') {
      if (element) {
        return Promise.resolve([]);
      }
      const nodes = assistants.filter((assistant) => this.matchSearch(assistant)).map<AssistantsTreeNode>((assistant) => ({
        kind: 'assistant',
        assistant
      }));
      return Promise.resolve(this.appendRecycleSpacers(nodes));
    }

    if (!element) {
      const roots = groups
        .filter((group) => this.groupHasVisibleAssistants(group.id, assistants))
        .map<AssistantGroupNode>((group) => ({
          kind: 'group',
          group
        }));
      return Promise.resolve(roots);
    }

    if (element.kind === 'group') {
      const nodes = assistants
        .filter((assistant) => assistant.groupId === element.group.id)
        .filter((assistant) => this.matchSearch(assistant))
        .map<AssistantsTreeNode>((assistant) => ({
          kind: 'assistant',
          assistant
        }));
      return Promise.resolve(nodes);
    }

    return Promise.resolve([]);
  }

  private appendRecycleSpacers(nodes: AssistantsTreeNode[]): AssistantsTreeNode[] {
    if (nodes.length >= MIN_RECYCLE_VIEW_ROWS) {
      return nodes;
    }
    const fillers: AssistantsSpacerNode[] = [];
    for (let index = nodes.length; index < MIN_RECYCLE_VIEW_ROWS; index += 1) {
      fillers.push({
        kind: 'spacer',
        id: `chatbuddy.recycle.spacer.${index}`
      });
    }
    return [...nodes, ...fillers];
  }

  public getParent(element: AssistantsTreeNode): vscode.ProviderResult<AssistantsTreeNode> {
    if (this.mode === 'recycle') {
      return undefined;
    }

    if (element.kind === 'spacer') {
      return undefined;
    }

    if (element.kind === 'group') {
      return undefined;
    }

    const assistant = element.assistant;
    const group = this.context
      .getGroups()
      .find((item) => item.id === assistant.groupId && item.id !== DELETED_GROUP_ID);
    if (!group) {
      return undefined;
    }

    return {
      kind: 'group',
      group
    };
  }

  private groupHasVisibleAssistants(groupId: string, assistants: AssistantProfile[]): boolean {
    if (!this.searchKeyword) {
      return true;
    }
    if (groupId === DEFAULT_GROUP_ID) {
      return true;
    }
    return assistants.some((assistant) => assistant.groupId === groupId && this.matchSearch(assistant));
  }

  private matchSearch(assistant: AssistantProfile): boolean {
    if (!this.searchKeyword) {
      return true;
    }
    const haystack = `${assistant.name} ${assistant.note}`.toLowerCase();
    return haystack.includes(this.searchKeyword);
  }

  private getGroupDisplayName(group: AssistantGroup, strings: Record<string, string>): string {
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

  private getGroupContextValue(group: AssistantGroup): string {
    if (group.id === DEFAULT_GROUP_ID) {
      return 'chatbuddy.group.default';
    }
    if (group.id === DELETED_GROUP_ID) {
      return 'chatbuddy.group.deleted';
    }
    return 'chatbuddy.group.custom';
  }

  private getAssistantContextValue(assistant: AssistantProfile): string {
    if (assistant.isDeleted) {
      return 'chatbuddy.assistant.deleted';
    }
    if (assistant.pinned) {
      return 'chatbuddy.assistant.pinned';
    }
    return 'chatbuddy.assistant.active';
  }
}
