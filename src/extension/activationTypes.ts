/**
 * 扩展激活阶段共享的内部类型定义。
 */
import * as vscode from 'vscode';

import type { AssistantsTreeProvider } from '../chatbuddy/assistantsView';
import type { AssistantEditorPanelController } from '../chatbuddy/assistantEditorPanel';
import type { SessionsTreeProvider } from '../chatbuddy/sessionsView';
import type { SettingsCenterPanelController } from '../chatbuddy/settingsCenterPanel';

/** Minimum number of rows in the settings tree view (pads with spacers if needed). */
export const MIN_SETTINGS_VIEW_ROWS = 4;

export type SettingsTreeDataSource = {
  emitter: vscode.EventEmitter<void>;
  provider: vscode.TreeDataProvider<vscode.TreeItem>;
};

export type DataActionResult = {
  notice: string;
  tone: 'success' | 'error';
};

export type ActivationTreeProviders = {
  assistantsTreeProvider: AssistantsTreeProvider;
  recycleBinTreeProvider: AssistantsTreeProvider;
  sessionsTreeProvider: SessionsTreeProvider;
};

export type ActivationTreeViews = {
  assistantsTreeView: vscode.TreeView<unknown>;
  recycleBinTreeView: vscode.TreeView<unknown>;
  sessionsTreeView: vscode.TreeView<unknown>;
  settingsTreeView: vscode.TreeView<unknown>;
};

export type PanelControllers = {
  settingsCenterPanelController: SettingsCenterPanelController;
  assistantEditorPanelController: AssistantEditorPanelController;
};
