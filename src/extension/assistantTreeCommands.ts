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
    vscode.commands.registerCommand('chatbuddy.createAssistant', () => {
      assistantEditorPanelController.openCreateAssistantEditor();
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
