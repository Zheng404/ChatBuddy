import * as vscode from 'vscode';

import { createModelRef, dedupeModels, normalizeApiType, parseModelRef } from './modelCatalog';
import { formatString, getLanguageOptions, getStrings, resolveLocale } from './i18n';
import { getPanelIconPath } from './panelIcon';
import { McpRuntime } from './mcpRuntime';
import { OpenAICompatibleClient } from './providerClient';
import { ChatStateRepository } from './stateRepository';
import { SHARED_TOAST_STYLE } from './toastTheme';
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

export type SettingsCenterSection = 'modelConfig' | 'defaultModels' | 'general' | 'mcp';

type SettingsActionResult = {
  notice: string;
  tone?: 'success' | 'error' | 'info';
};

type GeneralSettingsPayload = {
  locale: ChatBuddyLocaleSetting;
  sendShortcut: ChatSendShortcut;
  chatTabMode: ChatTabMode;
};

type McpToolRoundsPayload = { maxToolRounds: number };

type SettingsCenterMessage =
  | { type: 'ready' }
  | { type: 'switchSection'; section: SettingsCenterSection }
  | {
      type: 'saveGeneral';
      payload: GeneralSettingsPayload;
    }
  | {
      type: 'saveDefaultModels';
      payload: {
        assistant: string;
      };
    }
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
  | { type: 'testMcpServer'; payload: { server: McpServerProfile } };

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

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let index = 0; index < 32; index += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function normalizeSection(section: SettingsCenterSection | string | undefined): SettingsCenterSection {
  if (section === 'modelConfig' || section === 'defaultModels' || section === 'general' || section === 'mcp') {
    return section;
  }
  return 'general';
}

function normalizeGeneralSettings(input: GeneralSettingsPayload, fallback: ChatBuddySettings): ChatBuddySettings {
  return {
    ...fallback,
    locale: input.locale,
    sendShortcut: input.sendShortcut === 'ctrlEnter' ? 'ctrlEnter' : 'enter',
    chatTabMode: input.chatTabMode === 'multi' ? 'multi' : 'single'
  };
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

function normalizeDefaultModels(assistantRef: string, fallback: ChatBuddySettings): ChatBuddySettings {
  return {
    ...fallback,
    defaultModels: {
      assistant: parseModelRef(assistantRef.trim())
    }
  };
}

function normalizeProvider(provider: ProviderProfile): ProviderProfile {
  const normalizedKind =
    provider.kind === 'openai' ||
    provider.kind === 'gemini' ||
    provider.kind === 'openrouter' ||
    provider.kind === 'ollama'
      ? provider.kind
      : 'custom';
  return {
    id: provider.id.trim(),
    kind: normalizedKind,
    name: provider.name.trim(),
    apiKey: provider.apiKey.trim(),
    baseUrl: provider.baseUrl.trim(),
    apiType: normalizeApiType(provider.apiType),
    enabled: provider.enabled !== false,
    models: dedupeModels(provider.models ?? []),
    modelLastSyncedAt: typeof provider.modelLastSyncedAt === 'number' ? provider.modelLastSyncedAt : undefined
  };
}

function getSendShortcutOptions(strings: RuntimeStrings): ReadonlyArray<{ value: ChatSendShortcut; label: string }> {
  return [
    { value: 'enter', label: strings.sendShortcutEnter },
    { value: 'ctrlEnter', label: strings.sendShortcutCtrlEnter }
  ] as const;
}

function getChatTabModeOptions(strings: RuntimeStrings): ReadonlyArray<{ value: ChatTabMode; label: string }> {
  return [
    { value: 'single', label: strings.chatTabModeSingle },
    { value: 'multi', label: strings.chatTabModeMulti }
  ] as const;
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

    if (message.type === 'saveGeneral') {
      const next = normalizeGeneralSettings(message.payload, this.repository.getSettings());
      this.onSave(next);
      this.postState(this.getStrings().settingsSaved, 'success');
      return;
    }

    if (message.type === 'saveDefaultModels') {
      const next = normalizeDefaultModels(message.payload.assistant, this.repository.getSettings());
      this.onSave(next);
      this.postState(this.getStrings().defaultModelsSaved, 'success');
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
    return resolveLocale(this.repository.getSettings().locale, vscode.env.language);
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
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        --bg: var(--vscode-editor-background);
        --fg: var(--vscode-editor-foreground);
        --muted: var(--vscode-descriptionForeground);
        --border: var(--vscode-panel-border);
        --input-bg: var(--vscode-input-background);
        --input-fg: var(--vscode-input-foreground);
        --input-border: var(--vscode-input-border, var(--vscode-panel-border));
        --button-bg: var(--vscode-button-background);
        --button-fg: var(--vscode-button-foreground);
        --button-hover: var(--vscode-button-hoverBackground);
        --panel-bg: color-mix(in srgb, var(--bg) 92%, white 8%);
        --panel-bg-strong: color-mix(in srgb, var(--bg) 86%, white 14%);
        --accent: var(--vscode-focusBorder, var(--vscode-button-background));
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 18px;
        background: var(--bg);
        color: var(--fg);
        font-family: var(--vscode-font-family);
      }

      button,
      input,
      select {
        font: inherit;
      }

      .shell {
        max-width: 1380px;
        margin: 0 auto;
      }

      .page-header {
        margin-bottom: 16px;
      }

      .page-title {
        margin: 0;
        font-size: 24px;
        font-weight: 700;
      }

      .page-description {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.6;
      }

      .frame {
        border: 1px solid var(--border);
        border-radius: 14px;
        overflow: hidden;
        display: grid;
        grid-template-columns: 260px minmax(0, 1fr);
        min-height: 720px;
        background: var(--panel-bg);
      }

      .settings-nav {
        border-right: 1px solid var(--border);
        background: color-mix(in srgb, var(--bg) 96%, white 4%);
        padding: 16px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .nav-heading {
        padding: 4px 6px 10px;
      }

      .nav-heading-title {
        margin: 0;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .nav-item {
        width: 100%;
        border: 1px solid transparent;
        border-radius: 12px;
        background: transparent;
        color: inherit;
        text-align: left;
        padding: 12px;
        cursor: pointer;
        display: grid;
        gap: 6px;
      }

      .nav-item:hover {
        background: var(--panel-bg-strong);
      }

      .nav-item.active {
        background: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
        border-color: color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 75%, white 25%);
      }

      .nav-item-title {
        font-size: 13px;
        font-weight: 700;
      }

      .nav-item-desc {
        font-size: 11px;
        line-height: 1.5;
        color: inherit;
        opacity: 0.8;
      }

      .settings-content {
        min-width: 0;
        padding: 16px;
      }

      .settings-pane {
        display: none;
      }

      .settings-pane.active {
        display: block;
      }

      .pane-toolbar {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-bottom: 12px;
      }

      .primary-btn,
      .secondary-btn,
      .ghost-btn,
      .danger-btn,
      .action-btn {
        border: 1px solid transparent;
        border-radius: 8px;
        padding: 8px 14px;
        background: var(--button-bg);
        color: var(--button-fg);
        cursor: pointer;
        white-space: nowrap;
      }

      .primary-btn:hover,
      .secondary-btn:hover,
      .ghost-btn:hover,
      .danger-btn:hover,
      .action-btn:hover {
        background: var(--button-hover);
      }

      .secondary-btn,
      .ghost-btn {
        background: transparent;
        color: var(--fg);
        border-color: var(--input-border);
      }

      .danger-btn {
        background: transparent;
        color: var(--vscode-inputValidation-errorForeground, var(--fg));
        border-color: var(--vscode-inputValidation-errorBorder, #be1100);
      }

      .section-grid {
        display: grid;
        gap: 16px;
      }

      .section-card,
      .panel {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 16px;
        background: color-mix(in srgb, var(--bg) 96%, white 4%);
      }

      .section-title,
      .panel-title {
        margin: 0 0 12px;
        font-size: 13px;
        font-weight: 700;
      }

      .field-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .field.full {
        grid-column: 1 / -1;
      }

      label {
        font-size: 12px;
        color: var(--muted);
      }

      input,
      select {
        width: 100%;
        border: 1px solid var(--input-border);
        border-radius: 8px;
        padding: 9px 10px;
        background: var(--input-bg);
        color: var(--input-fg);
      }

      .help {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.55;
      }

      .help.invalid {
        color: var(--vscode-inputValidation-errorForeground, #be1100);
      }

      .data-actions,
      .danger-actions,
      .panel-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .danger-copy {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }

      .provider-workspace {
        border: 1px solid var(--border);
        border-radius: 12px;
        overflow: hidden;
        min-height: 620px;
        display: grid;
        grid-template-columns: 300px minmax(0, 1fr);
        background: color-mix(in srgb, var(--bg) 96%, white 4%);
      }

      .provider-nav {
        border-right: 1px solid var(--border);
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-height: 0;
      }

      .toolbar {
        display: flex;
        gap: 8px;
      }

      .provider-search {
        width: 100%;
        border: 1px solid var(--input-border);
        border-radius: 8px;
        padding: 8px 10px;
        background: var(--input-bg);
        color: var(--input-fg);
      }

      .provider-list {
        min-height: 0;
        overflow-y: auto;
        display: grid;
        gap: 6px;
      }

      .provider-item {
        border: 1px solid var(--border);
        border-radius: 10px;
        background: transparent;
        color: inherit;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        padding: 8px 10px;
      }

      .provider-item:hover {
        background: var(--panel-bg-strong);
      }

      .provider-item.active {
        background: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
      }

      .provider-item-main {
        border: 0;
        background: transparent;
        color: inherit;
        text-align: left;
        padding: 0;
        cursor: pointer;
        min-width: 0;
      }

      .provider-item-name {
        font-size: 12px;
        font-weight: 700;
      }

      .provider-item-meta {
        margin-top: 4px;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 11px;
      }

      .provider-item-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--muted);
      }

      .provider-item-toggle input {
        width: 14px;
        height: 14px;
        margin: 0;
      }

      .pill {
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 1px 8px;
      }

      .pill.off {
        color: var(--muted);
      }

      .editor {
        min-width: 0;
        padding: 16px;
        display: grid;
        gap: 14px;
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }

      .models-grid {
        display: grid;
        gap: 8px;
        max-height: 300px;
        overflow-y: auto;
      }

      .model-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 8px 10px;
      }

      .model-row input {
        width: 14px;
        height: 14px;
        margin-top: 2px;
      }

      .model-meta {
        min-width: 0;
      }

      .model-name {
        font-size: 12px;
        font-weight: 600;
      }

      .model-desc {
        margin-top: 2px;
        color: var(--muted);
        font-size: 11px;
      }

      .model-caps {
        margin-top: 4px;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
      }

      .cap-pill {
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 0 6px;
        font-size: 10px;
        line-height: 16px;
        color: var(--muted);
        opacity: 0.42;
        cursor: pointer;
        user-select: none;
      }

      .cap-pill:hover {
        opacity: 0.75;
      }

      .cap-pill.active {
        opacity: 1;
      }

      .cap-pill.active.cap-vision { border-color: #3b82f6; color: #3b82f6; }
      .cap-pill.active.cap-reasoning { border-color: #a855f7; color: #a855f7; }
      .cap-pill.active.cap-audio { border-color: #f59e0b; color: #f59e0b; }
      .cap-pill.active.cap-video { border-color: #10b981; color: #10b981; }
      .cap-pill.active.cap-tools { border-color: #6b7280; color: #6b7280; }

      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: color-mix(in srgb, var(--bg) 48%, black 52%);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        z-index: 999;
      }

      .modal-backdrop.visible {
        display: flex;
      }

      .modal-card {
        width: min(520px, 100%);
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--bg);
        padding: 16px;
        display: grid;
        gap: 12px;
      }

      .modal-title {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
      }

      .modal-copy {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
      }

${SHARED_TOAST_STYLE}

      @media (max-width: 1120px) {
        .frame {
          grid-template-columns: 1fr;
        }

        .settings-nav {
          border-right: 0;
          border-bottom: 1px solid var(--border);
        }

        .provider-workspace {
          grid-template-columns: 1fr;
        }

        .provider-nav {
          border-right: 0;
          border-bottom: 1px solid var(--border);
          max-height: 280px;
        }
      }

      @media (max-width: 760px) {
        body {
          padding: 14px;
        }

        .field-grid {
          grid-template-columns: 1fr;
        }

        .settings-content {
          padding: 12px;
        }
      }
      .mcp-server-card {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px;
        margin-bottom: 8px;
        background: transparent;
      }

      .mcp-server-card-row {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .mcp-server-name-display {
        font-size: 13px;
        font-weight: 700;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      .mcp-server-actions {
        display: flex;
        gap: 6px;
        align-items: center;
        flex-shrink: 0;
      }

      .mcp-action-btn {
        border: 1px solid var(--input-border);
        border-radius: 6px;
        padding: 3px 8px;
        background: transparent;
        color: var(--fg);
        cursor: pointer;
        font-size: 11px;
        white-space: nowrap;
      }

      .mcp-action-btn:hover {
        background: var(--panel-bg-strong);
      }

      .mcp-action-btn.danger {
        color: var(--vscode-inputValidation-errorForeground, var(--fg));
        border-color: var(--vscode-inputValidation-errorBorder, #be1100);
      }

      .mcp-status-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--muted);
        vertical-align: middle;
        margin-right: 4px;
      }

      .mcp-status-dot.mcp-status-ok {
        background: #22c55e;
      }

      .mcp-status-dot.mcp-status-fail {
        background: var(--vscode-inputValidation-errorBorder, #be1100);
      }

      .mcp-tool-count {
        font-size: 11px;
        color: var(--muted);
        cursor: pointer;
        white-space: nowrap;
        padding: 0 2px;
      }

      .mcp-tool-count:hover {
        text-decoration: underline;
      }

      .mcp-tools-section {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid var(--border);
      }

      .mcp-tools-header {
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--fg);
        background: transparent;
        border: 0;
        padding: 0;
        width: 100%;
      }

      .mcp-tools-header:hover {
        text-decoration: underline;
      }

      .mcp-tools-list {
        margin-top: 6px;
        font-size: 11px;
        color: var(--muted);
        line-height: 1.6;
      }

      .mcp-tools-list .tool-entry {
        padding: 2px 0;
      }

      .mcp-tools-list .tool-name {
        font-weight: 600;
        color: var(--fg);
      }

      .mcp-modal-field-grid {
        display: grid;
        gap: 10px;
      }

      .mcp-kv-row {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      .mcp-kv-row input {
        flex: 1;
        min-width: 0;
      }

      .mcp-kv-remove {
        border: 1px solid var(--input-border);
        border-radius: 6px;
        padding: 3px 8px;
        background: transparent;
        color: var(--fg);
        cursor: pointer;
        font-size: 11px;
        white-space: nowrap;
      }

      .mcp-kv-remove:hover {
        background: var(--panel-bg-strong);
      }

      .mcp-add-row-btn {
        border: 1px dashed var(--input-border);
        border-radius: 6px;
        padding: 4px 10px;
        background: transparent;
        color: var(--muted);
        cursor: pointer;
        font-size: 11px;
      }

      .mcp-add-row-btn:hover {
        color: var(--fg);
      }

      .mcp-server-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--muted);
      }

      .mcp-server-toggle input {
        width: 14px;
        height: 14px;
        margin: 0;
      }

    </style>
  </head>
  <body>
    <div class="shell">
      <div class="page-header">
        <h1 class="page-title" id="pageTitle"></h1>
        <p class="page-description" id="pageDescription"></p>
      </div>

      <div class="frame">
        <aside class="settings-nav">
          <div class="nav-heading">
            <h2 class="nav-heading-title" id="navHeading"></h2>
          </div>
          <button class="nav-item" id="navModelConfig" type="button" data-section="modelConfig">
            <span class="nav-item-title" id="navModelConfigTitle"></span>
            <span class="nav-item-desc" id="navModelConfigDescription"></span>
          </button>
          <button class="nav-item" id="navDefaultModels" type="button" data-section="defaultModels">
            <span class="nav-item-title" id="navDefaultModelsTitle"></span>
            <span class="nav-item-desc" id="navDefaultModelsDescription"></span>
          </button>
          <button class="nav-item" id="navGeneral" type="button" data-section="general">
            <span class="nav-item-title" id="navGeneralTitle"></span>
            <span class="nav-item-desc" id="navGeneralDescription"></span>
          </button>
          <button class="nav-item" id="navMcp" type="button" data-section="mcp">
            <span class="nav-item-title" id="navMcpTitle"></span>
            <span class="nav-item-desc" id="navMcpDescription"></span>
          </button>
        </aside>

        <main class="settings-content">
          <section class="settings-pane" id="paneModelConfig" data-section="modelConfig">
            <div class="provider-workspace">
              <aside class="provider-nav">
                <div class="toolbar">
                  <button class="action-btn" id="addProviderBtn" type="button"></button>
                </div>
                <input id="providerSearch" class="provider-search" type="text" />
                <div class="provider-list" id="providerList"></div>
              </aside>

              <section class="editor">
                <section class="panel">
                  <div class="panel-header">
                    <h2 class="panel-title" id="providerPanelTitle"></h2>
                    <div class="panel-actions">
                      <button class="action-btn" id="saveProviderBtn" type="button"></button>
                      <button class="danger-btn" id="deleteProviderBtn" type="button"></button>
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
                      <button class="ghost-btn" id="testConnectionBtn" type="button"></button>
                      <button class="ghost-btn" id="fetchModelsBtn" type="button"></button>
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
          </section>

          <section class="settings-pane" id="paneMcp" data-section="mcp">
            <div class="section-grid">
              <section class="section-card">
                <h2 class="section-title" id="mcpMaxToolRoundsTitle"></h2>
                <div class="field">
                  <label for="mcpMaxToolRounds" id="mcpMaxToolRoundsLabel"></label>
                  <input id="mcpMaxToolRounds" type="number" min="1" max="20" />
                </div>
                <div class="help" id="mcpMaxToolRoundsHelp"></div>
                <div style="margin-top: 8px;">
                  <button class="primary-btn" id="mcpSaveToolRoundsBtn" type="button"></button>
                </div>
              </section>

              <section class="section-card">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                  <h2 class="section-title" id="mcpServersTitle" style="margin:0;flex:1"></h2>
                  <button class="primary-btn" id="mcpAddServerBtn" type="button"></button>
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
                  <label for="locale" id="languageLabel"></label>
                  <select id="locale"></select>
                </div>
                <div class="help" id="languageHelp"></div>
              </section>

              <section class="section-card">
                <h2 class="section-title" id="sendShortcutSectionTitle"></h2>
                <div class="field">
                  <label for="sendShortcut" id="sendShortcutLabel"></label>
                  <select id="sendShortcut"></select>
                </div>
                <div class="help" id="sendShortcutHelp"></div>
              </section>

              <section class="section-card">
                <h2 class="section-title" id="chatTabModeSectionTitle"></h2>
                <div class="field">
                  <label for="chatTabMode" id="chatTabModeLabel"></label>
                  <select id="chatTabMode"></select>
                </div>
                <div class="help" id="chatTabModeHelp"></div>
              </section>

              <section class="section-card">
                <h2 class="section-title" id="dataTransferSectionTitle"></h2>
                <div class="help" id="dataTransferDescription"></div>
                <div class="data-actions" style="margin-top: 12px;">
                  <button class="secondary-btn" id="exportBtn" type="button"></button>
                  <button class="secondary-btn" id="importBtn" type="button"></button>
                </div>
              </section>

              <section class="section-card">
                <h2 class="section-title" id="dangerSectionTitle"></h2>
                <div class="danger-copy" id="resetDataDescription"></div>
                <div class="danger-actions" style="margin-top: 12px;">
                  <button class="danger-btn" id="resetBtn" type="button"></button>
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
          <button class="ghost-btn" id="cancelTestModelBtn" type="button"></button>
          <button class="action-btn" id="confirmTestModelBtn" type="button"></button>
        </div>
      </div>
    </div>

    <div class="modal-backdrop" id="discardChangesModal" aria-hidden="true">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="discardChangesModalTitle">
        <h3 class="modal-title" id="discardChangesModalTitle"></h3>
        <p class="modal-copy" id="discardChangesModalDescription"></p>
        <div class="panel-actions">
          <button class="ghost-btn" id="discardChangesStayBtn" type="button"></button>
          <button class="danger-btn" id="discardChangesConfirmBtn" type="button"></button>
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
          <button class="ghost-btn" id="mcpModalCancelBtn" type="button"></button>
          <button class="action-btn" id="mcpModalSaveBtn" type="button"></button>
        </div>
      </div>
    </div>

    <div class="modal-backdrop" id="mcpDeleteConfirmModal" aria-hidden="true">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="mcpDeleteConfirmTitle">
        <h3 class="modal-title" id="mcpDeleteConfirmTitle"></h3>
        <p class="modal-copy" id="mcpDeleteConfirmDescription"></p>
        <div class="panel-actions">
          <button class="ghost-btn" id="mcpDeleteCancelBtn" type="button"></button>
          <button class="danger-btn" id="mcpDeleteConfirmBtn" type="button"></button>
        </div>
      </div>
    </div>

    <div class="toast-stack" id="toastStack" aria-live="polite" aria-atomic="false"></div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const dom = {
        pageTitle: document.getElementById('pageTitle'),
        pageDescription: document.getElementById('pageDescription'),
        navHeading: document.getElementById('navHeading'),
        navModelConfig: document.getElementById('navModelConfig'),
        navModelConfigTitle: document.getElementById('navModelConfigTitle'),
        navModelConfigDescription: document.getElementById('navModelConfigDescription'),
        navDefaultModels: document.getElementById('navDefaultModels'),
        navDefaultModelsTitle: document.getElementById('navDefaultModelsTitle'),
        navDefaultModelsDescription: document.getElementById('navDefaultModelsDescription'),
        navGeneral: document.getElementById('navGeneral'),
        navGeneralTitle: document.getElementById('navGeneralTitle'),
        navGeneralDescription: document.getElementById('navGeneralDescription'),
        paneModelConfig: document.getElementById('paneModelConfig'),
        paneDefaultModels: document.getElementById('paneDefaultModels'),
        paneGeneral: document.getElementById('paneGeneral'),
        languageSectionTitle: document.getElementById('languageSectionTitle'),
        languageLabel: document.getElementById('languageLabel'),
        languageHelp: document.getElementById('languageHelp'),
        sendShortcutSectionTitle: document.getElementById('sendShortcutSectionTitle'),
        sendShortcutLabel: document.getElementById('sendShortcutLabel'),
        sendShortcutHelp: document.getElementById('sendShortcutHelp'),
        chatTabModeSectionTitle: document.getElementById('chatTabModeSectionTitle'),
        chatTabModeLabel: document.getElementById('chatTabModeLabel'),
        chatTabModeHelp: document.getElementById('chatTabModeHelp'),
        dataTransferSectionTitle: document.getElementById('dataTransferSectionTitle'),
        dataTransferDescription: document.getElementById('dataTransferDescription'),
        dangerSectionTitle: document.getElementById('dangerSectionTitle'),
        resetDataDescription: document.getElementById('resetDataDescription'),
        exportBtn: document.getElementById('exportBtn'),
        importBtn: document.getElementById('importBtn'),
        resetBtn: document.getElementById('resetBtn'),
        locale: document.getElementById('locale'),
        sendShortcut: document.getElementById('sendShortcut'),
        chatTabMode: document.getElementById('chatTabMode'),
        defaultAssistantModelLabel: document.getElementById('defaultAssistantModelLabel'),
        defaultAssistantModel: document.getElementById('defaultAssistantModel'),
        defaultAssistantModelHelp: document.getElementById('defaultAssistantModelHelp'),
        addProviderBtn: document.getElementById('addProviderBtn'),
        providerSearch: document.getElementById('providerSearch'),
        providerList: document.getElementById('providerList'),
        providerPanelTitle: document.getElementById('providerPanelTitle'),
        saveProviderBtn: document.getElementById('saveProviderBtn'),
        testConnectionBtn: document.getElementById('testConnectionBtn'),
        fetchModelsBtn: document.getElementById('fetchModelsBtn'),
        deleteProviderBtn: document.getElementById('deleteProviderBtn'),
        providerNameLabel: document.getElementById('providerNameLabel'),
        apiTypeLabel: document.getElementById('apiTypeLabel'),
        apiKeyLabel: document.getElementById('apiKeyLabel'),
        baseUrlLabel: document.getElementById('baseUrlLabel'),
        baseUrlHelp: document.getElementById('baseUrlHelp'),
        providerName: document.getElementById('providerName'),
        apiType: document.getElementById('apiType'),
        apiKey: document.getElementById('apiKey'),
        baseUrl: document.getElementById('baseUrl'),
        modelsPanelTitle: document.getElementById('modelsPanelTitle'),
        modelsHelp: document.getElementById('modelsHelp'),
        modelsList: document.getElementById('modelsList'),
        testModelModal: document.getElementById('testModelModal'),
        testModelModalTitle: document.getElementById('testModelModalTitle'),
        testModelModalDescription: document.getElementById('testModelModalDescription'),
        testModelModalLabel: document.getElementById('testModelModalLabel'),
        testModelModalSelect: document.getElementById('testModelModalSelect'),
        cancelTestModelBtn: document.getElementById('cancelTestModelBtn'),
        confirmTestModelBtn: document.getElementById('confirmTestModelBtn'),
        discardChangesModal: document.getElementById('discardChangesModal'),
        discardChangesModalTitle: document.getElementById('discardChangesModalTitle'),
        discardChangesModalDescription: document.getElementById('discardChangesModalDescription'),
        discardChangesStayBtn: document.getElementById('discardChangesStayBtn'),
        discardChangesConfirmBtn: document.getElementById('discardChangesConfirmBtn'),
        navMcp: document.getElementById('navMcp'),
        navMcpTitle: document.getElementById('navMcpTitle'),
        navMcpDescription: document.getElementById('navMcpDescription'),
        paneMcp: document.getElementById('paneMcp'),
        mcpMaxToolRoundsTitle: document.getElementById('mcpMaxToolRoundsTitle'),
        mcpMaxToolRoundsLabel: document.getElementById('mcpMaxToolRoundsLabel'),
        mcpMaxToolRoundsHelp: document.getElementById('mcpMaxToolRoundsHelp'),
        mcpMaxToolRounds: document.getElementById('mcpMaxToolRounds'),
        mcpSaveToolRoundsBtn: document.getElementById('mcpSaveToolRoundsBtn'),
        mcpServersTitle: document.getElementById('mcpServersTitle'),
        mcpServerList: document.getElementById('mcpServerList'),
        mcpAddServerBtn: document.getElementById('mcpAddServerBtn'),
        mcpServerModal: document.getElementById('mcpServerModal'),
        mcpServerModalTitle: document.getElementById('mcpServerModalTitle'),
        mcpServerModalDescription: document.getElementById('mcpServerModalDescription'),
        mcpModalNameLabel: document.getElementById('mcpModalNameLabel'),
        mcpModalTransportLabel: document.getElementById('mcpModalTransportLabel'),
        mcpModalName: document.getElementById('mcpModalName'),
        mcpModalTransport: document.getElementById('mcpModalTransport'),
        mcpModalCancelBtn: document.getElementById('mcpModalCancelBtn'),
        mcpModalSaveBtn: document.getElementById('mcpModalSaveBtn'),
        mcpDeleteConfirmModal: document.getElementById('mcpDeleteConfirmModal'),
        mcpDeleteConfirmTitle: document.getElementById('mcpDeleteConfirmTitle'),
        mcpDeleteConfirmDescription: document.getElementById('mcpDeleteConfirmDescription'),
        mcpDeleteCancelBtn: document.getElementById('mcpDeleteCancelBtn'),
        mcpDeleteConfirmBtn: document.getElementById('mcpDeleteConfirmBtn'),
        toastStack: document.getElementById('toastStack')
      };

      let runtimeState = {
        strings: {},
        activeSection: 'general',
        languageOptions: [],
        sendShortcutOptions: [],
        chatTabModeOptions: [],
        settings: {
          providers: [],
          defaultModels: {},
          locale: 'auto',
          sendShortcut: 'enter',
          chatTabMode: 'single'
        },
        modelOptions: [],
        invalidDefaultSelection: '',
        notice: '',
        noticeTone: 'info'
      };
      let activeSection = 'general';
      let providers = [];
      let persistedProvidersById = {};
      let dirtyProviderIds = new Set();
      let fetchedModelsByProvider = {};
      let testModelByProviderId = {};
      let testModelModalProviderId = '';
      let discardModalResolver = null;
      let providerEditorId = '';
      let searchKeyword = '';
      let lastToastNotice = '';
      let mcpServers = [];
      let mcpModalMode = 'add';
      let mcpModalEditIdx = -1;
      let mcpModalDraft = null;
      let mcpProbeResults = [];
      let expandedToolServerIdx = -1;
      let mcpDeleteResolver = null;

      function showToast(message, tone = 'info') {
        const text = String(message || '').trim();
        if (!text) {
          return;
        }
        const toast = document.createElement('div');
        toast.className = 'toast ' + (tone === 'success' || tone === 'error' ? tone : 'info');
        toast.textContent = text;
        dom.toastStack.appendChild(toast);
        while (dom.toastStack.children.length > 4) {
          dom.toastStack.removeChild(dom.toastStack.firstElementChild);
        }
        window.setTimeout(() => {
          toast.remove();
        }, 3200);
      }

      function escapeHtml(input) {
        return String(input)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function normalizeSectionValue(section) {
        return section === 'modelConfig' || section === 'defaultModels' || section === 'general' || section === 'mcp' ? section : 'general';
      }

      function getSectionMeta(section) {
        const strings = runtimeState.strings || {};
        if (section === 'modelConfig') {
          return {
            title: strings.modelConfigTitle || '',
            description: strings.modelConfigDescription || ''
          };
        }
        if (section === 'defaultModels') {
          return {
            title: strings.defaultModelsTitle || '',
            description: strings.defaultModelsDescription || ''
          };
        }
        if (section === 'mcp') {
          return {
            title: strings.mcpTitle || 'MCP',
            description: strings.mcpDescription || ''
          };
        }
        return {
          title: strings.settingsTitle || '',
          description: strings.settingsDescription || ''
        };
      }

      function renderHeader() {
        const meta = getSectionMeta(activeSection);
        dom.pageTitle.textContent = meta.title;
        dom.pageDescription.textContent = meta.description;
      }

      function renderNav() {
        const strings = runtimeState.strings || {};
        dom.navHeading.textContent = strings.settingsViewTitle || '';
        dom.navModelConfigTitle.textContent = strings.modelConfigTitle || '';
        dom.navModelConfigDescription.textContent = strings.modelConfigDescription || '';
        dom.navDefaultModelsTitle.textContent = strings.defaultModelsTitle || '';
        dom.navDefaultModelsDescription.textContent = strings.defaultModelsDescription || '';
        dom.navGeneralTitle.textContent = strings.settingsTitle || '';
        dom.navGeneralDescription.textContent = strings.settingsDescription || '';
        dom.navMcpTitle.textContent = strings.mcpTitle || 'MCP';
        dom.navMcpDescription.textContent = strings.mcpDescription || '';

        const items = [dom.navModelConfig, dom.navDefaultModels, dom.navGeneral, dom.navMcp];
        for (const item of items) {
          const isActive = item.getAttribute('data-section') === activeSection;
          item.classList.toggle('active', isActive);
          item.setAttribute('aria-current', isActive ? 'page' : 'false');
        }
      }

      function renderSectionVisibility() {
        const panes = [dom.paneModelConfig, dom.paneDefaultModels, dom.paneGeneral, dom.paneMcp];
        for (const pane of panes) {
          const isActive = pane.getAttribute('data-section') === activeSection;
          pane.classList.toggle('active', isActive);
        }
      }

      function activateSection(section, notifyHost) {
        activeSection = normalizeSectionValue(section);
        renderHeader();
        renderNav();
        renderSectionVisibility();
        if (notifyHost) {
          vscode.postMessage({
            type: 'switchSection',
            section: activeSection
          });
        }
      }

      function renderGeneralText() {
        const strings = runtimeState.strings || {};
        dom.languageSectionTitle.textContent = strings.languageSection || '';
        dom.languageLabel.textContent = strings.languageLabel || '';
        dom.languageHelp.textContent = strings.languageHelp || '';
        dom.sendShortcutSectionTitle.textContent = strings.sendShortcutSection || '';
        dom.sendShortcutLabel.textContent = strings.sendShortcutLabel || '';
        dom.sendShortcutHelp.textContent = strings.sendShortcutHelp || '';
        dom.chatTabModeSectionTitle.textContent = strings.chatTabModeSection || '';
        dom.chatTabModeLabel.textContent = strings.chatTabModeLabel || '';
        dom.chatTabModeHelp.textContent = strings.chatTabModeHelp || '';
        dom.dataTransferSectionTitle.textContent = strings.dataTransferSectionTitle || '';
        dom.dataTransferDescription.textContent = strings.dataTransferDescription || '';
        dom.dangerSectionTitle.textContent = strings.dangerSectionTitle || '';
        dom.resetDataDescription.textContent = strings.resetDataDescription || '';
        dom.exportBtn.textContent = strings.exportDataAction || '';
        dom.importBtn.textContent = strings.importDataAction || '';
        dom.resetBtn.textContent = strings.resetDataAction || '';
      }

      function renderSelectOptions(select, options) {
        select.innerHTML = (Array.isArray(options) ? options : [])
          .map((option) => '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</option>')
          .join('');
      }

      function renderGeneralValues() {
        const settings = runtimeState.settings || {};
        renderSelectOptions(dom.locale, runtimeState.languageOptions);
        renderSelectOptions(dom.sendShortcut, runtimeState.sendShortcutOptions);
        renderSelectOptions(dom.chatTabMode, runtimeState.chatTabModeOptions);
        dom.locale.value = settings.locale || 'auto';
        dom.sendShortcut.value = settings.sendShortcut || 'enter';
        dom.chatTabMode.value = settings.chatTabMode || 'single';
      }

      function renderDefaultModels() {
        const strings = runtimeState.strings || {};
        dom.defaultAssistantModelLabel.textContent = strings.defaultAssistantModelLabel || '';

        const defaults = (runtimeState.settings && runtimeState.settings.defaultModels) || {};
        const currentRef =
          defaults.assistant && defaults.assistant.providerId && defaults.assistant.modelId
            ? defaults.assistant.providerId + ':' + defaults.assistant.modelId
            : '';
        const invalidRef = runtimeState.invalidDefaultSelection || '';
        const options = [{ ref: '', label: strings.noneOption || '' }]
          .concat((runtimeState.modelOptions || []).map((option) => {
            const caps = option.capabilities;
            const capSuffix =
              caps && (caps.vision || caps.reasoning || caps.audio || caps.video || caps.tools)
                ? ' [' +
                  [
                    caps.vision ? strings.capabilityVision : '',
                    caps.reasoning ? strings.capabilityReasoning : '',
                    caps.audio ? strings.capabilityAudio : '',
                    caps.video ? strings.capabilityVideo : '',
                    caps.tools ? strings.capabilityTools : ''
                  ]
                    .filter(Boolean)
                    .join(', ') +
                  ']'
                : '';
            return {
              ref: option.ref,
              label: option.label + capSuffix
            };
          }))
          .concat(invalidRef ? [{ ref: invalidRef, label: invalidRef + ' (' + strings.modelUnavailableShort + ')' }] : []);
        const seen = new Set();
        dom.defaultAssistantModel.innerHTML = options
          .filter((option) => {
            if (seen.has(option.ref)) {
              return false;
            }
            seen.add(option.ref);
            return true;
          })
          .map((option) => '<option value="' + escapeHtml(option.ref) + '">' + escapeHtml(option.label) + '</option>')
          .join('');
        dom.defaultAssistantModel.value = currentRef || '';
        dom.defaultAssistantModelHelp.textContent = invalidRef ? strings.invalidDefaultModelHint || '' : '';
        dom.defaultAssistantModelHelp.className = invalidRef ? 'help invalid' : 'help';
      }

      function cloneMcpServers(items) {
        return (Array.isArray(items) ? items : []).map((server) => ({
          id: String(server.id || ''),
          name: String(server.name || ''),
          enabled: server.enabled !== false,
          transport: server.transport === 'streamableHttp' || server.transport === 'sse' ? server.transport : 'stdio',
          command: String(server.command || ''),
          args: Array.isArray(server.args) ? server.args.slice() : [],
          cwd: String(server.cwd || ''),
          env: Array.isArray(server.env) ? server.env.map((e) => ({ key: String(e.key || ''), value: String(e.value || '') })) : [],
          url: String(server.url || ''),
          headers: Array.isArray(server.headers) ? server.headers.map((h) => ({ key: String(h.key || ''), value: String(h.value || '') })) : [],
          timeoutMs: typeof server.timeoutMs === 'number' ? server.timeoutMs : 30000,
          remotePassthroughEnabled: !!server.remotePassthroughEnabled
        }));
      }

      function mcpServersSignature(items) {
        return JSON.stringify(cloneMcpServers(items));
      }

      function syncMcpServersFromState(state) {
        var servers = (state.settings && state.settings.mcp && state.settings.mcp.servers) || [];
        mcpServers = cloneMcpServers(servers);
        mcpProbeResults = [];
        expandedToolServerIdx = -1;
      }

      function renderMcp() {
        var strings = runtimeState.strings || {};
        dom.mcpMaxToolRoundsTitle.textContent = strings.mcpMaxToolRoundsTitle || '';
        dom.mcpMaxToolRoundsLabel.textContent = strings.mcpMaxToolRoundsLabel || '';
        dom.mcpMaxToolRoundsHelp.textContent = strings.mcpMaxToolRoundsHelp || '';
        dom.mcpSaveToolRoundsBtn.textContent = strings.saveAction || 'Save';
        dom.mcpServersTitle.textContent = strings.mcpServersTitle || '';
        dom.mcpAddServerBtn.textContent = strings.mcpAddServerAction || '+ Add Server';
        var settings = runtimeState.settings || {};
        var mcp = settings.mcp || {};
        dom.mcpMaxToolRounds.value = String(typeof mcp.maxToolRounds === 'number' ? mcp.maxToolRounds : 5);
        renderMcpServerList();
      }

      function renderMcpServerList() {
        var strings = runtimeState.strings || {};
        if (!mcpServers.length) {
          dom.mcpServerList.innerHTML = '<div class="help">' + escapeHtml(strings.mcpEmptyState || '') + '</div>';
          return;
        }
        dom.mcpServerList.innerHTML = mcpServers.map((server, idx) => {
          var probe = mcpProbeResults[idx];
          var statusDot = '';
          if (probe) {
            statusDot = probe.success
              ? '<span class="mcp-status-dot mcp-status-ok" title="' + escapeHtml(strings.mcpProbeSuccess || '') + '"></span>'
              : '<span class="mcp-status-dot mcp-status-fail" title="' + escapeHtml(probe.error || strings.mcpProbeFailed || '') + '"></span>';
          }
          var toolCountHtml = '';
          if (probe && probe.success) {
            var toolCountText = (strings.mcpToolsCount || '{count} tools').replace('{count}', String(probe.tools.length));
            toolCountHtml = '<span class="mcp-tool-count" data-mcp-action="toggle-tools" data-idx="' + idx + '">' + escapeHtml(toolCountText) + '</span>';
          }
          var enabledLabel = strings.mcpServerEnabledLabel || '';
          var transportLabel = server.transport === 'streamableHttp' ? 'HTTP' : server.transport === 'sse' ? 'SSE' : 'stdio';
          var toolsHtml = renderMcpToolsSection(idx);
          return (
            '<div class="mcp-server-card" data-idx="' + idx + '">' +
              '<div class="mcp-server-card-row">' +
                '<span class="mcp-server-name-display">' + escapeHtml(server.name || strings.mcpServerNewName || '') + '</span>' +
                statusDot +
                toolCountHtml +
                '<span class="pill">' + escapeHtml(transportLabel) + '</span>' +
                '<label class="mcp-server-toggle">' +
                  '<input type="checkbox" data-mcp-toggle-idx="' + idx + '" ' + (server.enabled ? 'checked' : '') + ' />' +
                  '<span>' + escapeHtml(enabledLabel) + '</span>' +
                '</label>' +
                '<div class="mcp-server-actions">' +
                  '<button class="mcp-action-btn" data-mcp-action="test" data-idx="' + idx + '" type="button">' + escapeHtml(strings.mcpTestServerAction || 'Test') + '</button>' +
                  '<button class="mcp-action-btn" data-mcp-action="edit" data-idx="' + idx + '" type="button">' + escapeHtml(strings.mcpEditServerAction || 'Edit') + '</button>' +
                  '<button class="mcp-action-btn" data-mcp-action="delete" data-idx="' + idx + '" type="button">' + escapeHtml(strings.mcpDeleteServerAction || 'Delete') + '</button>' +
                '</div>' +
              '</div>' +
              toolsHtml +
            '</div>'
          );
        }).join('');
      }

      function renderMcpToolsSection(idx) {
        var strings = runtimeState.strings || {};
        if (idx !== expandedToolServerIdx) { return ''; }
        var probe = mcpProbeResults[idx];
        if (!probe || !probe.success) { return ''; }
        var html = '<div class="mcp-tools-section">';
        html += '<h4 class="mcp-tools-heading">' + escapeHtml(strings.mcpToolsTitle || 'Tools') + '</h4>';
        if (probe.tools.length) {
          html += '<ul class="mcp-tools-list">';
          for (var t = 0; t < probe.tools.length; t++) {
            html += '<li><strong>' + escapeHtml(probe.tools[t].name) + '</strong>' +
              (probe.tools[t].description ? ' — ' + escapeHtml(probe.tools[t].description) : '') + '</li>';
          }
          html += '</ul>';
        } else {
          html += '<div class="help">' + escapeHtml(strings.mcpNoTools || '') + '</div>';
        }
        if (probe.resources.length) {
          html += '<div class="mcp-tools-heading" style="margin-top:8px">' +
            escapeHtml(strings.mcpResourcesLabel || 'Resources') + ': ' +
            (strings.mcpResourcesCount || '{count}').replace('{count}', String(probe.resources.length)) + '</div>';
        }
        if (probe.prompts.length) {
          html += '<div class="mcp-tools-heading" style="margin-top:4px">' +
            escapeHtml(strings.mcpPromptsLabel || 'Prompts') + ': ' +
            (strings.mcpPromptsCount || '{count}').replace('{count}', String(probe.prompts.length)) + '</div>';
        }
        html += '</div>';
        return html;
      }

      function openMcpServerModal(mode, idx) {
        mcpModalMode = mode;
        mcpModalEditIdx = typeof idx === 'number' ? idx : -1;
        var strings = runtimeState.strings || {};
        var isNew = mode === 'add';
        var server = isNew
          ? { id: 'mcp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9), name: strings.mcpServerNewName || 'New Server', enabled: true, transport: 'stdio', command: '', args: [], cwd: '', env: [], url: '', headers: [], timeoutMs: 30000, remotePassthroughEnabled: false }
          : (mcpServers[idx] ? cloneMcpServers([mcpServers[idx]])[0] : null);
        if (!server) { return; }
        mcpModalDraft = server;
        dom.mcpServerModalTitle.textContent = isNew ? (strings.mcpAddServerModalTitle || 'Add MCP Server') : (strings.mcpEditServerModalTitle || 'Edit MCP Server');
        dom.mcpServerModalDescription.textContent = isNew ? (strings.mcpAddServerModalDescription || '') : (strings.mcpEditServerModalDescription || '');
        dom.mcpModalNameLabel.textContent = strings.mcpServerNameLabel || '';
        dom.mcpModalTransportLabel.textContent = strings.mcpServerTransportLabel || '';
        dom.mcpModalName.value = server.name || '';
        dom.mcpModalTransport.value = server.transport || 'stdio';
        dom.mcpModalCancelBtn.textContent = strings.cancelAction || 'Cancel';
        dom.mcpModalSaveBtn.textContent = strings.saveAction || 'Save';
        renderMcpModalFields();
        dom.mcpServerModal.classList.add('visible');
        dom.mcpServerModal.setAttribute('aria-hidden', 'false');
        dom.mcpModalName.focus();
      }

      function renderMcpModalFields() {
        var strings = runtimeState.strings || {};
        var server = mcpModalDraft;
        if (!server) { return; }
        var transport = dom.mcpModalTransport.value || server.transport || 'stdio';
        var fieldsHtml = '';
        if (transport === 'stdio') {
          fieldsHtml +=
            '<div class="field full">' +
              '<label>' + escapeHtml(strings.mcpServerCommandLabel || '') + '</label>' +
              '<input id="mcpModalCommand" type="text" value="' + escapeHtml(server.command || '') + '" />' +
            '</div>' +
            '<div class="field full">' +
              '<label>' + escapeHtml(strings.mcpServerArgsLabel || '') + '</label>' +
              '<div id="mcpModalArgsList">' +
                (server.args || []).map((arg, i) =>
                  '<div class="mcp-kv-row">' +
                    '<input class="mcp-kv-input" type="text" value="' + escapeHtml(arg) + '" data-arg-idx="' + i + '" />' +
                    '<button class="mcp-kv-remove" data-remove-arg="' + i + '" type="button">x</button>' +
                  '</div>'
                ).join('') +
              '</div>' +
              '<button class="mcp-add-row-btn" id="mcpModalAddArgBtn" type="button">' + escapeHtml(strings.mcpAddArgAction || '+ Arg') + '</button>' +
            '</div>' +
            '<div class="field full">' +
              '<label>' + escapeHtml(strings.mcpServerEnvLabel || '') + '</label>' +
              '<div id="mcpModalEnvList">' +
                (server.env || []).map((entry, i) =>
                  '<div class="mcp-kv-row">' +
                    '<input class="mcp-kv-input" type="text" placeholder="KEY" value="' + escapeHtml(entry.key) + '" data-env-key-idx="' + i + '" />' +
                    '<input class="mcp-kv-input" type="text" placeholder="VALUE" value="' + escapeHtml(entry.value) + '" data-env-val-idx="' + i + '" />' +
                    '<button class="mcp-kv-remove" data-remove-env="' + i + '" type="button">x</button>' +
                  '</div>'
                ).join('') +
              '</div>' +
              '<button class="mcp-add-row-btn" id="mcpModalAddEnvBtn" type="button">' + escapeHtml(strings.mcpAddEnvAction || '+ Variable') + '</button>' +
            '</div>';
        } else {
          fieldsHtml +=
            '<div class="field full">' +
              '<label>' + escapeHtml(strings.mcpServerUrlLabel || '') + '</label>' +
              '<input id="mcpModalUrl" type="text" value="' + escapeHtml(server.url || '') + '" />' +
            '</div>' +
            '<div class="field full">' +
              '<label>' + escapeHtml(strings.mcpServerHeadersLabel || '') + '</label>' +
              '<div id="mcpModalHeadersList">' +
                (server.headers || []).map((entry, i) =>
                  '<div class="mcp-kv-row">' +
                    '<input class="mcp-kv-input" type="text" placeholder="KEY" value="' + escapeHtml(entry.key) + '" data-hdr-key-idx="' + i + '" />' +
                    '<input class="mcp-kv-input" type="text" placeholder="VALUE" value="' + escapeHtml(entry.value) + '" data-hdr-val-idx="' + i + '" />' +
                    '<button class="mcp-kv-remove" data-remove-hdr="' + i + '" type="button">x</button>' +
                  '</div>'
                ).join('') +
              '</div>' +
              '<button class="mcp-add-row-btn" id="mcpModalAddHeaderBtn" type="button">' + escapeHtml(strings.mcpAddHeaderAction || '+ Header') + '</button>' +
            '</div>';
        }
        fieldsHtml +=
          '<div class="field">' +
            '<label>' + escapeHtml(strings.mcpServerTimeoutLabel || '') + '</label>' +
            '<input id="mcpModalTimeout" type="number" min="1000" value="' + String(server.timeoutMs || 30000) + '" />' +
          '</div>';
        var modalFieldsContainer = document.getElementById('mcpModalFields');
        if (modalFieldsContainer) { modalFieldsContainer.innerHTML = fieldsHtml; }
        bindMcpModalFieldEvents();
      }

      function bindMcpModalFieldEvents() {
        var addArgBtn = document.getElementById('mcpModalAddArgBtn');
        if (addArgBtn) {
          addArgBtn.addEventListener('click', () => {
            if (!mcpModalDraft) { return; }
            syncMcpModalDraftFromFields();
            mcpModalDraft.args = mcpModalDraft.args || [];
            mcpModalDraft.args.push('');
            renderMcpModalFields();
            var lastArg = document.querySelector('[data-arg-idx="' + (mcpModalDraft.args.length - 1) + '"]');
            if (lastArg) { lastArg.focus(); }
          });
        }
        var addEnvBtn = document.getElementById('mcpModalAddEnvBtn');
        if (addEnvBtn) {
          addEnvBtn.addEventListener('click', () => {
            if (!mcpModalDraft) { return; }
            syncMcpModalDraftFromFields();
            mcpModalDraft.env = mcpModalDraft.env || [];
            mcpModalDraft.env.push({ key: '', value: '' });
            renderMcpModalFields();
            var lastEnvKey = document.querySelector('[data-env-key-idx="' + (mcpModalDraft.env.length - 1) + '"]');
            if (lastEnvKey) { lastEnvKey.focus(); }
          });
        }
        var addHeaderBtn = document.getElementById('mcpModalAddHeaderBtn');
        if (addHeaderBtn) {
          addHeaderBtn.addEventListener('click', () => {
            if (!mcpModalDraft) { return; }
            syncMcpModalDraftFromFields();
            mcpModalDraft.headers = mcpModalDraft.headers || [];
            mcpModalDraft.headers.push({ key: '', value: '' });
            renderMcpModalFields();
            var lastHdrKey = document.querySelector('[data-hdr-key-idx="' + (mcpModalDraft.headers.length - 1) + '"]');
            if (lastHdrKey) { lastHdrKey.focus(); }
          });
        }
        document.querySelectorAll('.mcp-kv-remove[data-remove-arg]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (!mcpModalDraft) { return; }
            syncMcpModalDraftFromFields();
            var idx = parseInt(btn.getAttribute('data-remove-arg') || '0', 10);
            mcpModalDraft.args = mcpModalDraft.args || [];
            mcpModalDraft.args.splice(idx, 1);
            renderMcpModalFields();
          });
        });
        document.querySelectorAll('.mcp-kv-remove[data-remove-env]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (!mcpModalDraft) { return; }
            syncMcpModalDraftFromFields();
            var idx = parseInt(btn.getAttribute('data-remove-env') || '0', 10);
            mcpModalDraft.env = mcpModalDraft.env || [];
            mcpModalDraft.env.splice(idx, 1);
            renderMcpModalFields();
          });
        });
        document.querySelectorAll('.mcp-kv-remove[data-remove-hdr]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (!mcpModalDraft) { return; }
            syncMcpModalDraftFromFields();
            var idx = parseInt(btn.getAttribute('data-remove-hdr') || '0', 10);
            mcpModalDraft.headers = mcpModalDraft.headers || [];
            mcpModalDraft.headers.splice(idx, 1);
            renderMcpModalFields();
          });
        });
      }

      function syncMcpModalDraftFromFields() {
        if (!mcpModalDraft) { return; }
        mcpModalDraft.name = (dom.mcpModalName.value || '').trim();
        mcpModalDraft.transport = dom.mcpModalTransport.value || 'stdio';
        if (mcpModalDraft.transport === 'stdio') {
          var cmdEl = document.getElementById('mcpModalCommand');
          mcpModalDraft.command = cmdEl ? cmdEl.value : '';
          var argEls = document.querySelectorAll('[data-arg-idx]');
          mcpModalDraft.args = Array.from(argEls).map((el) => el.value);
          var envKeyEls = document.querySelectorAll('[data-env-key-idx]');
          var envValEls = document.querySelectorAll('[data-env-val-idx]');
          mcpModalDraft.env = Array.from(envKeyEls).map((el, i) => ({
            key: el.value,
            value: envValEls[i] ? envValEls[i].value : ''
          }));
        } else {
          var urlEl = document.getElementById('mcpModalUrl');
          mcpModalDraft.url = urlEl ? urlEl.value : '';
          var hdrKeyEls = document.querySelectorAll('[data-hdr-key-idx]');
          var hdrValEls = document.querySelectorAll('[data-hdr-val-idx]');
          mcpModalDraft.headers = Array.from(hdrKeyEls).map((el, i) => ({
            key: el.value,
            value: hdrValEls[i] ? hdrValEls[i].value : ''
          }));
        }
        var timeoutEl = document.getElementById('mcpModalTimeout');
        mcpModalDraft.timeoutMs = timeoutEl ? Math.max(1000, parseInt(timeoutEl.value, 10) || 30000) : 30000;
      }

      function closeMcpServerModal() {
        dom.mcpServerModal.classList.remove('visible');
        dom.mcpServerModal.setAttribute('aria-hidden', 'true');
        mcpModalDraft = null;
        mcpModalEditIdx = -1;
      }

      function autoSaveMcpServers() {
        vscode.postMessage({ type: 'saveMcpServers', payload: cloneMcpServers(mcpServers) });
      }

      function confirmMcpServer() {
        syncMcpModalDraftFromFields();
        if (!mcpModalDraft) { closeMcpServerModal(); return; }
        var strings = runtimeState.strings || {};
        if (!mcpModalDraft.name.trim()) {
          showToast(strings.mcpServerNameRequired || 'Server name is required.', 'error');
          return;
        }
        var wasMode = mcpModalMode;
        var wasIdx = mcpModalEditIdx;
        if (wasMode === 'add') {
          mcpServers.push(cloneMcpServers([mcpModalDraft])[0]);
        } else if (wasIdx >= 0 && wasIdx < mcpServers.length) {
          mcpServers[wasIdx] = cloneMcpServers([mcpModalDraft])[0];
        }
        closeMcpServerModal();
        renderMcpServerList();
        autoSaveMcpServers();
        var savedServer = (wasMode === 'add')
          ? mcpServers[mcpServers.length - 1]
          : mcpServers[wasIdx];
        if (savedServer && savedServer.enabled) {
          vscode.postMessage({
            type: 'testMcpServer',
            payload: { server: savedServer }
          });
        }
      }

      function openMcpDeleteConfirmModal(serverName) {
        if (mcpDeleteResolver) { return Promise.resolve(false); }
        var strings = runtimeState.strings || {};
        dom.mcpDeleteConfirmTitle.textContent = (strings.mcpDeleteServerAction || 'Delete') + ': ' + serverName;
        dom.mcpDeleteConfirmDescription.textContent = strings.mcpDeleteConfirm || 'Are you sure you want to delete this server?';
        dom.mcpDeleteCancelBtn.textContent = strings.cancelAction || 'Cancel';
        dom.mcpDeleteConfirmBtn.textContent = strings.confirmAction || 'Confirm';
        dom.mcpDeleteConfirmModal.classList.add('visible');
        dom.mcpDeleteConfirmModal.setAttribute('aria-hidden', 'false');
        dom.mcpDeleteConfirmBtn.focus();
        return new Promise(function(resolve) {
          mcpDeleteResolver = resolve;
        });
      }

      function closeMcpDeleteConfirmModal(confirmed) {
        dom.mcpDeleteConfirmModal.classList.remove('visible');
        dom.mcpDeleteConfirmModal.setAttribute('aria-hidden', 'true');
        if (mcpDeleteResolver) {
          var resolve = mcpDeleteResolver;
          mcpDeleteResolver = null;
          resolve(!!confirmed);
        }
      }

      function cloneProviders(items) {
        return (Array.isArray(items) ? items : []).map((provider) => ({
          id: String(provider.id || ''),
          kind:
            provider.kind === 'openai' ||
            provider.kind === 'gemini' ||
            provider.kind === 'openrouter' ||
            provider.kind === 'ollama'
              ? provider.kind
              : 'custom',
          name: String(provider.name || ''),
          apiKey: String(provider.apiKey || ''),
          baseUrl: String(provider.baseUrl || ''),
          apiType: provider.apiType === 'responses' ? 'responses' : 'chat_completions',
          enabled: provider.enabled !== false,
          models: Array.isArray(provider.models)
            ? provider.models
                .map((model) => ({
                  id: String(model.id || '').trim(),
                  name: String(model.name || model.id || '').trim(),
                  capabilities: model.capabilities || undefined
                }))
                .filter((model) => model.id)
            : []
        }));
      }

      function cloneProvider(provider) {
        return cloneProviders([provider])[0];
      }

      function createPersistedProviderMap(items) {
        const map = {};
        for (const provider of Array.isArray(items) ? items : []) {
          if (!provider || !provider.id) {
            continue;
          }
          map[String(provider.id)] = cloneProvider(provider);
        }
        return map;
      }

      function mergeModels(models) {
        const map = new Map();
        for (const model of Array.isArray(models) ? models : []) {
          const id = String(model.id || '').trim();
          if (!id) {
            continue;
          }
          map.set(id, {
            id,
            name: String(model.name || id).trim() || id,
            capabilities: model.capabilities || undefined
          });
        }
        return Array.from(map.values()).sort((left, right) => left.id.localeCompare(right.id, 'en'));
      }

      function providerModelsSignature(models) {
        return mergeModels(models)
          .map((model) => model.id + '|' + model.name + '|' + JSON.stringify(model.capabilities || {}))
          .join('||');
      }

      function providerSignature(provider) {
        return [
          provider.id,
          provider.kind,
          provider.name,
          provider.apiKey,
          provider.baseUrl,
          provider.apiType,
          provider.enabled ? '1' : '0',
          providerModelsSignature(provider.models)
        ].join('::');
      }

      function providersCollectionSignature(items) {
        return cloneProviders(items)
          .sort((left, right) => left.id.localeCompare(right.id, 'en'))
          .map((provider) => providerSignature(provider))
          .join('###');
      }

      function isSameProvider(left, right) {
        if (!left || !right) {
          return false;
        }
        return providerSignature(left) === providerSignature(right);
      }

      function reconcileProviderDirty(providerId) {
        if (!providerId) {
          return;
        }
        const draft = providers.find((provider) => provider.id === providerId);
        if (!draft) {
          dirtyProviderIds.delete(providerId);
          return;
        }
        const persisted = persistedProvidersById[providerId];
        if (!persisted || !isSameProvider(draft, persisted)) {
          dirtyProviderIds.add(providerId);
          return;
        }
        dirtyProviderIds.delete(providerId);
      }

      function isProviderDirty(providerId) {
        return !!providerId && dirtyProviderIds.has(providerId);
      }

      function discardProviderChanges(providerId) {
        if (!providerId) {
          return;
        }
        const persisted = persistedProvidersById[providerId];
        if (!persisted) {
          providers = providers.filter((provider) => provider.id !== providerId);
          delete fetchedModelsByProvider[providerId];
          delete testModelByProviderId[providerId];
          dirtyProviderIds.delete(providerId);
          if (providerEditorId === providerId) {
            providerEditorId = providers[0] ? providers[0].id : '';
          }
          return;
        }
        providers = providers.map((provider) => (provider.id === providerId ? cloneProvider(persisted) : provider));
        fetchedModelsByProvider[providerId] = mergeModels(persisted.models);
        testModelByProviderId[providerId] = persisted.models[0] ? persisted.models[0].id : '';
        dirtyProviderIds.delete(providerId);
      }

      function closeDiscardChangesModal(confirmed) {
        dom.discardChangesModal.classList.remove('visible');
        dom.discardChangesModal.setAttribute('aria-hidden', 'true');
        if (discardModalResolver) {
          const resolve = discardModalResolver;
          discardModalResolver = null;
          resolve(!!confirmed);
        }
      }

      function openDiscardChangesModal() {
        if (discardModalResolver) {
          return Promise.resolve(false);
        }
        dom.discardChangesModal.classList.add('visible');
        dom.discardChangesModal.setAttribute('aria-hidden', 'false');
        dom.discardChangesConfirmBtn.focus();
        return new Promise((resolve) => {
          discardModalResolver = resolve;
        });
      }

      async function confirmDiscardCurrentProviderChanges() {
        const providerId = providerEditorId;
        if (!isProviderDirty(providerId)) {
          return true;
        }
        const confirmed = await openDiscardChangesModal();
        if (!confirmed) {
          return false;
        }
        discardProviderChanges(providerId);
        return true;
      }

      function ensureFetchedModels(provider) {
        if (!provider) {
          return [];
        }
        const key = provider.id || '__draft__';
        const merged = mergeModels([...(fetchedModelsByProvider[key] || []), ...(provider.models || [])]);
        fetchedModelsByProvider[key] = merged;
        return merged;
      }

      function getSelectedModelIds(provider) {
        return (provider && provider.models ? provider.models : []).map((model) => model.id).filter(Boolean);
      }

      function normalizeTestModelForProvider(provider) {
        if (!provider) {
          return '';
        }
        const modelIds = getSelectedModelIds(provider);
        const current = String(testModelByProviderId[provider.id] || '');
        if (current && modelIds.includes(current)) {
          return current;
        }
        const fallback = modelIds[0] || '';
        testModelByProviderId[provider.id] = fallback;
        return fallback;
      }

      function ensureProviderEditorId() {
        if (!providers.length) {
          providerEditorId = '';
          return;
        }
        const exists = providers.some((provider) => provider.id === providerEditorId);
        if (!exists) {
          providerEditorId = providers[0].id;
        }
      }

      function getEditingProvider() {
        ensureProviderEditorId();
        return providers.find((provider) => provider.id === providerEditorId) || null;
      }

      function renderModelConfigText() {
        const strings = runtimeState.strings || {};
        dom.addProviderBtn.textContent = strings.addProviderAction || '';
        dom.providerSearch.placeholder = strings.providerSearchPlaceholder || '';
        dom.providerPanelTitle.textContent = strings.providerConfigSectionTitle || '';
        dom.saveProviderBtn.textContent = strings.saveProviderAction || '';
        dom.testConnectionBtn.textContent = strings.testConnectionAction || '';
        dom.fetchModelsBtn.textContent = strings.fetchModelsAction || '';
        dom.deleteProviderBtn.textContent = strings.deleteProviderAction || '';
        dom.providerNameLabel.textContent = strings.providerNameLabel || '';
        dom.apiTypeLabel.textContent = strings.providerApiTypeLabel || '';
        dom.apiKeyLabel.textContent = strings.apiKeyLabel || '';
        dom.baseUrlLabel.textContent = strings.baseUrlLabel || '';
        dom.baseUrlHelp.textContent = strings.providerBaseUrlHelp || '';
        dom.modelsPanelTitle.textContent = strings.providerModelsSectionTitle || '';
        dom.modelsHelp.textContent = strings.providerModelsHelp || '';
        dom.testModelModalTitle.textContent = strings.providerTestModelDialogTitle || '';
        dom.testModelModalDescription.textContent = strings.providerTestModelDialogDescription || '';
        dom.testModelModalLabel.textContent = strings.providerTestModelLabel || '';
        dom.cancelTestModelBtn.textContent = strings.providerTestModelCancelAction || '';
        dom.confirmTestModelBtn.textContent = strings.providerTestModelConfirmAction || '';
        dom.discardChangesModalTitle.textContent = strings.providerUnsavedTitle || strings.providerUnsavedConfirm || '';
        dom.discardChangesModalDescription.textContent =
          strings.providerUnsavedDescription || strings.providerUnsavedConfirm || '';
        dom.discardChangesStayBtn.textContent = strings.providerUnsavedStayAction || strings.providerTestModelCancelAction || '';
        dom.discardChangesConfirmBtn.textContent =
          strings.providerUnsavedDiscardAction || strings.deleteProviderAction || '';
      }

      function renderProviderList() {
        const normalized = searchKeyword.trim().toLowerCase();
        const visibleProviders = !normalized
          ? providers
          : providers.filter((provider) => {
              const haystack = (provider.name + ' ' + provider.kind + ' ' + provider.apiType).toLowerCase();
              return haystack.includes(normalized);
            });

        if (!visibleProviders.length) {
          dom.providerList.innerHTML = '<div class="help">' + escapeHtml(runtimeState.strings.providerSearchEmpty || '') + '</div>';
          return;
        }

        dom.providerList.innerHTML = visibleProviders
          .map((provider) => {
            const active = provider.id === providerEditorId ? 'active' : '';
            const statusClass = provider.enabled ? '' : 'off';
            const providerName = provider.name || runtimeState.strings.providerDraftName || '';
            const selectProviderTitle = (runtimeState.strings.selectProviderToEdit || '') + ': ' + providerName;
            const providerEnabledTitle = (runtimeState.strings.providerEnabledSwitchLabel || '') + ': ' + providerName;
            return (
              '<div class="provider-item ' +
              active +
              '">' +
              '<button class="provider-item-main" type="button" data-id="' +
              escapeHtml(provider.id) +
              '" title="' +
              escapeHtml(selectProviderTitle) +
              '">' +
              '<div class="provider-item-name">' +
              escapeHtml(providerName) +
              '</div>' +
              '<div class="provider-item-meta">' +
              '<span class="pill">' +
              escapeHtml(provider.apiType) +
              '</span>' +
              '<span class="pill ' +
              statusClass +
              '">' +
              escapeHtml(provider.enabled ? runtimeState.strings.providerEnabledStatus || '' : runtimeState.strings.providerDisabledStatus || '') +
              '</span>' +
              '</div>' +
              '</button>' +
              '<label class="provider-item-toggle" title="' +
              escapeHtml(providerEnabledTitle) +
              '">' +
              '<input type="checkbox" data-toggle-id="' +
              escapeHtml(provider.id) +
              '" title="' +
              escapeHtml(providerEnabledTitle) +
              '" ' +
              (provider.enabled ? 'checked' : '') +
              ' />' +
              '<span>' +
              escapeHtml(runtimeState.strings.providerEnabledSwitchLabel || '') +
              '</span>' +
              '</label>' +
              '</div>'
            );
          })
          .join('');
      }

      function renderProviderFields() {
        const provider = getEditingProvider();
        const disabled = !provider;
        dom.providerName.disabled = disabled;
        dom.apiType.disabled = disabled;
        dom.apiKey.disabled = disabled;
        dom.baseUrl.disabled = disabled;
        dom.saveProviderBtn.disabled = disabled || !isProviderDirty(provider ? provider.id : '');
        dom.fetchModelsBtn.disabled = disabled;
        dom.deleteProviderBtn.disabled = disabled;
        dom.testConnectionBtn.disabled = disabled || getSelectedModelIds(provider).length === 0;
        dom.providerName.value = provider ? provider.name : '';
        dom.apiType.value = provider ? provider.apiType : 'chat_completions';
        dom.apiKey.value = provider ? provider.apiKey : '';
        dom.baseUrl.value = provider ? provider.baseUrl : '';
      }

      function closeTestModelModal() {
        testModelModalProviderId = '';
        dom.testModelModal.classList.remove('visible');
        dom.testModelModal.setAttribute('aria-hidden', 'true');
      }

      function openTestModelModal() {
        const provider = getEditingProvider();
        if (!provider) {
          return;
        }
        const selectedModels = provider.models || [];
        if (!selectedModels.length) {
          showToast(runtimeState.strings.providerTestModelRequired || '', 'error');
          renderAll();
          return;
        }
        const current = normalizeTestModelForProvider(provider);
        dom.testModelModalSelect.innerHTML = selectedModels
          .map((model) => '<option value="' + escapeHtml(model.id) + '">' + escapeHtml(model.id) + '</option>')
          .join('');
        dom.testModelModalSelect.value = current;
        testModelModalProviderId = provider.id;
        dom.testModelModal.classList.add('visible');
        dom.testModelModal.setAttribute('aria-hidden', 'false');
        dom.testModelModalSelect.focus();
      }

      function confirmTestModelSelection() {
        const provider = providers.find((item) => item.id === testModelModalProviderId);
        if (!provider) {
          closeTestModelModal();
          return;
        }
        const modelId = String(dom.testModelModalSelect.value || '').trim();
        if (!modelId) {
          closeTestModelModal();
          showToast(runtimeState.strings.providerTestModelRequired || '', 'error');
          renderAll();
          return;
        }
        testModelByProviderId[provider.id] = modelId;
        closeTestModelModal();
        vscode.postMessage({
          type: 'testConnection',
          payload: {
            provider,
            modelId
          }
        });
      }

      function renderModels() {
        const provider = getEditingProvider();
        if (!provider) {
          dom.modelsList.innerHTML = '<div class="help">' + escapeHtml(runtimeState.strings.selectProviderToEdit || '') + '</div>';
          return;
        }
        const models = ensureFetchedModels(provider);
        if (!models.length) {
          dom.modelsList.innerHTML = '<div class="help">' + escapeHtml(runtimeState.strings.providerModelsEmpty || '') + '</div>';
          return;
        }
        const selectedIds = new Set((provider.models || []).map((model) => model.id));
        dom.modelsList.innerHTML = models
          .map((model) => {
            const checked = selectedIds.has(model.id) ? 'checked' : '';
            const caps = model.capabilities || {};
            const capEntries = [];
            const capKeys = [
              { key: 'vision', cls: 'cap-vision', label: runtimeState.strings.capabilityVision || '' },
              { key: 'reasoning', cls: 'cap-reasoning', label: runtimeState.strings.capabilityReasoning || '' },
              { key: 'audio', cls: 'cap-audio', label: runtimeState.strings.capabilityAudio || '' },
              { key: 'video', cls: 'cap-video', label: runtimeState.strings.capabilityVideo || '' },
              { key: 'tools', cls: 'cap-tools', label: runtimeState.strings.capabilityTools || '' }
            ];
            for (const cap of capKeys) {
              const active = caps[cap.key] ? ' active' : '';
              capEntries.push(
                '<span class="cap-pill ' +
                  cap.cls +
                  active +
                  '" data-model-id="' +
                  escapeHtml(model.id) +
                  '" data-cap="' +
                  cap.key +
                  '" title="' +
                  escapeHtml(cap.label) +
                  '">' +
                  escapeHtml(cap.label) +
                  '</span>'
              );
            }
            return (
              '<label class="model-row">' +
              '<input type="checkbox" data-model-id="' +
              escapeHtml(model.id) +
              '" ' +
              checked +
              ' />' +
              '<div class="model-meta">' +
              '<div class="model-name">' +
              escapeHtml(model.id) +
              '</div>' +
              '<div class="model-desc">' +
              escapeHtml(model.name || model.id) +
              '</div>' +
              '<div class="model-caps">' +
              capEntries.join('') +
              '</div>' +
              '</div>' +
              '</label>'
            );
          })
          .join('');
      }

      function validateProvider(provider) {
        if (!provider) {
          return runtimeState.strings.selectProviderToEdit || '';
        }
        if (!provider.name.trim()) {
          return runtimeState.strings.providerNameRequired || '';
        }
        return '';
      }

      function createInternalProviderId() {
        return 'provider_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
      }

      async function addProvider() {
        if (!(await confirmDiscardCurrentProviderChanges())) {
          return;
        }
        let index = providers.length + 1;
        let nextId = createInternalProviderId();
        while (providers.some((provider) => provider.id === nextId)) {
          index += 1;
          nextId = createInternalProviderId();
        }
        providers.push({
          id: nextId,
          kind: 'custom',
          name: (runtimeState.strings.providerDraftName || 'Provider') + ' ' + index,
          apiKey: '',
          baseUrl: '',
          apiType: 'chat_completions',
          enabled: true,
          models: []
        });
        providerEditorId = nextId;
        fetchedModelsByProvider[nextId] = [];
        testModelByProviderId[nextId] = '';
        dirtyProviderIds.add(nextId);
        renderAll();
      }

      async function deleteProvider() {
        const provider = getEditingProvider();
        if (!provider) {
          return;
        }
        if (!(await confirmDiscardCurrentProviderChanges())) {
          return;
        }
        const providerId = provider.id;
        if (persistedProvidersById[providerId]) {
          vscode.postMessage({
            type: 'deleteProvider',
            payload: {
              providerId,
              providerName: provider.name || runtimeState.strings.providerDraftName || ''
            }
          });
          return;
        }
        providers = providers.filter((item) => item.id !== providerId);
        delete fetchedModelsByProvider[providerId];
        delete testModelByProviderId[providerId];
        dirtyProviderIds.delete(providerId);
        providerEditorId = providers[0] ? providers[0].id : '';
        renderAll();
      }

      function updateEditingProvider(mutator) {
        const provider = getEditingProvider();
        if (!provider) {
          return;
        }
        mutator(provider);
        reconcileProviderDirty(provider.id);
      }

      function syncProvidersFromState(nextState) {
        providers = cloneProviders((nextState.settings && nextState.settings.providers) || []);
        persistedProvidersById = createPersistedProviderMap((nextState.settings && nextState.settings.providers) || []);
        dirtyProviderIds = new Set();
        fetchedModelsByProvider = {};
        testModelByProviderId = {};
        for (const provider of providers) {
          fetchedModelsByProvider[provider.id] = mergeModels(provider.models);
          testModelByProviderId[provider.id] = provider.models[0] ? provider.models[0].id : '';
        }
        if (!providerEditorId && providers.length) {
          providerEditorId = providers[0].id;
        }
        closeTestModelModal();
        closeDiscardChangesModal(false);
      }

      function syncState(nextState) {
        const previousSignature = providersCollectionSignature(Object.values(persistedProvidersById));
        const nextSignature = providersCollectionSignature((nextState.settings && nextState.settings.providers) || []);
        var previousMcpSignature = mcpServersSignature(mcpServers);
        var nextMcpSignature = mcpServersSignature((nextState.settings && nextState.settings.mcp && nextState.settings.mcp.servers) || []);
        runtimeState = nextState;
        if (previousSignature !== nextSignature || Object.keys(persistedProvidersById).length === 0) {
          syncProvidersFromState(nextState);
        } else {
          persistedProvidersById = createPersistedProviderMap((nextState.settings && nextState.settings.providers) || []);
        }
        if (previousMcpSignature !== nextMcpSignature || !mcpServers.length) {
          syncMcpServersFromState(nextState);
        }
        activeSection = normalizeSectionValue(nextState.activeSection || activeSection);
        renderAll();
      }

      function renderAll() {
        renderHeader();
        renderNav();
        renderSectionVisibility();
        renderGeneralText();
        renderGeneralValues();
        renderDefaultModels();
        renderModelConfigText();
        ensureProviderEditorId();
        renderProviderList();
        renderProviderFields();
        renderModels();
        renderMcp();
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message && message.type === 'activateSection') {
          activateSection(message.section, false);
          return;
        }
        if (message && message.type === 'state') {
          syncState(message.payload);
          if (message.payload.notice) {
            const tone = message.payload.noticeTone || 'info';
            if (message.payload.notice !== lastToastNotice) {
              showToast(message.payload.notice, tone);
            }
            lastToastNotice = message.payload.notice;
          } else {
            lastToastNotice = '';
          }
          return;
        }
        if (message && message.type === 'connectionResult') {
          showToast(message.payload.message || '', message.payload.success ? 'success' : 'error');
          renderAll();
          return;
        }
        if (message && message.type === 'modelsFetched') {
          const provider = providers.find((item) => item.id === message.payload.providerId);
          if (provider) {
            const merged = mergeModels([...(message.payload.models || []), ...(provider.models || [])]);
            fetchedModelsByProvider[provider.id] = merged;
          }
          showToast(message.payload.message || '', message.payload.success ? 'success' : 'error');
          renderAll();
        }
        if (message && message.type === 'mcpProbeResult') {
          var probeItems = message.payload || [];
          for (var pi = 0; pi < mcpServers.length; pi++) {
            var match = probeItems.find((r) => r.serverId === mcpServers[pi].id);
            if (match) {
              mcpProbeResults[pi] = match;
            }
          }
          renderMcpServerList();
        }
      });

      dom.navModelConfig.addEventListener('click', () => {
        activateSection('modelConfig', true);
      });
      dom.navDefaultModels.addEventListener('click', () => {
        activateSection('defaultModels', true);
      });
      dom.navGeneral.addEventListener('click', () => {
        activateSection('general', true);
      });
      dom.navMcp.addEventListener('click', () => {
        activateSection('mcp', true);
      });

      function autoSaveGeneral() {
        vscode.postMessage({
          type: 'saveGeneral',
          payload: {
            locale: dom.locale.value,
            sendShortcut: dom.sendShortcut.value,
            chatTabMode: dom.chatTabMode.value === 'multi' ? 'multi' : 'single'
          }
        });
      }
      dom.locale.addEventListener('change', autoSaveGeneral);
      dom.sendShortcut.addEventListener('change', autoSaveGeneral);
      dom.chatTabMode.addEventListener('change', autoSaveGeneral);

      dom.exportBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'exportData' });
      });

      dom.importBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'importData' });
      });

      dom.resetBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'reset' });
      });

      // MCP event bindings
      dom.mcpSaveToolRoundsBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'saveMcpToolRounds',
          payload: { maxToolRounds: parseInt(dom.mcpMaxToolRounds.value, 10) || 5 }
        });
      });

      dom.mcpAddServerBtn.addEventListener('click', () => {
        openMcpServerModal('add', -1);
      });

      dom.mcpServerList.addEventListener('click', (event) => {
        var target = event.target;
        if (!(target instanceof HTMLElement)) { return; }
        var card = target.closest('.mcp-server-card');
        if (!card) { return; }
        var idx = parseInt(card.getAttribute('data-idx'), 10);
        if (isNaN(idx) || idx < 0 || idx >= mcpServers.length) { return; }
        var action = target.getAttribute('data-mcp-action');
        if (action === 'test') {
          if (!mcpServers[idx].enabled) { return; }
          vscode.postMessage({
            type: 'testMcpServer',
            payload: { server: mcpServers[idx] }
          });
          return;
        }
        if (action === 'toggle-tools') {
          var probe = mcpProbeResults[idx];
          if (probe && probe.success) {
            expandedToolServerIdx = expandedToolServerIdx === idx ? -1 : idx;
            renderMcpServerList();
          }
          return;
        }
        if (action === 'edit') {
          openMcpServerModal('edit', idx);
          return;
        }
        if (action === 'delete') {
          var server = mcpServers[idx];
          openMcpDeleteConfirmModal(server ? server.name : '').then(function(confirmed) {
            if (!confirmed) { return; }
            mcpServers.splice(idx, 1);
            if (expandedToolServerIdx >= mcpServers.length) { expandedToolServerIdx = -1; }
            if (expandedToolServerIdx === idx) { expandedToolServerIdx = -1; }
            else if (expandedToolServerIdx > idx) { expandedToolServerIdx -= 1; }
            renderMcpServerList();
            autoSaveMcpServers();
          });
          return;
        }
      });

      dom.mcpServerList.addEventListener('change', (event) => {
        var target = event.target;
        if (!(target instanceof HTMLInputElement)) { return; }
        var toggleIdx = target.getAttribute('data-mcp-toggle-idx');
        if (toggleIdx === null || toggleIdx === undefined) { return; }
        var idx = parseInt(toggleIdx, 10);
        if (isNaN(idx) || idx < 0 || idx >= mcpServers.length) { return; }
        mcpServers[idx].enabled = target.checked;
        renderMcpServerList();
        autoSaveMcpServers();
      });

      dom.mcpModalTransport.addEventListener('change', () => {
        if (mcpModalDraft) {
          mcpModalDraft.transport = dom.mcpModalTransport.value || 'stdio';
          renderMcpModalFields();
        }
      });

      dom.mcpModalCancelBtn.addEventListener('click', () => {
        closeMcpServerModal();
      });

      dom.mcpModalSaveBtn.addEventListener('click', () => {
        confirmMcpServer();
      });

      dom.mcpServerModal.addEventListener('click', (event) => {
        if (event.target === dom.mcpServerModal) {
          closeMcpServerModal();
        }
      });

      dom.mcpDeleteCancelBtn.addEventListener('click', () => {
        closeMcpDeleteConfirmModal(false);
      });

      dom.mcpDeleteConfirmBtn.addEventListener('click', () => {
        closeMcpDeleteConfirmModal(true);
      });

      dom.mcpDeleteConfirmModal.addEventListener('click', (event) => {
        if (event.target === dom.mcpDeleteConfirmModal) {
          closeMcpDeleteConfirmModal(false);
        }
      });

      dom.defaultAssistantModel.addEventListener('change', () => {
        vscode.postMessage({
          type: 'saveDefaultModels',
          payload: {
            assistant: dom.defaultAssistantModel.value
          }
        });
      });

      dom.providerSearch.addEventListener('input', () => {
        searchKeyword = dom.providerSearch.value;
        renderProviderList();
      });

      dom.providerList.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const trigger = target.closest('.provider-item-main');
        const nextId = trigger ? trigger.getAttribute('data-id') : '';
        if (!nextId || nextId === providerEditorId) {
          return;
        }
        if (!(await confirmDiscardCurrentProviderChanges())) {
          return;
        }
        providerEditorId = nextId;
        renderAll();
      });

      dom.providerList.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
          return;
        }
        const providerId = target.getAttribute('data-toggle-id');
        if (!providerId) {
          return;
        }
        const provider = providers.find((item) => item.id === providerId);
        if (!provider) {
          return;
        }
        provider.enabled = target.checked;
        if (persistedProvidersById[provider.id]) {
          persistedProvidersById[provider.id].enabled = provider.enabled;
          reconcileProviderDirty(provider.id);
          vscode.postMessage({
            type: 'toggleProviderEnabled',
            payload: {
              providerId: provider.id,
              enabled: provider.enabled
            }
          });
        } else {
          reconcileProviderDirty(provider.id);
        }
        renderAll();
      });

      dom.addProviderBtn.addEventListener('click', () => {
        void addProvider();
      });

      dom.deleteProviderBtn.addEventListener('click', () => {
        void deleteProvider();
      });

      dom.providerName.addEventListener('input', () => {
        updateEditingProvider((provider) => {
          provider.name = dom.providerName.value;
        });
        renderAll();
      });

      dom.apiType.addEventListener('change', () => {
        updateEditingProvider((provider) => {
          provider.apiType = dom.apiType.value === 'responses' ? 'responses' : 'chat_completions';
        });
        renderAll();
      });

      dom.apiKey.addEventListener('input', () => {
        updateEditingProvider((provider) => {
          provider.apiKey = dom.apiKey.value;
        });
        renderAll();
      });

      dom.baseUrl.addEventListener('input', () => {
        updateEditingProvider((provider) => {
          provider.baseUrl = dom.baseUrl.value;
        });
        renderAll();
      });

      dom.testConnectionBtn.addEventListener('click', () => {
        openTestModelModal();
      });

      dom.fetchModelsBtn.addEventListener('click', () => {
        const provider = getEditingProvider();
        if (!provider) {
          return;
        }
        vscode.postMessage({
          type: 'fetchModels',
          payload: provider
        });
      });

      dom.modelsList.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
          return;
        }
        const modelId = target.getAttribute('data-model-id');
        if (!modelId) {
          return;
        }
        updateEditingProvider((provider) => {
          const bucket = ensureFetchedModels(provider);
          if (target.checked) {
            provider.models = mergeModels([...(provider.models || []), ...bucket.filter((model) => model.id === modelId)]);
          } else {
            provider.models = (provider.models || []).filter((model) => model.id !== modelId);
          }
          normalizeTestModelForProvider(provider);
        });
        renderAll();
      });

      dom.modelsList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.classList.contains('cap-pill')) {
          return;
        }
        const modelId = target.getAttribute('data-model-id');
        const capKey = target.getAttribute('data-cap');
        if (!modelId || !capKey) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        updateEditingProvider((provider) => {
          const bucket = ensureFetchedModels(provider);
          const model = bucket.find((item) => item.id === modelId);
          if (!model) {
            return;
          }
          if (!model.capabilities) {
            model.capabilities = {};
          }
          model.capabilities[capKey] = !model.capabilities[capKey];
          const selected = (provider.models || []).find((item) => item.id === modelId);
          if (selected) {
            if (!selected.capabilities) {
              selected.capabilities = {};
            }
            selected.capabilities[capKey] = model.capabilities[capKey];
          }
        });
        renderAll();
      });

      dom.saveProviderBtn.addEventListener('click', () => {
        const provider = getEditingProvider();
        const validationMessage = validateProvider(provider);
        if (validationMessage) {
          showToast(validationMessage, 'error');
          renderAll();
          return;
        }
        vscode.postMessage({
          type: 'saveProvider',
          payload: {
            provider
          }
        });
      });

      dom.cancelTestModelBtn.addEventListener('click', () => {
        closeTestModelModal();
      });

      dom.confirmTestModelBtn.addEventListener('click', () => {
        confirmTestModelSelection();
      });

      dom.testModelModal.addEventListener('click', (event) => {
        if (event.target === dom.testModelModal) {
          closeTestModelModal();
        }
      });

      dom.discardChangesStayBtn.addEventListener('click', () => {
        closeDiscardChangesModal(false);
      });

      dom.discardChangesConfirmBtn.addEventListener('click', () => {
        closeDiscardChangesModal(true);
      });

      dom.discardChangesModal.addEventListener('click', (event) => {
        if (event.target === dom.discardChangesModal) {
          closeDiscardChangesModal(false);
        }
      });

      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && dom.testModelModal.classList.contains('visible')) {
          closeTestModelModal();
          return;
        }
        if (event.key === 'Escape' && dom.discardChangesModal.classList.contains('visible')) {
          closeDiscardChangesModal(false);
        }
      });

      window.addEventListener('beforeunload', (event) => {
        if (dirtyProviderIds.size === 0) {
          return;
        }
        const warning = (runtimeState.strings && runtimeState.strings.providerUnsavedConfirm) || '';
        event.preventDefault();
        event.returnValue = warning;
      });

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }
}
