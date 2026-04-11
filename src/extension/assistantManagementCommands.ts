import * as vscode from 'vscode';
import { formatString } from '../chatbuddy/i18n';
import type { ExtensionContext } from './shared';
import { asAssistantNode } from './shared';

export function registerAssistantManagementCommands(ctx: ExtensionContext): vscode.Disposable[] {
  const { repository, chatController, assistantEditorPanelController, refreshAll, getRuntimeStrings } = ctx;
  const strings = getRuntimeStrings;

  return [
    vscode.commands.registerCommand('chatbuddy.pinAssistant', (arg?: import('../chatbuddy/assistantsView').AssistantNode) => {
      const node = asAssistantNode(arg);
      if (!node) { return; }
      repository.toggleAssistantPinned(node.assistant.id);
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.unpinAssistant', (arg?: import('../chatbuddy/assistantsView').AssistantNode) => {
      const node = asAssistantNode(arg);
      if (!node) { return; }
      repository.toggleAssistantPinned(node.assistant.id);
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.editAssistant', (arg?: import('../chatbuddy/assistantsView').AssistantNode) => {
      const node = asAssistantNode(arg);
      const assistantId = node?.assistant.id ?? repository.getSelectedAssistantId();
      if (!assistantId) { return; }
      const assistant = repository.getAssistantById(assistantId);
      if (!assistant || assistant.isDeleted) {
        void vscode.window.showWarningMessage(strings().assistantEditDeletedBlocked);
        return;
      }
      assistantEditorPanelController.openAssistantEditor(assistantId);
    }),
    vscode.commands.registerCommand('chatbuddy.softDeleteAssistant', async (arg?: import('../chatbuddy/assistantsView').AssistantNode) => {
      const node = asAssistantNode(arg);
      if (!node) { return; }
      const confirm = await vscode.window.showWarningMessage(
        formatString(strings().confirmDeleteAssistant, { name: node.assistant.name }),
        { modal: true },
        strings().deleteAction
      );
      if (confirm !== strings().deleteAction) { return; }
      repository.softDeleteAssistant(node.assistant.id);
      chatController.openAssistantChat(node.assistant.id);
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.restoreAssistant', (arg?: import('../chatbuddy/assistantsView').AssistantNode) => {
      const node = asAssistantNode(arg);
      if (!node) { return; }
      const restored = repository.restoreAssistant(node.assistant.id);
      if (!restored) { return; }
      chatController.openAssistantChat(restored.id);
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.hardDeleteAssistant', async (arg?: import('../chatbuddy/assistantsView').AssistantNode) => {
      const node = asAssistantNode(arg);
      if (!node) { return; }
      const confirm = await vscode.window.showWarningMessage(
        formatString(strings().confirmHardDeleteAssistant, { name: node.assistant.name }),
        { modal: true },
        strings().hardDeleteAction
      );
      if (confirm !== strings().hardDeleteAction) { return; }
      chatController.disposePanelForAssistant(node.assistant.id);
      repository.hardDeleteAssistant(node.assistant.id);
      chatController.openAssistantChat();
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.emptyRecycleBin', async () => {
      const deletedAssistants = repository.getAssistants().filter((assistant) => assistant.isDeleted);
      if (deletedAssistants.length === 0) {
        void vscode.window.showInformationMessage(strings().recycleBinAlreadyEmpty);
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        formatString(strings().confirmEmptyRecycleBin, { count: String(deletedAssistants.length) }),
        { modal: true },
        strings().emptyRecycleBinAction
      );
      if (confirm !== strings().emptyRecycleBinAction) { return; }
      for (const assistant of deletedAssistants) {
        chatController.disposePanelForAssistant(assistant.id);
      }
      const removedCount = repository.hardDeleteDeletedAssistants();
      chatController.openAssistantChat();
      refreshAll();
      void vscode.window.showInformationMessage(formatString(strings().recycleBinEmptied, { count: String(removedCount) }));
    })
  ];
}
