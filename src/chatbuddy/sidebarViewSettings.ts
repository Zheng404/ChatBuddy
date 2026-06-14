/**
 * Settings 侧边栏 WebviewView 的 Host 端 Provider。
 *
 * 从原 TreeView（treeViews.ts 内联 createSettingsTreeDataSource）迁移而来，
 * 负责构造 7 个静态设置条目并推送到 Webview。
 *
 * 消息回路：
 * - Host → Webview：{ type:'state', payload: SettingsViewState }
 * - Webview → Host：{ type:'invokeCommand', command } → 转发执行对应命令
 *   （命令最终调用 settingsCenterPanelController.openPanel(section)，打开设置中心）
 *
 * 与其它 3 个 view 不同：settings 无搜索 / 折叠需求，仅承载静态列表点击。
 */
import * as vscode from 'vscode';
import { BaseSidebarViewProvider } from './sidebarViewBase';
import { SidebarInbound } from './sidebarViewTypes';
import { RuntimeLocale, RuntimeStrings } from './types';

/** 单个设置条目（与前端 settings.ts 约定的数据形状） */
export interface SettingsViewItem {
  id: string;
  label: string;
  icon: string;
  command: string;
  tooltip: string | undefined;
}

/** 推送到前端的全量状态 */
export interface SettingsViewState {
  locale: RuntimeLocale;
  strings: RuntimeStrings;
  items: SettingsViewItem[];
}

/** SettingsSidebarViewProvider 的依赖（由 extension.ts 注入） */
export interface SettingsSidebarViewProviderDeps {
  getLocale: () => RuntimeLocale;
  getStrings: () => RuntimeStrings;
}

export class SettingsSidebarViewProvider extends BaseSidebarViewProvider<SettingsViewState, SidebarInbound> {
  private readonly deps: SettingsSidebarViewProviderDeps;

  constructor(
    deps: SettingsSidebarViewProviderDeps,
    extensionUri: vscode.Uri,
    htmlBuilder: (webview: vscode.Webview) => string
  ) {
    // onReady 时立即推送一次初始状态（前端 ready 握手完成后）
    super(extensionUri, 'chatbuddy.settingsView', htmlBuilder, () =>
      this.postState(this.buildState())
    );
    this.deps = deps;
  }

  /** 构造 7 个静态设置条目（顺序与原 TreeView 保持一致） */
  public buildState(): SettingsViewState {
    const locale = this.deps.getLocale();
    const strings = this.deps.getStrings();
    const items: SettingsViewItem[] = [
      { id: 'chatbuddy.model-config.open', label: strings.openModelConfig, icon: 'hubot', command: 'chatbuddy.openModelConfig', tooltip: strings.modelConfigDescription },
      { id: 'chatbuddy.default-models.open', label: strings.openDefaultModels, icon: 'symbol-constant', command: 'chatbuddy.openDefaultModels', tooltip: strings.defaultModelsDescription },
      { id: 'chatbuddy.mcp.open', label: strings.openMcp, icon: 'plug', command: 'chatbuddy.openMcp', tooltip: strings.mcpDescription },
      { id: 'chatbuddy.data-management.open', label: strings.openDataManagement, icon: 'database', command: 'chatbuddy.openDataManagement', tooltip: strings.dataManagementDescription },
      { id: 'chatbuddy.templates.open', label: strings.openTemplates, icon: 'layout', command: 'chatbuddy.openTemplates', tooltip: strings.templatesSectionDescription },
      { id: 'chatbuddy.settings.open', label: strings.openSettings, icon: 'settings-gear', command: 'chatbuddy.openSettings', tooltip: strings.settingsDescription },
      { id: 'chatbuddy.about.open', label: strings.openAbout, icon: 'info', command: 'chatbuddy.openAbout', tooltip: strings.aboutDescription }
    ];
    return { locale, strings, items };
  }

  /** 处理前端入站消息：仅 invokeCommand 一种 */
  protected handleMessage(message: SidebarInbound): void {
    if (message.type === 'invokeCommand') {
      // 转发执行对应命令（最终打开设置中心对应页面）
      void vscode.commands.executeCommand(message.command, ...(message.args ?? []));
    }
    // settings view 不处理 toggleGroupCollapse / search
  }
}
