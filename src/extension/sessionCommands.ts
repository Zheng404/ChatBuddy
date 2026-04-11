import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { formatString } from '../chatbuddy/i18n';
import { warn } from '../chatbuddy/utils';
import type { ExtensionContext } from './shared';
import { asSessionNode, getSessionCommandAssistant, getSessionCommandTarget, buildSessionExportFileName, buildSessionExportContent } from './shared';

export function registerSessionCommands(ctx: ExtensionContext): vscode.Disposable[] {
  const { repository, chatController, refreshAll, getRuntimeLocale, getRuntimeStrings } = ctx;
  const strings = getRuntimeStrings;

  return [
    vscode.commands.registerCommand('chatbuddy.createSession', () => {
      chatController.createSessionForSelectedAssistant();
      chatController.openAssistantChat();
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.renameSession', async (arg?: import('../chatbuddy/sessionsView').SessionNode) => {
      const node = asSessionNode(arg);
      const assistant = getSessionCommandAssistant(repository, node);
      if (!assistant) {
        void vscode.window.showInformationMessage(strings().noAssistantSelectedBody);
        return;
      }
      const currentSession = getSessionCommandTarget(repository, assistant.id, node);
      if (!currentSession) {
        void vscode.window.showInformationMessage(strings().noSessionsToRename);
        return;
      }
      const nextTitle = await vscode.window.showInputBox({
        prompt: strings().renameSessionPrompt,
        value: currentSession.title
      });
      if (!nextTitle?.trim()) { return; }
      repository.setSelectedAssistant(assistant.id);
      chatController.renameSessionForSelectedAssistant(currentSession.id, nextTitle.trim());
      chatController.openAssistantChat(assistant.id);
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.deleteSession', async (arg?: import('../chatbuddy/sessionsView').SessionNode) => {
      const node = asSessionNode(arg);
      const assistant = getSessionCommandAssistant(repository, node);
      if (!assistant) {
        void vscode.window.showInformationMessage(strings().noAssistantSelectedBody);
        return;
      }
      const currentSession = getSessionCommandTarget(repository, assistant.id, node);
      if (!currentSession) {
        void vscode.window.showInformationMessage(strings().noSessionsToDelete);
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        formatString(strings().confirmDeleteSession, { title: currentSession.title }),
        { modal: true },
        strings().deleteAction
      );
      if (confirm !== strings().deleteAction) { return; }
      repository.setSelectedAssistant(assistant.id);
      chatController.deleteSessionForSelectedAssistant(currentSession.id);
      chatController.openAssistantChat(assistant.id);
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.exportSession', async (arg?: import('../chatbuddy/sessionsView').SessionNode) => {
      const locale = getRuntimeLocale();
      const node = asSessionNode(arg);
      if (!node) {
        void vscode.window.showInformationMessage(strings().exportSessionSelectHint);
        return;
      }
      const assistant = repository.getAssistantById(node.assistantId);
      if (!assistant) {
        void vscode.window.showInformationMessage(strings().noAssistantSelectedBody);
        return;
      }
      const currentSession = getSessionCommandTarget(repository, assistant.id, node);
      if (!currentSession) {
        void vscode.window.showInformationMessage(strings().noSessionsToExport);
        return;
      }
      const formatPick = await vscode.window.showQuickPick(
        [
          { label: strings().exportFormatJson, format: 'json' as const, extension: 'json' },
          { label: strings().exportFormatMarkdown, format: 'markdown' as const, extension: 'md' },
          { label: strings().exportFormatHtml, format: 'html' as const, extension: 'html' }
        ],
        {
          title: strings().exportSessionAction,
          placeHolder: strings().exportFormatPrompt,
          ignoreFocusOut: true
        }
      );
      if (!formatPick) { return; }
      const fileName = buildSessionExportFileName(currentSession.title || strings().untitledSession, formatPick.extension);
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      const defaultUri = workspaceRoot
        ? vscode.Uri.joinPath(workspaceRoot, fileName)
        : vscode.Uri.file(path.join(os.homedir(), fileName));
      const saveUri = await vscode.window.showSaveDialog({
        saveLabel: strings().exportSessionAction,
        defaultUri,
        filters: { [formatPick.extension.toUpperCase()]: [formatPick.extension] }
      });
      if (!saveUri) { return; }
      try {
        const content = buildSessionExportContent(
          formatPick.format,
          currentSession,
          { id: assistant.id, name: assistant.name },
          locale,
          strings()
        );
        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf8'));
        void vscode.window.showInformationMessage(formatString(strings().exportSessionDone, { path: saveUri.fsPath }));
      } catch (err) {
        warn('Failed to export session:', err);
        void vscode.window.showErrorMessage(strings().exportSessionFailed);
      }
    }),
    vscode.commands.registerCommand('chatbuddy.stopGeneration', () => {
      chatController.stopGeneration('manual');
    }),
    vscode.commands.registerCommand('chatbuddy.clearAllSessions', async () => {
      const assistant = repository.getSelectedAssistant();
      if (!assistant || assistant.isDeleted) {
        void vscode.window.showInformationMessage(strings().noAssistantSelectedBody);
        return;
      }
      const sessions = repository.getSessionsForAssistant(assistant.id);
      if (!sessions.length) {
        void vscode.window.showInformationMessage(strings().noSessionsToClear);
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        formatString(strings().confirmClearAllSessions, { name: assistant.name, count: String(sessions.length) }),
        { modal: true },
        strings().clearAllSessionsAction
      );
      if (confirm !== strings().clearAllSessionsAction) { return; }
      const removedCount = repository.clearSessionsForAssistant(assistant.id);
      chatController.openAssistantChat(assistant.id);
      refreshAll();
      void vscode.window.showInformationMessage(formatString(strings().clearAllSessionsDone, { count: String(removedCount) }));
    })
  ];
}
