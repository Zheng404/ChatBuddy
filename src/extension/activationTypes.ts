/**
 * 扩展激活阶段共享的内部类型定义。
 */
import type { AssistantEditorPanelController } from '../chatbuddy/assistantEditorPanel';
import type { SettingsCenterPanelController } from '../chatbuddy/settingsCenterPanel';
import type { AssistantsSidebarViewProvider } from '../chatbuddy/sidebarViewAssistants';
import type { SessionsSidebarViewProvider } from '../chatbuddy/sidebarViewSessions';
import type { SettingsSidebarViewProvider } from '../chatbuddy/sidebarViewSettings';

export type DataActionResult = {
  notice: string;
  tone: 'success' | 'error';
};

/** 侧边栏 Webview View 视图集合（settings / assistants / recycleBin / sessions） */
export type ActivationSidebarViewProviders = {
  settingsViewProvider: SettingsSidebarViewProvider;
  assistantsViewProvider: AssistantsSidebarViewProvider;
  recycleBinViewProvider: AssistantsSidebarViewProvider;
  sessionsViewProvider: SessionsSidebarViewProvider;
};

export type PanelControllers = {
  settingsCenterPanelController: SettingsCenterPanelController;
  assistantEditorPanelController: AssistantEditorPanelController;
};
