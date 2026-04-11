import * as vscode from 'vscode';
import type { ExtensionContext } from './shared';
import { asAssistantNode, asSessionNode } from './shared';

export function registerNavigationCommands(ctx: ExtensionContext): vscode.Disposable[] {
  const { repository, chatController, refreshAll } = ctx;
  return [
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
