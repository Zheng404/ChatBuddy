/**
 * 会话管理命令注册模块。
 *
 * 注册会话的创建、重命名、删除、导出、清空等管理命令。
 *
 * 阶段 2.3：renameSession / deleteSession / exportSession 的参数从 SessionNode
 *          改为 (assistantId, sessionId)，适配 Webview View 调用。
 * 阶段 3：searchSessions / clearSessionSearch 改为转发到
 *          SessionsSidebarViewProvider.focusSearch() / clearSearch()，
 *          搜索框由 webview 内嵌实现。
 */
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { formatString } from '../chatbuddy/i18n';
import { warn } from '../chatbuddy/utils';
import type { ExtensionContext } from './shared';
import { buildSessionExportFileName, buildSessionExportContent } from './shared';

export function registerSessionCommands(ctx: ExtensionContext): vscode.Disposable[] {
  const { repository, chatController, refreshAll, getRuntimeLocale, getRuntimeStrings, sidebarViewProviders } = ctx;
  const strings = getRuntimeStrings;

  return [
    vscode.commands.registerCommand('chatbuddy.searchSessions', () => {
      // 搜索框由 webview 内嵌实现，命令仅负责聚焦搜索框
      sidebarViewProviders.sessionsViewProvider.focusSearch();
    }),
    vscode.commands.registerCommand('chatbuddy.clearSessionSearch', () => {
      sidebarViewProviders.sessionsViewProvider.clearSearch();
    }),
    vscode.commands.registerCommand('chatbuddy.createSession', () => {
      chatController.createSessionForSelectedAssistant();
      chatController.openAssistantChat();
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.renameSession', async (assistantId?: string, sessionId?: string) => {
      if (!assistantId || !sessionId) { return; }
      const assistant = repository.getAssistantById(assistantId);
      if (!assistant) {
        void vscode.window.showInformationMessage(strings().noAssistantSelectedBody);
        return;
      }
      const currentSession = repository.getSessionById(sessionId);
      if (!currentSession || currentSession.assistantId !== assistantId) {
        void vscode.window.showInformationMessage(strings().noSessionsToRename);
        return;
      }
      const nextTitle = await vscode.window.showInputBox({
        prompt: strings().renameSessionPrompt,
        value: currentSession.title
      });
      if (!nextTitle?.trim()) { return; }
      repository.setSelectedAssistant(assistantId);
      chatController.renameSessionForSelectedAssistant(sessionId, nextTitle.trim());
      chatController.openAssistantChat(assistantId);
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.deleteSession', async (assistantId?: string, sessionId?: string) => {
      if (!assistantId || !sessionId) { return; }
      const assistant = repository.getAssistantById(assistantId);
      if (!assistant) {
        void vscode.window.showInformationMessage(strings().noAssistantSelectedBody);
        return;
      }
      const currentSession = repository.getSessionById(sessionId);
      if (!currentSession || currentSession.assistantId !== assistantId) {
        void vscode.window.showInformationMessage(strings().noSessionsToDelete);
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        formatString(strings().confirmDeleteSession, { title: currentSession.title }),
        { modal: true },
        strings().deleteAction
      );
      if (confirm !== strings().deleteAction) { return; }
      repository.setSelectedAssistant(assistantId);
      chatController.deleteSessionForSelectedAssistant(sessionId);
      chatController.openAssistantChat(assistantId);
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.exportSession', async (assistantId?: string, sessionId?: string) => {
      const locale = getRuntimeLocale();
      if (!assistantId || !sessionId) {
        void vscode.window.showInformationMessage(strings().exportSessionSelectHint);
        return;
      }
      const assistant = repository.getAssistantById(assistantId);
      if (!assistant) {
        void vscode.window.showInformationMessage(strings().noAssistantSelectedBody);
        return;
      }
      const currentSession = repository.getSessionById(sessionId);
      if (!currentSession || currentSession.assistantId !== assistantId) {
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
    vscode.commands.registerCommand('chatbuddy.regenerateReply', () => {
      chatController.regenerateReply();
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
