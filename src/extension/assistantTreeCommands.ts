/**
 * 助手树交互命令注册模块。
 *
 * 注册助手树的搜索、折叠、展开、创建分组等交互命令。
 *
 * 阶段 2.3：assistants / recycleBin 已迁移为 Webview View，
 *          搜索 / 折叠 / 聚焦等命令改为转发到 AssistantsSidebarViewProvider。
 */
import * as vscode from 'vscode';
import { DEFAULT_GROUP_ID, DELETED_GROUP_ID, isLegacyDefaultGroupName } from '../chatbuddy/constants';
import { formatString } from '../chatbuddy/i18n';
import type { ExtensionContext } from './shared';

export function registerAssistantTreeCommands(ctx: ExtensionContext): vscode.Disposable[] {
  const {
    repository,
    assistantEditorPanelController,
    sidebarViewProviders,
    refreshAll,
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
    }),
    vscode.commands.registerCommand('chatbuddy.searchAssistants', () => {
      // 搜索框由 webview 内嵌实现，命令仅负责聚焦搜索框
      sidebarViewProviders.assistantsViewProvider.focusSearch();
    }),
    vscode.commands.registerCommand('chatbuddy.collapseAllAssistants', () => {
      sidebarViewProviders.assistantsViewProvider.collapseAll();
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.clearAssistantSearch', () => {
      sidebarViewProviders.assistantsViewProvider.clearSearch();
    }),
    vscode.commands.registerCommand('chatbuddy.renameGroup', async (groupId?: string) => {
      if (!groupId) { return; }
      if (groupId === DELETED_GROUP_ID) {
        void vscode.window.showWarningMessage(strings().groupRenameBlocked);
        return;
      }
      const group = repository.getGroups().find((g) => g.id === groupId);
      if (!group) { return; }
      const name = await vscode.window.showInputBox({
        prompt: strings().renameGroupPrompt,
        value:
          group.id === DEFAULT_GROUP_ID &&
          (!group.name.trim() || (group.updatedAt === group.createdAt && isLegacyDefaultGroupName(group.name)))
            ? strings().defaultGroupName
            : group.name,
        ignoreFocusOut: true
      });
      if (!name?.trim()) { return; }
      repository.renameGroup(group.id, name.trim());
      refreshAll();
    }),
    vscode.commands.registerCommand('chatbuddy.deleteGroup', async (groupId?: string) => {
      if (!groupId) { return; }
      if (groupId === DEFAULT_GROUP_ID || groupId === DELETED_GROUP_ID) {
        void vscode.window.showWarningMessage(strings().groupDeleteBlocked);
        return;
      }
      const group = repository.getGroups().find((g) => g.id === groupId);
      const groupName = group?.name ?? groupId;
      const confirm = await vscode.window.showWarningMessage(
        formatString(strings().confirmDeleteGroup, { name: groupName }),
        { modal: true },
        strings().deleteAction
      );
      if (confirm !== strings().deleteAction) { return; }
      repository.deleteGroup(groupId);
      refreshAll();
    })
  ];
}
