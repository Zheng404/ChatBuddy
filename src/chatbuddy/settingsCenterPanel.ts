import * as vscode from 'vscode';

import { createModelRef, DEFAULT_TITLE_SUMMARY_PROMPT, parseModelRef } from './modelCatalog';
import { getCodiconStyleText } from './codicon';
import { formatString, getLanguageOptions, getStrings } from './i18n';
import { getPanelIconPath } from './panelIcon';
import { McpRuntime } from './mcpRuntime';
import { OpenAICompatibleClient } from './providerClient';
import { ChatStateRepository } from './stateRepository';
import { TOAST_CONTAINER_HTML, getToastScript } from './webviewShared';
import { getSettingsCenterCss } from './settingsCenterStyles';
import { getSettingsCenterJs } from './settingsCenterJs';
import {
  ChatBuddyLocaleSetting,
  ChatBuddySettings,
  ChatSendShortcut,
  ChatTabMode,
  McpServerProfile,
  ProviderModelOption,
  ProviderModelProfile,
  ProviderProfile,
  RuntimeStrings
} from './types';
import { getNonce, getLocaleFromSettings, getSendShortcutOptions, getChatTabModeOptions, normalizeProvider, buildCsp } from './utils';

export type SettingsCenterSection = 'modelConfig' | 'defaultModels' | 'general' | 'mcp';

type SettingsActionResult = {
  notice: string;
  tone?: 'success' | 'error' | 'info';
};

type McpToolRoundsPayload = { maxToolRounds: number };

type SettingsCenterMessage =
  | { type: 'ready' }
  | { type: 'switchSection'; section: SettingsCenterSection }
  | { type: 'saveLocale'; payload: { locale: ChatBuddyLocaleSetting } }
  | { type: 'saveSendShortcut'; payload: { sendShortcut: ChatSendShortcut } }
  | { type: 'saveChatTabMode'; payload: { chatTabMode: ChatTabMode } }
  | { type: 'saveDefaultAssistant'; payload: { assistant: string } }
  | { type: 'saveDefaultTitleSummary'; payload: { titleSummary: string } }
  | { type: 'saveTitleSummaryPrompt'; payload: { titleSummaryPrompt: string } }
  | {
      type: 'saveProvider';
      payload: {
        provider: ProviderProfile;
      };
    }
  | {
      type: 'toggleProviderEnabled';
      payload: {
        providerId: string;
        enabled: boolean;
      };
    }
  | {
      type: 'deleteProvider';
      payload: {
        providerId: string;
        providerName: string;
      };
    }
  | {
      type: 'testConnection';
      payload: {
        provider: ProviderProfile;
        modelId: string;
      };
    }
  | {
      type: 'fetchModels';
      payload: ProviderProfile;
    }
  | { type: 'reset' }
  | { type: 'exportData' }
  | { type: 'importData' }
  | { type: 'saveMcpServers'; payload: McpServerProfile[] }
  | { type: 'saveMcpToolRounds'; payload: McpToolRoundsPayload }
  | { type: 'probeMcpServers' }
  | { type: 'testMcpServer'; payload: { server: McpServerProfile } }
  | {
      type: 'deleteMcpServer';
      payload: {
        serverId: string;
        serverName: string;
      };
    };

type SettingsCenterState = {
  strings: RuntimeStrings;
  activeSection: SettingsCenterSection;
  languageOptions: ReadonlyArray<{ value: ChatBuddyLocaleSetting; label: string }>;
  sendShortcutOptions: ReadonlyArray<{ value: ChatSendShortcut; label: string }>;
  chatTabModeOptions: ReadonlyArray<{ value: ChatTabMode; label: string }>;
  settings: ChatBuddySettings;
  modelOptions: ProviderModelOption[];
  invalidDefaultSelection: string;
  notice?: string;
  noticeTone?: 'success' | 'error' | 'info';
};

type SettingsCenterOutbound =
  | {
      type: 'state';
      payload: SettingsCenterState;
    }
  | {
      type: 'activateSection';
      section: SettingsCenterSection;
    }
  | {
      type: 'connectionResult';
      payload: {
        providerId: string;
        success: boolean;
        message: string;
      };
    }
  | {
      type: 'modelsFetched';
      payload: {
        providerId: string;
        models: ProviderModelProfile[];
        success: boolean;
        message: string;
      };
    }
  | {
      type: 'mcpProbeResult';
      payload: Array<{
        serverId: string;
        success: boolean;
        tools: Array<{ name: string; description: string }>;
        resources: Array<{ name: string; uri: string; description?: string }>;
        prompts: Array<{ name: string; description?: string }>;
        error?: string;
      }>;
    };

function normalizeSection(section: SettingsCenterSection | string | undefined): SettingsCenterSection {
  if (section === 'modelConfig' || section === 'defaultModels' || section === 'general' || section === 'mcp') {
    return section;
  }
  return 'general';
}

function normalizeMcpServers(servers: McpServerProfile[], fallback: ChatBuddySettings): ChatBuddySettings {
  return {
    ...fallback,
    mcp: {
      ...fallback.mcp,
      servers
    }
  };
}

function normalizeMcpToolRounds(input: McpToolRoundsPayload, fallback: ChatBuddySettings): ChatBuddySettings {
  const raw = typeof input.maxToolRounds === 'number' ? input.maxToolRounds : 5;
  return {
    ...fallback,
    mcp: {
      ...fallback.mcp,
      maxToolRounds: Math.max(1, Math.min(20, raw))
    }
  };
}

function toModelRef(value: ChatBuddySettings['defaultModels']['assistant']): string {
  return value ? createModelRef(value.providerId, value.modelId) : '';
}

export class SettingsCenterPanelController {
  private panel: vscode.WebviewPanel | undefined;
  private activeSection: SettingsCenterSection = 'general';

  constructor(
    private readonly repository: ChatStateRepository,
    private readonly providerClient: OpenAICompatibleClient,
    private readonly mcpRuntime: McpRuntime,
    private readonly onSave: (settings: ChatBuddySettings) => void,
    private readonly onReset: () => Promise<boolean> | boolean,
    private readonly onExportData: () => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined,
    private readonly onImportData: () => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined
  ) {}

  public openPanel(section: SettingsCenterSection = 'general'): void {
    this.activeSection = normalizeSection(section);
    if (!this.panel) {
      const strings = this.getStrings();
      this.panel = vscode.window.createWebviewPanel('chatbuddy.settingsCenterPanel', strings.settingsViewTitle, vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true
      });
      this.panel.webview.html = this.getHtml(this.panel.webview);
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((message: SettingsCenterMessage) => {
        void this.handleMessage(message);
      });
      this.updatePanelPresentation();
      this.postState();
      void this.probeAllMcpServers();
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

  private async handleMessage(message: SettingsCenterMessage): Promise<void> {
    if (message.type === 'ready') {
      this.postState();
      return;
    }

    if (message.type === 'switchSection') {
      this.activeSection = normalizeSection(message.section);
      this.updatePanelPresentation();
      return;
    }

    if (message.type === 'saveLocale') {
      const next = { ...this.repository.getSettings(), locale: message.payload.locale };
      this.onSave(next);
      this.postState(this.getStrings().localeSaved, 'success');
      return;
    }

    if (message.type === 'saveSendShortcut') {
      const sendShortcut: ChatSendShortcut = message.payload.sendShortcut === 'ctrlEnter' ? 'ctrlEnter' : 'enter';
      const next: ChatBuddySettings = { ...this.repository.getSettings(), sendShortcut };
      this.onSave(next);
      this.postState(this.getStrings().sendShortcutSaved, 'success');
      return;
    }

    if (message.type === 'saveChatTabMode') {
      const chatTabMode: ChatTabMode = message.payload.chatTabMode === 'multi' ? 'multi' : 'single';
      const next: ChatBuddySettings = { ...this.repository.getSettings(), chatTabMode };
      this.onSave(next);
      this.postState(this.getStrings().chatTabModeSaved, 'success');
      return;
    }

    if (message.type === 'saveDefaultAssistant') {
      const current = this.repository.getSettings();
      this.onSave({
        ...current,
        defaultModels: {
          ...current.defaultModels,
          assistant: parseModelRef(message.payload.assistant.trim())
        }
      });
      this.postState(this.getStrings().defaultAssistantModelSaved, 'success');
      return;
    }

    if (message.type === 'saveDefaultTitleSummary') {
      const current = this.repository.getSettings();
      this.onSave({
        ...current,
        defaultModels: {
          ...current.defaultModels,
          titleSummary: parseModelRef(message.payload.titleSummary.trim()) || undefined
        }
      });
      this.postState(this.getStrings().defaultTitleSummaryModelSaved, 'success');
      return;
    }

    if (message.type === 'saveTitleSummaryPrompt') {
      const current = this.repository.getSettings();
      this.onSave({
        ...current,
        defaultModels: {
          ...current.defaultModels,
          titleSummaryPrompt: message.payload.titleSummaryPrompt.trim() || undefined
        }
      });
      this.postState(this.getStrings().defaultTitleSummaryPromptSaved, 'success');
      return;
    }

    if (message.type === 'saveMcpServers') {
      const current = this.repository.getSettings();
      this.onSave(normalizeMcpServers(message.payload, current));
      this.postState(this.getStrings().mcpSettingsSaved, 'success');
      return;
    }

    if (message.type === 'saveMcpToolRounds') {
      const current = this.repository.getSettings();
      const next = normalizeMcpToolRounds(message.payload, current);
      this.onSave(next);
      this.postState(this.getStrings().mcpSettingsSaved, 'success');
      return;
    }

    if (message.type === 'probeMcpServers') {
      void this.probeAllMcpServers();
      return;
    }

    if (message.type === 'testMcpServer') {
      const server = message.payload.server;
      void this.probeSingleMcpServer(server);
      return;
    }

    if (message.type === 'saveProvider') {
      const provider = normalizeProvider(message.payload.provider);
      const current = this.repository.getSettings();
      const nextProviders = current.providers.map((item) => (item.id === provider.id ? provider : item));
      const providerExists = nextProviders.some((item) => item.id === provider.id);
      if (!providerExists) {
        nextProviders.push(provider);
      }
      this.onSave({
        ...current,
        providers: nextProviders
      });
      this.postState(this.getStrings().providerSaved, 'success');
      return;
    }

    if (message.type === 'toggleProviderEnabled') {
      const providerId = message.payload.providerId.trim();
      if (!providerId) {
        this.postState(this.getStrings().providerIdRequired, 'error');
        return;
      }

      const current = this.repository.getSettings();
      const target = current.providers.find((item) => item.id === providerId);
      if (!target) {
        this.postState();
        return;
      }

      const strings = this.getStrings();
      const enabled = !!message.payload.enabled;
      if (target.enabled === enabled) {
        this.postState();
        return;
      }

      if (!enabled) {
        const confirmDisable = await vscode.window.showWarningMessage(
          formatString(strings.confirmDisableProvider, { name: target.name || providerId }),
          { modal: true },
          strings.disableProviderAction
        );
        if (confirmDisable !== strings.disableProviderAction) {
          return;
        }
      }

      this.onSave({
        ...current,
        providers: current.providers.map((item) => (item.id === providerId ? { ...item, enabled } : item))
      });
      this.postState(
        enabled
          ? formatString(strings.providerEnabledApplied, { name: target.name || providerId })
          : formatString(strings.providerDisabledApplied, { name: target.name || providerId }),
        'success'
      );
      return;
    }

    if (message.type === 'deleteProvider') {
      const providerId = message.payload.providerId.trim();
      const providerName = message.payload.providerName.trim();
      const strings = this.getStrings();
      if (!providerId) {
        this.postState(strings.providerIdRequired, 'error');
        return;
      }

      const confirmDelete = await vscode.window.showWarningMessage(
        formatString(strings.confirmDeleteProvider, {
          name: providerName || providerId
        }),
        { modal: true },
        strings.deleteProviderAction
      );
      if (confirmDelete !== strings.deleteProviderAction) {
        return;
      }

      const current = this.repository.getSettings();
      const nextProviders = current.providers.filter((item) => item.id !== providerId);
      if (nextProviders.length === current.providers.length) {
        this.postState();
        return;
      }

      this.onSave({
        ...current,
        providers: nextProviders
      });
      this.postState(this.getStrings().providerDeleted, 'success');
      return;
    }

    if (message.type === 'deleteMcpServer') {
      const serverId = message.payload.serverId.trim();
      const serverName = message.payload.serverName.trim();
      const strings = this.getStrings();
      if (!serverId) {
        this.postState(strings.mcpServerIdRequired || 'Server ID is required', 'error');
        return;
      }

      const confirmDelete = await vscode.window.showWarningMessage(
        formatString(strings.mcpDeleteConfirm || 'Are you sure you want to delete server "{name}"?', {
          name: serverName || serverId
        }),
        { modal: true },
        strings.mcpDeleteServerAction || 'Delete'
      );
      if (confirmDelete !== (strings.mcpDeleteServerAction || 'Delete')) {
        return;
      }

      const current = this.repository.getSettings();
      const nextServers = current.mcp.servers.filter((item) => item.id !== serverId);
      if (nextServers.length === current.mcp.servers.length) {
        this.postState();
        return;
      }

      this.onSave({
        ...current,
        mcp: {
          ...current.mcp,
          servers: nextServers
        }
      });
      this.postState(strings.mcpServerDeleted || 'MCP server deleted', 'success');
      return;
    }

    if (message.type === 'testConnection') {
      const provider = normalizeProvider(message.payload.provider);
      const strings = this.getStrings();
      const modelId = message.payload.modelId.trim();
      if (!modelId) {
        this.postMessage({
          type: 'connectionResult',
          payload: {
            providerId: provider.id,
            success: false,
            message: strings.providerTestModelRequired
          }
        });
        return;
      }

      try {
        await this.providerClient.testConnection(
          {
            id: provider.id,
            kind: provider.kind,
            name: provider.name,
            apiType: provider.apiType,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            modelId
          },
          this.getLocale()
        );
        this.postMessage({
          type: 'connectionResult',
          payload: {
            providerId: provider.id,
            success: true,
            message: strings.providerConnectionSuccess
          }
        });
      } catch (error) {
        this.postMessage({
          type: 'connectionResult',
          payload: {
            providerId: provider.id,
            success: false,
            message: error instanceof Error ? error.message : strings.unknownError
          }
        });
      }
      return;
    }

    if (message.type === 'fetchModels') {
      const provider = normalizeProvider(message.payload);
      const strings = this.getStrings();
      try {
        const models = await this.providerClient.fetchModels(
          {
            id: provider.id,
            kind: provider.kind,
            name: provider.name,
            apiType: provider.apiType,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl
          },
          this.getLocale()
        );
        this.postMessage({
          type: 'modelsFetched',
          payload: {
            providerId: provider.id,
            models,
            success: true,
            message: strings.providerModelsFetched
          }
        });
      } catch (error) {
        this.postMessage({
          type: 'modelsFetched',
          payload: {
            providerId: provider.id,
            models: provider.models,
            success: false,
            message: error instanceof Error ? error.message : strings.unknownError
          }
        });
      }
      return;
    }

    if (message.type === 'reset') {
      const confirmed = await this.onReset();
      if (confirmed) {
        this.postState(this.getStrings().resetDataDone, 'success');
      }
      return;
    }

    if (message.type === 'exportData') {
      try {
        const result = await this.onExportData();
        if (result?.notice) {
          this.postState(result.notice, result.tone ?? 'success');
        }
      } catch {
        this.postState(this.getStrings().unknownError, 'error');
      }
      return;
    }

    if (message.type === 'importData') {
      try {
        const result = await this.onImportData();
        if (result?.notice) {
          this.postState(result.notice, result.tone ?? 'success');
        }
      } catch {
        this.postState(this.getStrings().unknownError, 'error');
      }
    }
  }

  private getLocale() {
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
    void this.panel?.webview.postMessage(message);
  }

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

  private postState(notice?: string, noticeTone: 'success' | 'error' | 'info' = 'info'): void {
    if (!this.panel) {
      return;
    }

    const strings = this.getStrings();
    const settings = this.repository.getSettings();
    const modelOptions = this.repository.getModelOptions();
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
        notice,
        noticeTone: notice ? noticeTone : undefined
      }
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = buildCsp(webview, nonce);
    const codiconStyle = getCodiconStyleText();

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${codiconStyle}</style>
    <style>${getSettingsCenterCss()}</style>
  </head>
  <body>
    <div class="shell">
      <div class="frame">
        <aside class="settings-nav">
          <div class="nav-heading">
            <h2 class="nav-heading-title" id="navHeading"></h2>
          </div>
          <button class="nav-item" id="navModelConfig" type="button" data-section="modelConfig">
            <span class="nav-item-icon"><span class="codicon codicon-hubot"></span></span>
            <span class="nav-item-content">
              <span class="nav-item-title" id="navModelConfigTitle"></span>
              <span class="nav-item-desc" id="navModelConfigDescription"></span>
            </span>
          </button>
          <button class="nav-item" id="navDefaultModels" type="button" data-section="defaultModels">
            <span class="nav-item-icon"><span class="codicon codicon-symbol-constant"></span></span>
            <span class="nav-item-content">
              <span class="nav-item-title" id="navDefaultModelsTitle"></span>
              <span class="nav-item-desc" id="navDefaultModelsDescription"></span>
            </span>
          </button>
          <button class="nav-item" id="navMcp" type="button" data-section="mcp">
            <span class="nav-item-icon"><span class="codicon codicon-plug"></span></span>
            <span class="nav-item-content">
              <span class="nav-item-title" id="navMcpTitle"></span>
              <span class="nav-item-desc" id="navMcpDescription"></span>
            </span>
          </button>
          <button class="nav-item" id="navGeneral" type="button" data-section="general">
            <span class="nav-item-icon"><span class="codicon codicon-settings-gear"></span></span>
            <span class="nav-item-content">
              <span class="nav-item-title" id="navGeneralTitle"></span>
              <span class="nav-item-desc" id="navGeneralDescription"></span>
            </span>
          </button>
        </aside>

        <main class="settings-content">
          <section class="settings-pane" id="paneModelConfig" data-section="modelConfig">
            <div class="provider-workspace">
              <aside class="provider-nav">
                <div class="toolbar">
                  <button class="btn-primary" id="addProviderBtn" type="button"></button>
                </div>
                <input id="providerSearch" class="provider-search" type="text" />
                <div class="provider-list" id="providerList"></div>
              </aside>

              <section class="editor">
                <section class="panel">
                  <div class="panel-header">
                    <h2 class="panel-title" id="providerPanelTitle"></h2>
                    <div class="panel-actions">
                      <button class="btn-primary" id="saveProviderBtn" type="button"></button>
                      <button class="btn-danger" id="deleteProviderBtn" type="button"></button>
                    </div>
                  </div>
                  <div class="field-grid">
                    <div class="field">
                      <label for="providerName" id="providerNameLabel"></label>
                      <input id="providerName" type="text" />
                    </div>
                    <div class="field">
                      <label for="apiType" id="apiTypeLabel"></label>
                      <select id="apiType">
                        <option value="chat_completions">chat/completions</option>
                        <option value="responses">responses</option>
                      </select>
                    </div>
                    <div class="field full">
                      <label for="apiKey" id="apiKeyLabel"></label>
                      <input id="apiKey" type="password" />
                    </div>
                    <div class="field full">
                      <label for="baseUrl" id="baseUrlLabel"></label>
                      <input id="baseUrl" type="text" />
                      <div class="help" id="baseUrlHelp"></div>
                    </div>
                  </div>
                </section>

                <section class="panel">
                  <div class="panel-header">
                    <h2 class="panel-title" id="modelsPanelTitle"></h2>
                    <div class="panel-actions">
                      <button class="btn-secondary" id="testConnectionBtn" type="button"></button>
                      <button class="btn-secondary" id="fetchModelsBtn" type="button"></button>
                    </div>
                  </div>
                  <div class="help" id="modelsHelp"></div>
                  <div class="models-grid" id="modelsList"></div>
                </section>
              </section>
            </div>
          </section>

          <section class="settings-pane" id="paneDefaultModels" data-section="defaultModels">
            <section class="section-card">
              <div class="field">
                <label for="defaultAssistantModel" id="defaultAssistantModelLabel"></label>
                <select id="defaultAssistantModel"></select>
                <div class="help" id="defaultAssistantModelHelp"></div>
              </div>
            </section>
            <section class="section-card" style="margin-top: 12px;">
              <div class="field">
                <label for="defaultTitleSummaryModel" id="defaultTitleSummaryModelLabel"></label>
                <div style="display:flex;align-items:center;gap:8px;">
                  <select id="defaultTitleSummaryModel" style="flex:1;"></select>
                  <button class="btn-secondary" id="editTitleSummaryPromptBtn" type="button"></button>
                </div>
                <div class="help" id="defaultTitleSummaryModelHelp"></div>
              </div>
            </section>
          </section>

          <section class="settings-pane" id="paneMcp" data-section="mcp">
            <div class="section-grid">
              <section class="section-card">
                <h2 class="section-title" id="mcpMaxToolRoundsTitle"></h2>
                <div style="display:flex;align-items:center;gap:8px;">
                  <input id="mcpMaxToolRounds" type="number" min="1" max="20" />
                  <button class="btn-primary" id="mcpSaveToolRoundsBtn" type="button"></button>
                </div>
                <div class="help" id="mcpMaxToolRoundsHelp"></div>
              </section>

              <section class="section-card">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                  <h2 class="section-title" id="mcpServersTitle" style="margin:0;flex:1"></h2>
                  <button class="btn-primary" id="mcpAddServerBtn" type="button"></button>
                </div>
                <div id="mcpServerList"></div>
              </section>
            </div>
          </section>

          <section class="settings-pane" id="paneGeneral" data-section="general">
            <div class="section-grid">
              <section class="section-card">
                <h2 class="section-title" id="languageSectionTitle"></h2>
                <div class="field">
                  <select id="locale"></select>
                </div>
                <div class="help" id="languageHelp"></div>
              </section>

              <section class="section-card">
                <h2 class="section-title" id="sendShortcutSectionTitle"></h2>
                <div class="field">
                  <select id="sendShortcut"></select>
                </div>
                <div class="help" id="sendShortcutHelp"></div>
              </section>

              <section class="section-card">
                <h2 class="section-title" id="chatTabModeSectionTitle"></h2>
                <div class="field">
                  <select id="chatTabMode"></select>
                </div>
                <div class="help" id="chatTabModeHelp"></div>
              </section>

              <section class="section-card">
                <h2 class="section-title" id="dataTransferSectionTitle"></h2>
                <div class="help" id="dataTransferDescription"></div>
                <div class="data-actions" style="margin-top: 12px;">
                  <button class="btn-secondary" id="exportBtn" type="button"></button>
                  <button class="btn-secondary" id="importBtn" type="button"></button>
                </div>
              </section>

              <section class="section-card">
                <h2 class="section-title" id="dangerSectionTitle"></h2>
                <div class="danger-copy" id="resetDataDescription"></div>
                <div class="danger-actions" style="margin-top: 12px;">
                  <button class="btn-danger" id="resetBtn" type="button"></button>
                </div>
              </section>
            </div>
          </section>
        </main>
      </div>
    </div>

    <div class="modal-backdrop" id="testModelModal" aria-hidden="true">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="testModelModalTitle">
        <h3 class="modal-title" id="testModelModalTitle"></h3>
        <p class="modal-copy" id="testModelModalDescription"></p>
        <div class="field">
          <label for="testModelModalSelect" id="testModelModalLabel"></label>
          <select id="testModelModalSelect"></select>
        </div>
        <div class="panel-actions">
          <button class="btn-secondary" id="cancelTestModelBtn" type="button"></button>
          <button class="btn-primary" id="confirmTestModelBtn" type="button"></button>
        </div>
      </div>
    </div>

    <div class="modal-backdrop" id="discardChangesModal" aria-hidden="true">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="discardChangesModalTitle">
        <h3 class="modal-title" id="discardChangesModalTitle"></h3>
        <p class="modal-copy" id="discardChangesModalDescription"></p>
        <div class="panel-actions">
          <button class="btn-secondary" id="discardChangesStayBtn" type="button"></button>
          <button class="btn-danger" id="discardChangesConfirmBtn" type="button"></button>
        </div>
      </div>
    </div>

    <div class="modal-backdrop" id="mcpServerModal" aria-hidden="true">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="mcpServerModalTitle">
        <h3 class="modal-title" id="mcpServerModalTitle"></h3>
        <p class="modal-copy" id="mcpServerModalDescription"></p>
        <div class="field-grid">
          <div class="field">
            <label for="mcpModalName" id="mcpModalNameLabel"></label>
            <input id="mcpModalName" type="text" />
          </div>
          <div class="field">
            <label for="mcpModalTransport" id="mcpModalTransportLabel"></label>
            <select id="mcpModalTransport">
              <option value="stdio">stdio</option>
              <option value="streamableHttp">streamableHttp</option>
              <option value="sse">sse</option>
            </select>
          </div>
          <div class="field full" id="mcpModalFields"></div>
        </div>
        <div class="panel-actions">
          <button class="btn-secondary" id="mcpModalCancelBtn" type="button"></button>
          <button class="btn-primary" id="mcpModalSaveBtn" type="button"></button>
        </div>
      </div>
    </div>

    <div class="modal-backdrop" id="titleSummaryPromptModal" aria-hidden="true">
      <div class="modal-card" role="dialog" aria-modal="true">
        <h3 class="modal-title" id="titleSummaryPromptModalTitle"></h3>
        <p class="modal-copy" id="titleSummaryPromptModalDescription"></p>
        <div class="field">
          <textarea id="titleSummaryPromptModalTextarea" rows="8"></textarea>
        </div>
        <div class="panel-actions">
          <button class="btn-secondary" id="cancelTitleSummaryPromptBtn" type="button"></button>
          <button class="btn-secondary" id="resetTitleSummaryPromptBtn" type="button"></button>
          <button class="btn-primary" id="saveTitleSummaryPromptBtn" type="button"></button>
        </div>
      </div>
    </div>

${TOAST_CONTAINER_HTML}

    <script nonce="${nonce}">
      ${getSettingsCenterJs(getToastScript(), DEFAULT_TITLE_SUMMARY_PROMPT)}
    </script>
  </body>
</html>`;
  }
}
