/**
 * 助手管理命令注册模块。
 *
 * 注册助手的创建、编辑、删除、置顶、恢复、彻底删除等 CRUD 命令。
 *
 * 阶段 2.3：所有命令 handler 参数从 AssistantNode 改为 assistantId: string，
 *          适配侧边栏 Webview View 直接传 id 的调用模式。
 */
import * as vscode from 'vscode';
import { formatString } from '../chatbuddy/i18n';
import type { ExtensionContext } from './shared';

export function registerAssistantManagementCommands(ctx: ExtensionContext): vscode.Disposable[] {
  const { repository, chatController, assistantEditorPanelController, refreshAll, getRuntimeStrings } = ctx;
  const strings = getRuntimeStrings;

  return [
    vscode.commands.registerCommand('chatbuddy.pinAssistant', (assistantId?: string) => {
      if (!assistantId) { return; }
      repository.toggleAssistantPinned(assistantId);
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.unpinAssistant', (assistantId?: string) => {
      if (!assistantId) { return; }
      repository.toggleAssistantPinned(assistantId);
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.editAssistant', (assistantId?: string) => {
      const id = assistantId ?? repository.getSelectedAssistantId();
      if (!id) { return; }
      const assistant = repository.getAssistantById(id);
      if (!assistant || assistant.isDeleted) {
        void vscode.window.showWarningMessage(strings().assistantEditDeletedBlocked);
        return;
      }
      assistantEditorPanelController.openAssistantEditor(id);
    }),
    vscode.commands.registerCommand('chatbuddy.softDeleteAssistant', async (assistantId?: string) => {
      if (!assistantId) { return; }
      // 前端 webview 已通过 Danger Modal 确认（A 类：侧边栏右键触发）
      repository.softDeleteAssistant(assistantId);
      const remaining = repository.getAssistants().filter((a) => !a.isDeleted);
      const nextId = remaining[0]?.id;
      if (nextId) {
        repository.setSelectedAssistant(nextId);
        chatController.openAssistantChat(nextId);
      } else {
        chatController.openAssistantChat();
      }
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.restoreAssistant', (assistantId?: string) => {
      if (!assistantId) { return; }
      const restored = repository.restoreAssistant(assistantId);
      if (!restored) { return; }
      chatController.openAssistantChat(restored.id);
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.hardDeleteAssistant', async (assistantId?: string) => {
      if (!assistantId) { return; }
      // 前端 webview 已通过 Danger Modal 确认（A 类：侧边栏右键触发）
      chatController.disposePanelForAssistant(assistantId);
      await repository.hardDeleteAssistant(assistantId);
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
      const removedCount = await repository.hardDeleteDeletedAssistants();
      chatController.openAssistantChat();
      refreshAll();
      void vscode.window.showInformationMessage(formatString(strings().recycleBinEmptied, { count: String(removedCount) }));
    })
  ];
}
