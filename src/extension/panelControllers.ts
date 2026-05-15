/**
 * 面板控制器的创建工厂。
 */
import { AssistantsTreeProvider } from '../chatbuddy/assistantsView';
import { AssistantEditorPanelController } from '../chatbuddy/assistantEditorPanel';
import { SettingsCenterPanelController } from '../chatbuddy/settingsCenterPanel';
import { ChatController } from '../chatbuddy/chatController';
import { DEFAULT_GROUP_ID } from '../chatbuddy/constants';
import { McpRuntime } from '../chatbuddy/mcpRuntime';
import { OpenAICompatibleClient } from '../chatbuddy/providerClient';
import { ChatStateRepository } from '../chatbuddy/stateRepository';
import { ChatBuddySettings } from '../chatbuddy/types';
import * as vscode from 'vscode';
import { DataActionResult, PanelControllers } from './activationTypes';

export function createPanelControllers(args: {
  repository: ChatStateRepository;
  providerClient: OpenAICompatibleClient;
  mcpRuntime: McpRuntime;
  chatController: ChatController;
  assistantsTreeProvider: AssistantsTreeProvider;
  assistantsTreeView: vscode.TreeView<unknown>;
  applySettingsAndRefresh: (settings: ChatBuddySettings) => void;
  handleResetData: () => Promise<boolean>;
  handleExportData: () => Promise<DataActionResult | undefined>;
  handleImportData: () => Promise<DataActionResult | undefined>;
  handleImportLegacyData: () => Promise<DataActionResult | undefined>;
  handleSelectiveExportData: (categories: string[]) => Promise<DataActionResult | undefined>;
  getBackupPassword: () => Promise<string | undefined>;
  setBackupPassword: (password: string) => Promise<void>;
  clearBackupPassword: () => Promise<void>;
  onBackupSettingsChanged?: () => void;
  refreshAll: () => void;
  updateTreeMessage: () => void;
  getRuntimeStrings: () => Record<string, string>;
}): PanelControllers {
  const {
    repository,
    providerClient,
    mcpRuntime,
    chatController,
    assistantsTreeProvider,
    assistantsTreeView,
    applySettingsAndRefresh,
    handleResetData,
    handleExportData,
    handleImportData,
    handleImportLegacyData,
    handleSelectiveExportData,
    getBackupPassword,
    setBackupPassword,
    clearBackupPassword,
    onBackupSettingsChanged,
    refreshAll,
    updateTreeMessage,
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
    getBackupPassword,
    setBackupPassword,
    clearBackupPassword,
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
      updateTreeMessage();
      const targetNode = assistantsTreeProvider.findAssistantNode(created.id);
      if (targetNode) {
        void assistantsTreeView.reveal(targetNode, {
          select: true,
          focus: false,
          expand: true
        });
      }
      return created.id;
    }
  );

  return {
    settingsCenterPanelController,
    assistantEditorPanelController
  };
}
