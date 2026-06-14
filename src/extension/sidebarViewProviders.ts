/**
 * 侧边栏 WebviewViewProvider 工厂。
 *
 * 创建并注册侧边栏的 Webview View Provider 集合：
 * - settingsViewProvider（阶段 1.3-1.5）
 * - assistantsViewProvider / recycleBinViewProvider（阶段 2.2-2.3）
 * - sessionsViewProvider（阶段 3）
 *
 * 注意：registerWebviewViewProvider 的 options 里设置 retainContextWhenHidden，
 *      避免切换 view 时 webview 被销毁重建（保留滚动位置与状态）。
 *
 * 阶段 2.3：viewType 从临时后缀（*Wv）改回正式名，与 package.json 中
 *          `type:webview` 的 view 配置正式对接。
 * 阶段 3：sessions 从 TreeView 迁移为 Webview View，viewType 使用正式名 chatbuddy.sessionsView。
 */
import * as vscode from 'vscode';
import { buildSidebarHtml } from '../chatbuddy/sidebarViewHtml';
import {
  AssistantsSidebarViewProvider,
  AssistantsSidebarViewProviderDeps
} from '../chatbuddy/sidebarViewAssistants';
import {
  SessionsSidebarViewProvider,
  SessionsSidebarViewProviderDeps
} from '../chatbuddy/sidebarViewSessions';
import type { SidebarViewKind } from '../chatbuddy/sidebarViewTypes';
import {
  SettingsSidebarViewProvider,
  SettingsSidebarViewProviderDeps
} from '../chatbuddy/sidebarViewSettings';

export interface SidebarViewProviders {
  settingsViewProvider: SettingsSidebarViewProvider;
  assistantsViewProvider: AssistantsSidebarViewProvider;
  recycleBinViewProvider: AssistantsSidebarViewProvider;
  sessionsViewProvider: SessionsSidebarViewProvider;
}

/** createSidebarViewProviders 的依赖集合 */
export interface SidebarViewProvidersDeps {
  settings: SettingsSidebarViewProviderDeps;
  assistants: AssistantsSidebarViewProviderDeps;
  sessions: SessionsSidebarViewProviderDeps;
}

/**
 * 创建并注册侧边栏 WebviewViewProvider 集合。
 *
 * @param context 扩展上下文（用于注册 subscription 与获取 extensionUri）
 * @param deps    各 Provider 的依赖
 */
export function createSidebarViewProviders(
  context: vscode.ExtensionContext,
  deps: SidebarViewProvidersDeps
): SidebarViewProviders {
  const extensionUri = context.extensionUri;

  // Settings view
  const settingsViewProvider = new SettingsSidebarViewProvider(
    deps.settings,
    extensionUri,
    (webview) => buildSidebarHtml('settings' as SidebarViewKind, webview)
  );

  // Assistants view（main 模式）
  const assistantsViewProvider = new AssistantsSidebarViewProvider(
    deps.assistants,
    extensionUri,
    (webview) => buildSidebarHtml('assistants' as SidebarViewKind, webview),
    'main'
  );

  // RecycleBin view（recycle 模式）
  const recycleBinViewProvider = new AssistantsSidebarViewProvider(
    deps.assistants,
    extensionUri,
    (webview) => buildSidebarHtml('recycleBin' as SidebarViewKind, webview),
    'recycle'
  );

  // Sessions view
  const sessionsViewProvider = new SessionsSidebarViewProvider(
    deps.sessions,
    extensionUri,
    (webview) => buildSidebarHtml('sessions' as SidebarViewKind, webview)
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('chatbuddy.settingsView', settingsViewProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.registerWebviewViewProvider('chatbuddy.assistantsView', assistantsViewProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.registerWebviewViewProvider('chatbuddy.recycleBinView', recycleBinViewProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.registerWebviewViewProvider('chatbuddy.sessionsView', sessionsViewProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  return { settingsViewProvider, assistantsViewProvider, recycleBinViewProvider, sessionsViewProvider };
}
