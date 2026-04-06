import * as vscode from 'vscode';

import { dedupeModels, normalizeApiType } from './modelCatalog';
import { formatString, getStrings, resolveLocale } from './i18n';
import { getPanelIconPath } from './panelIcon';
import { OpenAICompatibleClient } from './providerClient';
import { ChatStateRepository } from './stateRepository';
import { SHARED_TOAST_STYLE } from './toastTheme';
import { ChatBuddySettings, ProviderModelProfile, ProviderProfile, RuntimeStrings } from './types';

type ModelConfigMessage =
  | { type: 'ready' }
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
    };

type ModelConfigState = {
  strings: RuntimeStrings;
  settings: ChatBuddySettings;
  notice?: string;
  noticeTone?: 'success' | 'error';
};

type ModelConfigOutbound =
  | {
      type: 'state';
      payload: ModelConfigState;
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
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
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

export class ModelConfigPanelController {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly repository: ChatStateRepository,
    private readonly providerClient: OpenAICompatibleClient,
    private readonly onSave: (settings: ChatBuddySettings) => void
  ) {}

  public openPanel(): void {
    if (!this.panel) {
      const strings = this.getStrings();
      this.panel = vscode.window.createWebviewPanel(
        'chatbuddy.modelConfigPanel',
        strings.modelConfigPanelTitle,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );
      this.panel.iconPath = getPanelIconPath('hubot');
      this.panel.webview.html = this.getHtml(this.panel.webview);
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((message: ModelConfigMessage) => {
        void this.handleMessage(message);
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.One);
    }
    this.postState();
  }

  public refresh(): void {
    this.postState();
  }

  private async handleMessage(message: ModelConfigMessage): Promise<void> {
    if (message.type === 'ready') {
      this.postState();
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
      const next: ChatBuddySettings = {
        ...current,
        providers: nextProviders
      };
      this.onSave(next);
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
      const nextProviders = current.providers.map((item) => (item.id === providerId ? { ...item, enabled } : item));
      this.onSave({
        ...current,
        providers: nextProviders
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
      const next: ChatBuddySettings = {
        ...current,
        providers: nextProviders
      };
      this.onSave(next);
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
    }
  }

  private getLocale() {
    return resolveLocale(this.repository.getSettings().locale, vscode.env.language);
  }

  private getStrings(): RuntimeStrings {
    return getStrings(this.getLocale());
  }

  private postMessage(message: ModelConfigOutbound): void {
    void this.panel?.webview.postMessage(message);
  }

  private postState(notice?: string, noticeTone?: 'success' | 'error'): void {
    if (!this.panel) {
      return;
    }
    const strings = this.getStrings();
    const settings = this.repository.getSettings();
    this.panel.title = strings.modelConfigPanelTitle;
    this.panel.iconPath = getPanelIconPath('hubot');
    this.postMessage({
      type: 'state',
      payload: {
        strings,
        settings,
        notice,
        noticeTone
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
        --panel-bg: color-mix(in srgb, var(--bg) 88%, white 12%);
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

      .shell {
        max-width: 1240px;
        margin: 0 auto;
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 8px;
      }

      .topbar-title {
        margin: 0;
        font-size: 20px;
        font-weight: 700;
      }

      .topbar-copy {
        margin: 0 0 14px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
      }

      .btn-primary,
      .btn-secondary,
      .btn-danger {
        border: 1px solid transparent;
        border-radius: 8px;
        padding: 8px 14px;
        background: var(--button-bg);
        color: var(--button-fg);
        cursor: pointer;
        white-space: nowrap;
      }

      .btn-primary:hover,
      .btn-secondary:hover,
      .btn-danger:hover {
        background: var(--button-hover);
      }

      .btn-secondary {
        background: transparent;
        color: var(--fg);
        border-color: var(--input-border);
      }

      .btn-danger {
        background: transparent;
        color: var(--vscode-inputValidation-errorForeground, var(--fg));
        border-color: var(--vscode-inputValidation-errorBorder, #be1100);
      }

      .workspace {
        border: 1px solid var(--border);
        border-radius: 12px;
        overflow: hidden;
        min-height: 640px;
        display: grid;
        grid-template-columns: 300px minmax(0, 1fr);
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
        font: inherit;
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
        background: var(--panel-bg);
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

      .panel {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 16px;
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }

      .panel-title {
        margin: 0;
        font-size: 13px;
        font-weight: 700;
      }

      .panel-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
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
        font: inherit;
      }

      .checkbox-row {
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }

      .checkbox-row input {
        width: 14px;
        height: 14px;
      }

      .help {
        color: var(--muted);
        font-size: 11px;
        line-height: 1.45;
      }

      .models-grid {
        display: grid;
        gap: 8px;
        max-height: 280px;
        overflow-y: auto;
      }

      .model-row {
        display: flex;
        align-items: center;
        gap: 10px;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 8px 10px;
      }

      .model-row input {
        width: 14px;
        height: 14px;
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
        margin-top: 3px;
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
        opacity: 0.4;
        cursor: pointer;
        user-select: none;
        transition: opacity 0.12s, border-color 0.12s, color 0.12s;
      }

      .cap-pill:hover {
        opacity: 0.7;
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

      @media (max-width: 980px) {
        .workspace {
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
          padding: 16px;
        }

        .field-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="topbar">
        <h1 class="topbar-title" id="title"></h1>
      </div>
      <p class="topbar-copy" id="description"></p>

      <div class="workspace">
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

    <div class="toast-stack" id="toastStack" aria-live="polite" aria-atomic="false"></div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const dom = {
        title: document.getElementById('title'),
        description: document.getElementById('description'),
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

      let runtimeState = null;
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

      function providerModelsSignature(models) {
        return mergeModels(models)
          .map((model) => model.id + '|' + model.name + '|' + JSON.stringify(model.capabilities || {}))
          .join('||');
      }

      function isSameProvider(left, right) {
        if (!left || !right) {
          return false;
        }
        return (
          left.id === right.id &&
          left.kind === right.kind &&
          left.name === right.name &&
          left.apiKey === right.apiKey &&
          left.baseUrl === right.baseUrl &&
          left.apiType === right.apiType &&
          left.enabled === right.enabled &&
          providerModelsSignature(left.models) === providerModelsSignature(right.models)
        );
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
          dirtyProviderIds.delete(providerId);
          if (providerEditorId === providerId) {
            providerEditorId = providers[0]?.id || '';
          }
          return;
        }
        providers = providers.map((provider) => (provider.id === providerId ? cloneProvider(persisted) : provider));
        fetchedModelsByProvider[providerId] = mergeModels(persisted.models);
        dirtyProviderIds.delete(providerId);
      }

      function closeDiscardChangesModal(confirmed = false) {
        dom.discardChangesModal.classList.remove('visible');
        dom.discardChangesModal.setAttribute('aria-hidden', 'true');
        if (discardModalResolver) {
          const resolve = discardModalResolver;
          discardModalResolver = null;
          resolve(confirmed);
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
        return (provider?.models || []).map((model) => model.id).filter((id) => !!id);
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

      function renderText() {
        const strings = runtimeState.strings;
        dom.title.textContent = strings.modelConfigTitle;
        dom.description.textContent = strings.modelConfigDescription;
        dom.addProviderBtn.textContent = strings.addProviderAction;
        dom.providerSearch.placeholder = strings.providerSearchPlaceholder;
        dom.providerPanelTitle.textContent = strings.providerConfigSectionTitle;
        dom.saveProviderBtn.textContent = strings.saveProviderAction;
        dom.testConnectionBtn.textContent = strings.testConnectionAction;
        dom.fetchModelsBtn.textContent = strings.fetchModelsAction;
        dom.deleteProviderBtn.textContent = strings.deleteProviderAction;
        dom.providerNameLabel.textContent = strings.providerNameLabel;
        dom.apiTypeLabel.textContent = strings.providerApiTypeLabel;
        dom.apiKeyLabel.textContent = strings.apiKeyLabel;
        dom.baseUrlLabel.textContent = strings.baseUrlLabel;
        dom.baseUrlHelp.textContent = strings.providerBaseUrlHelp;
        dom.modelsPanelTitle.textContent = strings.providerModelsSectionTitle;
        dom.modelsHelp.textContent = strings.providerModelsHelp;
        dom.testModelModalTitle.textContent = strings.providerTestModelDialogTitle;
        dom.testModelModalDescription.textContent = strings.providerTestModelDialogDescription;
        dom.testModelModalLabel.textContent = strings.providerTestModelLabel;
        dom.cancelTestModelBtn.textContent = strings.providerTestModelCancelAction;
        dom.confirmTestModelBtn.textContent = strings.providerTestModelConfirmAction;
        dom.discardChangesModalTitle.textContent = strings.providerUnsavedTitle || strings.providerUnsavedConfirm;
        dom.discardChangesModalDescription.textContent = strings.providerUnsavedDescription || strings.providerUnsavedConfirm;
        dom.discardChangesStayBtn.textContent = strings.providerUnsavedStayAction || strings.providerTestModelCancelAction;
        dom.discardChangesConfirmBtn.textContent = strings.providerUnsavedDiscardAction || strings.deleteProviderAction;
        dom.addProviderBtn.title = strings.addProviderAction;
        dom.providerSearch.title = strings.providerSearchPlaceholder;
        dom.saveProviderBtn.title = strings.saveProviderAction;
        dom.testConnectionBtn.title = strings.testConnectionAction;
        dom.fetchModelsBtn.title = strings.fetchModelsAction;
        dom.deleteProviderBtn.title = strings.deleteProviderAction;
        dom.providerName.title = strings.providerNameLabel;
        dom.apiType.title = strings.providerApiTypeLabel;
        dom.apiKey.title = strings.apiKeyLabel;
        dom.baseUrl.title = strings.baseUrlLabel;
        dom.cancelTestModelBtn.title = strings.providerTestModelCancelAction;
        dom.confirmTestModelBtn.title = strings.providerTestModelConfirmAction;
        dom.discardChangesStayBtn.title = strings.providerUnsavedStayAction || strings.providerTestModelCancelAction;
        dom.discardChangesConfirmBtn.title = strings.providerUnsavedDiscardAction || strings.deleteProviderAction;
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
          dom.providerList.innerHTML = '<div class="help">' + escapeHtml(runtimeState.strings.providerSearchEmpty) + '</div>';
          return;
        }
        dom.providerList.innerHTML = visibleProviders.map((provider) => {
          const active = provider.id === providerEditorId ? 'active' : '';
          const statusClass = provider.enabled ? '' : 'off';
          const providerName = provider.name || runtimeState.strings.providerDraftName;
          const selectProviderTitle = runtimeState.strings.selectProviderToEdit + ': ' + providerName;
          const providerEnabledTitle = runtimeState.strings.providerEnabledSwitchLabel + ': ' + providerName;
          return '' +
            '<div class="provider-item ' + active + '">' +
              '<button class="provider-item-main" type="button" data-id="' + escapeHtml(provider.id) + '" title="' + escapeHtml(selectProviderTitle) + '">' +
                '<div class="provider-item-name">' + escapeHtml(providerName) + '</div>' +
                '<div class="provider-item-meta">' +
                  '<span class="pill">' + escapeHtml(provider.apiType) + '</span>' +
                  '<span class="pill ' + statusClass + '">' + escapeHtml(provider.enabled ? runtimeState.strings.providerEnabledStatus : runtimeState.strings.providerDisabledStatus) + '</span>' +
                '</div>' +
              '</button>' +
              '<label class="provider-item-toggle" title="' + escapeHtml(providerEnabledTitle) + '">' +
                '<input type="checkbox" data-toggle-id="' + escapeHtml(provider.id) + '" title="' + escapeHtml(providerEnabledTitle) + '" ' + (provider.enabled ? 'checked' : '') + ' />' +
                '<span>' + escapeHtml(runtimeState.strings.providerEnabledSwitchLabel) + '</span>' +
              '</label>' +
            '</div>';
        }).join('');
      }

      function renderProviderFields() {
        const provider = getEditingProvider();
        const disabled = !provider;
        dom.providerName.disabled = disabled;
        dom.apiType.disabled = disabled;
        dom.apiKey.disabled = disabled;
        dom.baseUrl.disabled = disabled;
        dom.saveProviderBtn.disabled = disabled || !isProviderDirty(provider?.id || '');
        const hasSelectedModels = getSelectedModelIds(provider).length > 0;
        dom.testConnectionBtn.disabled = disabled || !hasSelectedModels;
        dom.fetchModelsBtn.disabled = disabled;
        dom.deleteProviderBtn.disabled = disabled;
        dom.providerName.value = provider?.name || '';
        dom.apiType.value = provider?.apiType || 'chat_completions';
        dom.apiKey.value = provider?.apiKey || '';
        dom.baseUrl.value = provider?.baseUrl || '';
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
          showToast(runtimeState.strings.providerTestModelRequired, 'error');
          renderAll();
          return;
        }
        const current = normalizeTestModelForProvider(provider);
        dom.testModelModalSelect.innerHTML = selectedModels
          .map((model) => {
            return '<option value="' + escapeHtml(model.id) + '">' + escapeHtml(model.id) + '</option>';
          })
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
          const message = runtimeState.strings.providerTestModelRequired;
          closeTestModelModal();
          showToast(message, 'error');
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
          dom.modelsList.innerHTML = '<div class="help">' + escapeHtml(runtimeState.strings.selectProviderToEdit) + '</div>';
          return;
        }
        const models = ensureFetchedModels(provider);
        if (!models.length) {
          dom.modelsList.innerHTML = '<div class="help">' + escapeHtml(runtimeState.strings.providerModelsEmpty) + '</div>';
          return;
        }
        const selectedIds = new Set((provider.models || []).map((model) => model.id));
        dom.modelsList.innerHTML = models.map((model) => {
          const checked = selectedIds.has(model.id) ? 'checked' : '';
          const caps = model.capabilities || {};
          const capEntries = [];
          const capKeys = [
            { key: 'vision', cls: 'cap-vision', label: runtimeState.strings.capabilityVision },
            { key: 'reasoning', cls: 'cap-reasoning', label: runtimeState.strings.capabilityReasoning },
            { key: 'audio', cls: 'cap-audio', label: runtimeState.strings.capabilityAudio },
            { key: 'video', cls: 'cap-video', label: runtimeState.strings.capabilityVideo },
            { key: 'tools', cls: 'cap-tools', label: runtimeState.strings.capabilityTools }
          ];
          for (const cap of capKeys) {
            const active = caps[cap.key] ? ' active' : '';
            capEntries.push('<span class="cap-pill ' + cap.cls + active + '" data-model-id="' + escapeHtml(model.id) + '" data-cap="' + cap.key + '" title="' + escapeHtml(cap.label) + '">' + escapeHtml(cap.label) + '</span>');
          }
          const capsHtml = '<div class="model-caps">' + capEntries.join('') + '</div>';
          return '' +
            '<label class="model-row">' +
              '<input type="checkbox" data-model-id="' + escapeHtml(model.id) + '" ' + checked + ' />' +
              '<div class="model-meta">' +
                '<div class="model-name">' + escapeHtml(model.id) + '</div>' +
                '<div class="model-desc">' + escapeHtml(model.name || model.id) + '</div>' +
                capsHtml +
              '</div>' +
            '</label>';
        }).join('');
      }

      function renderAll() {
        renderText();
        ensureProviderEditorId();
        renderProviderList();
        renderProviderFields();
        renderModels();
      }

      function validateProvider(provider) {
        if (!provider) {
          return runtimeState.strings.selectProviderToEdit;
        }
        if (!provider.name.trim()) {
          return runtimeState.strings.providerNameRequired;
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
          name: runtimeState.strings.providerDraftName + ' ' + index,
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
        const existsInPersisted = !!persistedProvidersById[providerId];
        if (existsInPersisted) {
          vscode.postMessage({
            type: 'deleteProvider',
            payload: {
              providerId,
              providerName: provider.name || runtimeState.strings.providerDraftName
            }
          });
          return;
        }
        providers = providers.filter((item) => item.id !== providerId);
        delete fetchedModelsByProvider[providerId];
        delete testModelByProviderId[providerId];
        dirtyProviderIds.delete(providerId);
        providerEditorId = providers[0]?.id || '';
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

      function syncState(nextState) {
        runtimeState = nextState;
        providers = cloneProviders(nextState.settings.providers || []);
        persistedProvidersById = createPersistedProviderMap(nextState.settings.providers || []);
        dirtyProviderIds = new Set();
        fetchedModelsByProvider = {};
        testModelByProviderId = {};
        for (const provider of providers) {
          fetchedModelsByProvider[provider.id] = mergeModels(provider.models);
          testModelByProviderId[provider.id] = provider.models[0]?.id || '';
        }
        if (!providerEditorId && providers.length) {
          providerEditorId = providers[0].id;
        }
        closeTestModelModal();
        closeDiscardChangesModal(false);
        renderAll();
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type === 'state') {
          syncState(message.payload);
          if (message.payload.notice) {
            if (message.payload.notice !== lastToastNotice) {
              showToast(message.payload.notice, message.payload.noticeTone || 'success');
            }
            lastToastNotice = message.payload.notice;
          } else {
            lastToastNotice = '';
          }
          return;
        }
        if (message?.type === 'connectionResult') {
          showToast(message.payload.message || '', message.payload.success ? 'success' : 'error');
          renderAll();
          return;
        }
        if (message?.type === 'modelsFetched') {
          const provider = providers.find((item) => item.id === message.payload.providerId);
          if (provider) {
            const merged = mergeModels([...(message.payload.models || []), ...(provider.models || [])]);
            fetchedModelsByProvider[provider.id] = merged;
          }
          showToast(message.payload.message || '', message.payload.success ? 'success' : 'error');
          renderAll();
        }
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
        const nextId = trigger?.getAttribute('data-id');
        if (!nextId) {
          return;
        }
        if (nextId === providerEditorId) {
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
        const persisted = persistedProvidersById[provider.id];
        if (persisted) {
          persisted.enabled = provider.enabled;
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
        renderProviderList();
        renderProviderFields();
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
          const model = bucket.find((m) => m.id === modelId);
          if (!model) {
            return;
          }
          if (!model.capabilities) {
            model.capabilities = {};
          }
          model.capabilities[capKey] = !model.capabilities[capKey];
          // Also sync to provider.models if the model is selected
          const selected = (provider.models || []).find((m) => m.id === modelId);
          if (selected) {
            if (!selected.capabilities) {
              selected.capabilities = {};
            }
            selected.capabilities[capKey] = model.capabilities[capKey];
          }
        });
        renderAll();
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

      window.addEventListener('beforeunload', (event) => {
        if (dirtyProviderIds.size === 0) {
          return;
        }
        const warning = runtimeState?.strings?.providerUnsavedConfirm || '';
        event.preventDefault();
        event.returnValue = warning;
      });

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }
}
