import * as vscode from 'vscode';

import { createModelRef, dedupeModels, normalizeApiType, parseModelRef } from './modelCatalog';
import { formatString, getLanguageOptions, getStrings, resolveLocale } from './i18n';
import { getPanelIconPath } from './panelIcon';
import { OpenAICompatibleClient } from './providerClient';
import { ChatStateRepository } from './stateRepository';
import { SHARED_TOAST_STYLE } from './toastTheme';
import {
  ChatBuddyLocaleSetting,
  ChatBuddySettings,
  ChatSendShortcut,
  ChatTabMode,
  ProviderModelOption,
  ProviderModelProfile,
  ProviderProfile,
  RuntimeStrings
} from './types';

export type SettingsCenterSection = 'modelConfig' | 'defaultModels' | 'general';

type SettingsActionResult = {
  notice: string;
  tone?: 'success' | 'error' | 'info';
};

type GeneralSettingsPayload = {
  locale: ChatBuddyLocaleSetting;
  sendShortcut: ChatSendShortcut;
  chatTabMode: ChatTabMode;
};

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
  | { type: 'importData' };

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
  if (section === 'modelConfig' || section === 'defaultModels' || section === 'general') {
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
            <div class="pane-toolbar">
              <button class="primary-btn" id="defaultModelsSaveBtn" type="button"></button>
            </div>
            <section class="section-card">
              <div class="field">
                <label for="defaultAssistantModel" id="defaultAssistantModelLabel"></label>
                <select id="defaultAssistantModel"></select>
                <div class="help" id="defaultAssistantModelHelp"></div>
              </div>
            </section>
          </section>

          <section class="settings-pane" id="paneGeneral" data-section="general">
            <div class="pane-toolbar">
              <button class="primary-btn" id="generalSaveBtn" type="button"></button>
            </div>
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
        generalSaveBtn: document.getElementById('generalSaveBtn'),
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
        defaultModelsSaveBtn: document.getElementById('defaultModelsSaveBtn'),
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
        return section === 'modelConfig' || section === 'defaultModels' || section === 'general' ? section : 'general';
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

        const items = [dom.navModelConfig, dom.navDefaultModels, dom.navGeneral];
        for (const item of items) {
          const isActive = item.getAttribute('data-section') === activeSection;
          item.classList.toggle('active', isActive);
          item.setAttribute('aria-current', isActive ? 'page' : 'false');
        }
      }

      function renderSectionVisibility() {
        const panes = [dom.paneModelConfig, dom.paneDefaultModels, dom.paneGeneral];
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
        dom.generalSaveBtn.textContent = strings.saveSettings || '';
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
        dom.defaultModelsSaveBtn.textContent = strings.saveSettings || '';
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
        runtimeState = nextState;
        if (previousSignature !== nextSignature || Object.keys(persistedProvidersById).length === 0) {
          syncProvidersFromState(nextState);
        } else {
          persistedProvidersById = createPersistedProviderMap((nextState.settings && nextState.settings.providers) || []);
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

      dom.generalSaveBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'saveGeneral',
          payload: {
            locale: dom.locale.value,
            sendShortcut: dom.sendShortcut.value,
            chatTabMode: dom.chatTabMode.value === 'multi' ? 'multi' : 'single'
          }
        });
      });

      dom.exportBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'exportData' });
      });

      dom.importBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'importData' });
      });

      dom.resetBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'reset' });
      });

      dom.defaultModelsSaveBtn.addEventListener('click', () => {
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
