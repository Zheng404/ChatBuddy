/**
 * 助手树交互命令注册模块。
 *
 * 注册助手树的搜索、折叠、展开、创建分组等交互命令。
 */
import * as vscode from 'vscode';
import { DEFAULT_GROUP_ID, DELETED_GROUP_ID, isLegacyDefaultGroupName } from '../chatbuddy/constants';
import { formatString } from '../chatbuddy/i18n';
import type { ExtensionContext } from './shared';
import { asGroupNode } from './shared';

export function registerAssistantTreeCommands(ctx: ExtensionContext): vscode.Disposable[] {
  const {
    repository,
    assistantEditorPanelController,
    assistantsTreeProvider,
    refreshAll,
    updateTreeMessage,
    getRuntimeStrings
  } = ctx;
  const strings = getRuntimeStrings;

  return [
    vscode.commands.registerCommand('chatbuddy.createAssistant', async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: strings().createAssistantChoiceFromTemplate, value: 'template' },
          { label: strings().createAssistantChoiceNew, value: 'new' }
        ],
        {
          title: strings().createAssistantChoiceTitle,
          ignoreFocusOut: true
        }
      );
      if (!choice) { return; }
      if (choice.value === 'new') {
        assistantEditorPanelController.openCreateAssistantEditor();
        return;
      }
      const templates = repository.getTemplates();
      if (!templates.length) {
        void vscode.window.showInformationMessage(strings().noTemplatesAvailable);
        return;
      }
      const picked = await vscode.window.showQuickPick(
        templates.map((t) => ({
          label: t.name,
          description: t.description || '',
          templateId: t.id
        })),
        {
          placeHolder: strings().templatePickerPlaceholder,
          ignoreFocusOut: true
        }
      );
      if (!picked) { return; }
      const created = repository.createAssistantFromTemplate(picked.templateId);
      if (!created) { return; }
      refreshAll();
      updateTreeMessage();
      assistantEditorPanelController.openAssistantEditor(created.id);
      void vscode.window.showInformationMessage(formatString(strings().templateCreatedAssistant, { name: created.name }));
    }),
    vscode.commands.registerCommand('chatbuddy.createAssistantFromTemplate', async () => {
      const templates = repository.getTemplates();
      if (!templates.length) {
        void vscode.window.showInformationMessage(strings().noTemplatesAvailable);
        return;
      }
      const picked = await vscode.window.showQuickPick(
        templates.map((t) => ({
          label: t.name,
          description: t.description || '',
          templateId: t.id
        })),
        {
          placeHolder: strings().templatePickerPlaceholder,
          ignoreFocusOut: true
        }
      );
      if (!picked) { return; }
      const created = repository.createAssistantFromTemplate(picked.templateId);
      if (!created) { return; }
      refreshAll();
      updateTreeMessage();
      assistantEditorPanelController.openAssistantEditor(created.id);
      void vscode.window.showInformationMessage(formatString(strings().templateCreatedAssistant, { name: created.name }));
    }),
    vscode.commands.registerCommand('chatbuddy.createGroup', async () => {
      const name = await vscode.window.showInputBox({
        prompt: strings().createGroupPrompt,
        ignoreFocusOut: true
      });
      if (!name?.trim()) { return; }
      repository.createGroup(name.trim());
      refreshAll();
      updateTreeMessage();
    }),
    vscode.commands.registerCommand('chatbuddy.searchAssistants', async () => {
      const keyword = await vscode.window.showInputBox({
        prompt: strings().assistantSearchPlaceholder,
        value: assistantsTreeProvider.getSearchKeyword(),
        ignoreFocusOut: true
      });
      if (keyword === undefined) { return; }
      assistantsTreeProvider.setSearchKeyword(keyword);
      updateTreeMessage();
    }),
    vscode.commands.registerCommand('chatbuddy.collapseAllAssistants', () => {
      void vscode.commands.executeCommand('workbench.actions.treeView.chatbuddy.assistantsView.collapseAll');
    }),
    vscode.commands.registerCommand('chatbuddy.clearAssistantSearch', () => {
      assistantsTreeProvider.clearSearchKeyword();
      updateTreeMessage();
    }),
    vscode.commands.registerCommand('chatbuddy.renameGroup', async (arg?: import('../chatbuddy/assistantsView').AssistantGroupNode) => {
      const node = asGroupNode(arg);
      if (!node) { return; }
      if (node.group.id === DELETED_GROUP_ID) {
        void vscode.window.showWarningMessage(strings().groupRenameBlocked);
        return;
      }
      const name = await vscode.window.showInputBox({
        prompt: strings().renameGroupPrompt,
        value:
          node.group.id === DEFAULT_GROUP_ID &&
          (!node.group.name.trim() || (node.group.updatedAt === node.group.createdAt && isLegacyDefaultGroupName(node.group.name)))
            ? strings().defaultGroupName
            : node.group.name,
        ignoreFocusOut: true
      });
      if (!name?.trim()) { return; }
      repository.renameGroup(node.group.id, name.trim());
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.deleteGroup', async (arg?: import('../chatbuddy/assistantsView').AssistantGroupNode) => {
      const node = asGroupNode(arg);
      if (!node) { return; }
      if (node.group.id === DEFAULT_GROUP_ID || node.group.id === DELETED_GROUP_ID) {
        void vscode.window.showWarningMessage(strings().groupDeleteBlocked);
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        formatString(strings().confirmDeleteGroup, { name: node.group.name }),
        { modal: true },
        strings().deleteAction
      );
      if (confirm !== strings().deleteAction) { return; }
      repository.deleteGroup(node.group.id);
      refreshAll();
    })
  ];
}
