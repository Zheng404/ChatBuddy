/**
 * 树视图提供者和视图的创建工厂。
 */
import * as vscode from 'vscode';

import { AssistantsTreeProvider } from '../chatbuddy/assistantsView';
import { SessionsTreeProvider } from '../chatbuddy/sessionsView';
import { ChatStateRepository } from '../chatbuddy/stateRepository';
import {
  ActivationTreeProviders,
  ActivationTreeViews,
  MIN_SETTINGS_VIEW_ROWS,
  SettingsTreeDataSource
} from './activationTypes';

export function createTreeProviders(repository: ChatStateRepository): ActivationTreeProviders {
  const assistantTreeRepository = {
    getGroups: () => repository.getGroups(),
    getAssistants: () => repository.getAssistants(),
    getLocaleSetting: () => repository.getLocaleSetting(),
    isGroupCollapsed: (groupId: string) => repository.getStateShallow().collapsedGroupIds.includes(groupId)
  };

  return {
    assistantsTreeProvider: new AssistantsTreeProvider(assistantTreeRepository, 'main'),
    recycleBinTreeProvider: new AssistantsTreeProvider(assistantTreeRepository, 'recycle'),
    sessionsTreeProvider: new SessionsTreeProvider({
      getSelectedAssistant: () => repository.getSelectedAssistant(),
      getSessionsForAssistant: (assistantId: string) => repository.getSessionsForAssistant(assistantId),
      getSelectedSessionId: (assistantId?: string) => repository.getSelectedSessionId(assistantId),
      getLocaleSetting: () => repository.getLocaleSetting(),
      searchSessionContent: (assistantId: string, keyword: string) => repository.searchSessionContent(assistantId, keyword)
    })
  };
}

export function createTreeViews(args: {
  assistantsTreeProvider: AssistantsTreeProvider;
  recycleBinTreeProvider: AssistantsTreeProvider;
  sessionsTreeProvider: SessionsTreeProvider;
  settingsTreeProvider: vscode.TreeDataProvider<vscode.TreeItem>;
}): ActivationTreeViews {
  const { assistantsTreeProvider, recycleBinTreeProvider, sessionsTreeProvider, settingsTreeProvider } = args;

  return {
    assistantsTreeView: vscode.window.createTreeView('chatbuddy.assistantsView', {
      treeDataProvider: assistantsTreeProvider,
      showCollapseAll: false
    }),
    recycleBinTreeView: vscode.window.createTreeView('chatbuddy.recycleBinView', {
      treeDataProvider: recycleBinTreeProvider,
      showCollapseAll: false
    }),
    sessionsTreeView: vscode.window.createTreeView('chatbuddy.sessionsView', {
      treeDataProvider: sessionsTreeProvider,
      showCollapseAll: false
    }),
    settingsTreeView: vscode.window.createTreeView('chatbuddy.settingsView', {
      treeDataProvider: settingsTreeProvider,
      showCollapseAll: false
    })
  };
}

export function createSettingsTreeDataSource(getRuntimeStrings: () => Record<string, string>): SettingsTreeDataSource {
  const emitter = new vscode.EventEmitter<void>();
  const provider: vscode.TreeDataProvider<vscode.TreeItem> = {
    onDidChangeTreeData: emitter.event,
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
      return element;
    },
    getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
      if (element) {
        return [];
      }
      const strings = getRuntimeStrings();
      const createItem = (
        id: string,
        label: string,
        icon: string,
        command: string,
        tooltip?: string
      ): vscode.TreeItem => {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.id = id;
        item.iconPath = new vscode.ThemeIcon(icon);
        item.command = {
          command,
          title: label
        };
        item.tooltip = tooltip;
        return item;
      };

      const items: vscode.TreeItem[] = [
        createItem('chatbuddy.model-config.open', strings.openModelConfig, 'hubot', 'chatbuddy.openModelConfig', strings.modelConfigDescription),
        createItem(
          'chatbuddy.default-models.open',
          strings.openDefaultModels,
          'symbol-constant',
          'chatbuddy.openDefaultModels',
          strings.defaultModelsDescription
        ),
        createItem(
          'chatbuddy.mcp.open',
          strings.openMcp || strings.mcpTitle || 'MCP',
          'plug',
          'chatbuddy.openMcp',
          strings.mcpDescription
        ),
        createItem(
          'chatbuddy.data-management.open',
          strings.openDataManagement || strings.dataManagementTitle || 'Data',
          'database',
          'chatbuddy.openDataManagement',
          strings.dataManagementDescription
        ),
        createItem(
          'chatbuddy.templates.open',
          strings.openTemplates || strings.navTemplatesTitle || 'Templates',
          'layout',
          'chatbuddy.openTemplates',
          strings.templatesSectionDescription
        ),
        createItem('chatbuddy.settings.open', strings.openSettings, 'settings-gear', 'chatbuddy.openSettings', strings.settingsDescription),
        createItem(
          'chatbuddy.about.open',
          strings.openAbout || strings.aboutTitle || 'About',
          'info',
          'chatbuddy.openAbout',
          strings.aboutDescription
        )
      ];
      for (let index = items.length; index < MIN_SETTINGS_VIEW_ROWS; index += 1) {
        const spacer = new vscode.TreeItem(' ', vscode.TreeItemCollapsibleState.None);
        spacer.id = `chatbuddy.settings.spacer.${index}`;
        spacer.contextValue = 'chatbuddy.view.spacer';
        items.push(spacer);
      }
      return items;
    }
  };

  return { emitter, provider };
}
