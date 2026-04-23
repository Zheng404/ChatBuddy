/**
 * 设置中心面板控制器。
 *
 * 管理设置中心的 WebViewPanel，包含模型配置、默认模型、MCP 设置、
 * 通用设置、公告和关于等多个页面。通过 `postMessage` 与 WebView 双向通信。
 *
 * 类型定义 → settingsTypes.ts
 * 消息处理 → settingsMessageHandler.ts
 * HTML 生成 → settingsHtmlGenerator.ts
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { getProviderModelOptions } from './modelCatalog';
import { getLanguageOptions, getStrings } from './i18n';
import { getPanelIconPath } from './panelIcon';
import { McpRuntime } from './mcpRuntime';
import { OpenAICompatibleClient } from './providerClient';
import { ChatStateRepository } from './stateRepository';
import { mergeModelBindingsIntoProviders } from './stateHelpers';
import {
  SQLITE_MIGRATION_DEPRECATION_START_VERSION,
  SQLITE_MIGRATION_SUPPORT_REMOVAL_VERSION
} from './compassStorage/migrator';
import type {
  ChatBuddySettings,
  McpServerProfile,
  RuntimeLocale,
  RuntimeStrings
} from './types';
import { getLocaleFromSettings, getSendShortcutOptions, getChatTabModeOptions, warn } from './utils';

import type {
  SettingsCenterSection,
  SettingsActionResult,
  SettingsCenterMessage,
  SettingsCenterOutbound
} from './settingsTypes';
import { normalizeSection, toModelRef } from './settingsTypes';
import { getSettingsCenterHtml } from './settingsHtmlGenerator';
import { handleSettingsMessage, type SettingsMessageHandlerDeps } from './settingsMessageHandler';

export type { SettingsCenterSection } from './settingsTypes';

export class SettingsCenterPanelController {
  private panel: vscode.WebviewPanel | undefined;
  private activeSection: SettingsCenterSection = 'general';
  private changelogMarkdownCache: string | undefined;
  private packageMetadataCache:
    | {
        appName: string;
        version: string;
        author: string;
        authorUrl: string;
        publisher: string;
        license: string;
        repositoryUrl: string;
        marketplaceUrl: string;
        openVsxUrl: string;
      }
    | undefined;

  private readonly handlerDeps: SettingsMessageHandlerDeps;

  constructor(
    private readonly repository: ChatStateRepository,
    private readonly providerClient: OpenAICompatibleClient,
    private readonly mcpRuntime: McpRuntime,
    private readonly onSave: (settings: ChatBuddySettings) => void,
    private readonly onReset: () => Promise<boolean> | boolean,
    private readonly onExportData: () => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined,
    private readonly onImportData: () => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined,
    private readonly onImportLegacyData: () => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined
  ) {
    this.handlerDeps = {
      repository: this.repository,
      providerClient: this.providerClient,
      mcpRuntime: this.mcpRuntime,
      onSave: this.onSave,
      onReset: this.onReset,
      onExportData: this.onExportData,
      onImportData: this.onImportData,
      onImportLegacyData: this.onImportLegacyData,
      getLocale: () => this.getLocale(),
      getStrings: () => this.getStrings(),
      postState: (notice, tone) => this.postState(notice, tone),
      postMessage: (msg) => this.postMessage(msg),
      probeAllMcpServers: () => this.probeAllMcpServers(),
      probeSingleMcpServer: (server) => this.probeSingleMcpServer(server)
    };
  }

  public openPanel(section: SettingsCenterSection = 'general'): void {
    this.activeSection = normalizeSection(section);
    if (!this.panel) {
      const strings = this.getStrings();
      this.panel = vscode.window.createWebviewPanel('chatbuddy.settingsCenterPanel', strings.settingsViewTitle, vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true
      });
      this.panel.webview.html = getSettingsCenterHtml(this.panel.webview);
      const messageListener = this.panel.webview.onDidReceiveMessage((message: SettingsCenterMessage) => {
        if (message.type === 'switchSection') {
          this.activeSection = normalizeSection(message.section);
          this.updatePanelPresentation();
          return;
        }
        handleSettingsMessage(message, this.handlerDeps).catch((err) => {
          const name = err instanceof Error ? err.name : '';
          if (name !== 'Canceled' && name !== 'AbortError') {
            warn('Settings center message error:', err);
          }
        });
      });
      this.panel.onDidDispose(() => {
        messageListener.dispose();
        this.panel = undefined;
      });
      this.updatePanelPresentation();
      this.postState();
      void this.probeAllMcpServers().catch(() => {});
      return;
    }

    this.panel.reveal(vscode.ViewColumn.One);
    this.updatePanelPresentation();
    this.postMessage({
      type: 'activateSection',
      section: this.activeSection
    });
  }

  public refresh(): void {
    this.postState();
  }

  // ─── 辅助方法 ─────────────────────────────────────────────────────

  private getLocale(): RuntimeLocale {
    return getLocaleFromSettings(this.repository.getSettings());
  }

  private getStrings(): RuntimeStrings {
    return getStrings(this.getLocale());
  }

  private updatePanelPresentation(): void {
    if (!this.panel) {
      return;
    }
    this.panel.title = this.getStrings().settingsViewTitle;
    this.panel.iconPath = getPanelIconPath('settings-gear');
  }

  private postMessage(message: SettingsCenterOutbound): void {
    void this.panel?.webview.postMessage(message).then(undefined, () => {});
  }

  // ─── MCP 探测 ──────────────────────────────────────────────────────

  private async probeAllMcpServers(): Promise<void> {
    const settings = this.repository.getSettings();
    const enabledServers = settings.mcp.servers.filter((s) => s.enabled);
    const results = await Promise.all(
      enabledServers.map(async (server) => {
        const probe = await this.mcpRuntime.probeServer(server);
        return {
          serverId: server.id,
          success: probe.success,
          tools: probe.tools,
          resources: probe.resources,
          prompts: probe.prompts,
          error: probe.error
        };
      })
    );
    this.postMessage({ type: 'mcpProbeResult', payload: results });
  }

  private async probeSingleMcpServer(server: McpServerProfile): Promise<void> {
    const probe = await this.mcpRuntime.probeServer(server);
    this.postMessage({
      type: 'mcpProbeResult',
      payload: [
        {
          serverId: server.id,
          success: probe.success,
          tools: probe.tools,
          resources: probe.resources,
          prompts: probe.prompts,
          error: probe.error
        }
      ]
    });
  }

  // ─── 状态同步 ──────────────────────────────────────────────────────

  private postState(notice?: string, noticeTone: 'success' | 'error' | 'info' = 'info'): void {
    if (!this.panel) {
      return;
    }

    const strings = this.getStrings();
    const settings = this.repository.getSettings();
    const modelOptions = getProviderModelOptions(
      mergeModelBindingsIntoProviders(settings.providers, [settings.defaultModels.assistant, settings.defaultModels.titleSummary]),
      false,
      strings as unknown as Record<string, string>
    );
    const currentDefaultRef = toModelRef(settings.defaultModels.assistant);
    const invalidDefaultSelection =
      currentDefaultRef && !modelOptions.some((option) => option.ref === currentDefaultRef) ? currentDefaultRef : '';

    this.updatePanelPresentation();
    this.postMessage({
      type: 'state',
      payload: {
        strings,
        activeSection: this.activeSection,
        languageOptions: getLanguageOptions(strings),
        sendShortcutOptions: getSendShortcutOptions(strings),
        chatTabModeOptions: getChatTabModeOptions(strings),
        settings,
        modelOptions,
        invalidDefaultSelection,
        bulletin: {
          deprecationStartVersion: SQLITE_MIGRATION_DEPRECATION_START_VERSION,
          removalVersion: SQLITE_MIGRATION_SUPPORT_REMOVAL_VERSION
        },
        about: this.loadPackageMetadata(),
        changelogMarkdown: this.loadChangelogPreview(),
        notice,
        noticeTone: notice ? noticeTone : undefined,
        backupFiles: []
      }
    });
  }

  // ─── 元数据加载 ────────────────────────────────────────────────────

  private loadPackageMetadata(): {
    appName: string;
    version: string;
    author: string;
    authorUrl: string;
    publisher: string;
    license: string;
    repositoryUrl: string;
    marketplaceUrl: string;
    openVsxUrl: string;
  } {
    if (this.packageMetadataCache) {
      return this.packageMetadataCache;
    }
    const packageJsonPath = path.resolve(__dirname, '../../package.json');
    try {
      const raw = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
        displayName?: string;
        name?: string;
        author?: string | { name?: string; url?: string };
        version?: string;
        publisher?: string;
        license?: string;
        repository?: { url?: string };
      };
      const publisher = raw.publisher || '';
      const packageName = raw.name || '';
      const repositoryUrl = raw.repository?.url || '';
      const authorName =
        typeof raw.author === 'string'
          ? raw.author
          : (typeof raw.author?.name === 'string' ? raw.author.name : '');
      const authorUrl =
        (typeof raw.author === 'object' && typeof raw.author?.url === 'string' ? raw.author.url : '') ||
        this.deriveGithubProfileUrl(repositoryUrl);
      this.packageMetadataCache = {
        appName:
          (typeof raw.displayName === 'string' && raw.displayName.trim() && !raw.displayName.startsWith('%'))
            ? raw.displayName
            : 'ChatBuddy',
        version: raw.version || '',
        author: authorName || publisher,
        authorUrl,
        publisher,
        license: raw.license || '',
        repositoryUrl,
        marketplaceUrl:
          publisher && packageName ? `https://marketplace.visualstudio.com/items?itemName=${publisher}.${packageName}` : '',
        openVsxUrl: publisher && packageName ? `https://open-vsx.org/extension/${publisher}/${packageName}` : ''
      };
    } catch {
      this.packageMetadataCache = {
        appName: 'ChatBuddy',
        version: '',
        author: '',
        authorUrl: '',
        publisher: '',
        license: '',
        repositoryUrl: '',
        marketplaceUrl: '',
        openVsxUrl: ''
      };
    }
    return this.packageMetadataCache;
  }

  private deriveGithubProfileUrl(repositoryUrl: string): string {
    if (!repositoryUrl) {
      return '';
    }
    const normalized = repositoryUrl.trim();
    const match = normalized.match(/github\.com[:/](?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?$/i);
    const owner = match?.groups?.owner;
    return owner ? `https://github.com/${owner}` : '';
  }

  private loadChangelogPreview(): string {
    if (typeof this.changelogMarkdownCache === 'string') {
      return this.changelogMarkdownCache;
    }
    const extRoot = path.resolve(__dirname, '../..');
    const candidates = ['CHANGELOG.md', 'changelog.md'];
    for (const name of candidates) {
      try {
        this.changelogMarkdownCache = fs.readFileSync(path.join(extRoot, name), 'utf-8');
        return this.changelogMarkdownCache;
      } catch {
        // try next candidate
      }
    }
    this.changelogMarkdownCache = '';
    return this.changelogMarkdownCache;
  }
}
