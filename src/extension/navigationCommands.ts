/**
 * 导航相关命令注册模块。
 *
 * 注册"问 AI"、打开助手聊天等导航命令。
 */
import * as vscode from 'vscode';
import type { ExtensionContext } from './shared';
import { asAssistantNode, asSessionNode } from './shared';

export function registerNavigationCommands(ctx: ExtensionContext): vscode.Disposable[] {
  const { repository, chatController, refreshAll, getRuntimeStrings } = ctx;
  return [
    vscode.commands.registerCommand('chatbuddy.askAI', async () => {
      const strings = getRuntimeStrings();
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      if (!selectedText.trim()) {
        void vscode.window.showInformationMessage(strings.askAiEmptySelection || strings.noAssistantSelectedBody);
        return;
      }
      const assistant = repository.getSelectedAssistant();
      if (!assistant || assistant.isDeleted) {
        void vscode.window.showInformationMessage(strings.noAssistantSelectedBody);
        return;
      }
      chatController.prefillComposer(selectedText, assistant.id);
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.openAssistantChat', (assistantOrId?: import('../chatbuddy/assistantsView').AssistantNode | string) => {
      const assistantId =
        typeof assistantOrId === 'string'
          ? assistantOrId
          : asAssistantNode(assistantOrId)?.assistant.id;
      chatController.openAssistantChat(assistantId);
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.openSessionChat', (arg?: import('../chatbuddy/sessionsView').SessionNode) => {
      const node = asSessionNode(arg);
      if (!node) { return; }
      repository.setSelectedAssistant(node.assistantId);
      repository.selectSession(node.assistantId, node.session.id);
      chatController.openAssistantChat(node.assistantId);
      refreshAll();
    })
  ];
}
