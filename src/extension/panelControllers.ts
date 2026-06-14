/**
 * 面板控制器的创建工厂。
 *
 * 阶段 2.3：新建助手后的「滚动到指定助手」由原 TreeView.reveal(node)
 *          改为 AssistantsSidebarViewProvider.scrollToAssistant(id)，
 *          通知 webview 内部滚动到对应条目。
 */
import { AssistantEditorPanelController } from '../chatbuddy/assistantEditorPanel';
import { SettingsCenterPanelController } from '../chatbuddy/settingsCenterPanel';
import { ChatController } from '../chatbuddy/chatController';
import { DEFAULT_GROUP_ID } from '../chatbuddy/constants';
import { McpRuntime } from '../chatbuddy/mcpRuntime';
import { OpenAICompatibleClient } from '../chatbuddy/providerClient';
import { ChatStateRepository } from '../chatbuddy/stateRepository';
import { ChatBuddySettings } from '../chatbuddy/types';
import { DataActionResult, PanelControllers, ActivationSidebarViewProviders } from './activationTypes';

export function createPanelControllers(args: {
  repository: ChatStateRepository;
  providerClient: OpenAICompatibleClient;
  mcpRuntime: McpRuntime;
  chatController: ChatController;
  sidebarViewProviders: ActivationSidebarViewProviders;
  applySettingsAndRefresh: (settings: ChatBuddySettings) => void;
  handleResetData: () => Promise<boolean>;
  handleExportData: () => Promise<DataActionResult | undefined>;
  handleImportData: () => Promise<DataActionResult | undefined>;
  handleImportLegacyData: () => Promise<DataActionResult | undefined>;
  handleSelectiveExportData: (categories: string[]) => Promise<DataActionResult | undefined>;
  onBackupSettingsChanged?: () => void;
  refreshAll: () => void;
  getRuntimeStrings: () => Record<string, string>;
}): PanelControllers {
  const {
    repository,
    providerClient,
    mcpRuntime,
    chatController,
    sidebarViewProviders,
    applySettingsAndRefresh,
    handleResetData,
    handleExportData,
    handleImportData,
    handleImportLegacyData,
    handleSelectiveExportData,
    onBackupSettingsChanged,
    refreshAll,
    getRuntimeStrings
  } = args;

  const settingsCenterPanelController = new SettingsCenterPanelController(
    repository,
    providerClient,
    mcpRuntime,
    applySettingsAndRefresh,
    handleResetData,
    handleExportData,
    handleImportData,
    handleImportLegacyData,
    handleSelectiveExportData,
    onBackupSettingsChanged
  );

  const assistantEditorPanelController = new AssistantEditorPanelController(
    repository,
    (assistantId, patch) => {
      repository.updateAssistant(assistantId, patch);
      chatController.openAssistantChat(assistantId);
      refreshAll();
    },
    (patch) => {
      const strings = getRuntimeStrings();
      const created = repository.createAssistant({
        name: patch.name?.trim() || strings.assistantRole,
        groupId: patch.groupId || DEFAULT_GROUP_ID
      });
      repository.updateAssistant(created.id, patch);
      chatController.openAssistantChat(created.id);
      refreshAll();
      // 通知 assistants webview 滚动到新建助手（替代原 TreeView.reveal）
      sidebarViewProviders.assistantsViewProvider.scrollToAssistant(created.id);
      return created.id;
    }
  );

  return {
    settingsCenterPanelController,
    assistantEditorPanelController
  };
}
