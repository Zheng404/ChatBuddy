import * as vscode from 'vscode';

import { getLanguageOptions, getStrings, resolveLocale } from './i18n';
import { getPanelIconPath } from './panelIcon';
import { ChatStateRepository } from './stateRepository';
import { SHARED_TOAST_STYLE } from './toastTheme';
import { ChatBuddyLocaleSetting, ChatBuddySettings, ChatSendShortcut, ChatTabMode, RuntimeStrings } from './types';

type SettingsMessage =
  | { type: 'ready' }
  | {
      type: 'save';
      payload: SettingsPayload;
    }
  | { type: 'reset' }
  | { type: 'exportData' }
  | { type: 'importData' };

type SettingsActionResult = {
  notice: string;
  tone?: 'success' | 'error' | 'info';
};

type SettingsPayload = {
  locale: ChatBuddyLocaleSetting;
  sendShortcut: ChatSendShortcut;
  chatTabMode: ChatTabMode;
};

type SettingsViewState = {
  strings: RuntimeStrings;
  languageOptions: ReadonlyArray<{ value: ChatBuddyLocaleSetting; label: string }>;
  sendShortcutOptions: ReadonlyArray<{ value: ChatSendShortcut; label: string }>;
  chatTabModeOptions: ReadonlyArray<{ value: ChatTabMode; label: string }>;
  settings: ChatBuddySettings;
  notice?: string;
  noticeTone?: 'success' | 'error' | 'info';
};

function normalizeSettings(input: SettingsPayload, fallback: ChatBuddySettings): ChatBuddySettings {
  return {
    ...fallback,
    locale: input.locale,
    sendShortcut: input.sendShortcut === 'ctrlEnter' ? 'ctrlEnter' : 'enter',
    chatTabMode: input.chatTabMode === 'multi' ? 'multi' : 'single'
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

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export class SettingsPanelController {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly repository: ChatStateRepository,
    private readonly onSave: (settings: ChatBuddySettings) => void,
    private readonly onReset: () => Promise<boolean> | boolean,
    private readonly onExportData: () => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined,
    private readonly onImportData: () => Promise<SettingsActionResult | undefined> | SettingsActionResult | undefined
  ) {}

  public openSettingsPanel(): void {
    if (!this.panel) {
      const strings = this.getStrings();
      this.panel = vscode.window.createWebviewPanel(
        'chatbuddy.settingsPanel',
        strings.settingsPanelTitle,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );
      this.panel.iconPath = getPanelIconPath('settings-gear');
      this.panel.webview.html = this.getHtml(this.panel.webview);
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((message: SettingsMessage) => {
        if (message.type === 'ready') {
          this.postState();
          return;
        }
        if (message.type === 'save') {
          const next = normalizeSettings(message.payload, this.repository.getSettings());
          this.onSave(next);
          this.postState(this.getStrings().settingsSaved, 'success');
          return;
        }
        if (message.type === 'reset') {
          void (async () => {
            const confirmed = await this.onReset();
            if (confirmed) {
              this.postState(this.getStrings().resetDataDone, 'success');
            }
          })();
          return;
        }
        if (message.type === 'exportData') {
          void (async () => {
            try {
              const result = await this.onExportData();
              if (result?.notice) {
                this.postState(result.notice, result.tone ?? 'success');
              }
            } catch {
              this.postState(this.getStrings().unknownError, 'error');
            }
          })();
          return;
        }
        if (message.type === 'importData') {
          void (async () => {
            try {
              const result = await this.onImportData();
              if (result?.notice) {
                this.postState(result.notice, result.tone ?? 'success');
              }
            } catch {
              this.postState(this.getStrings().unknownError, 'error');
            }
          })();
        }
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.One);
    }
    this.postState();
  }

  public refresh(): void {
    this.postState();
  }

  private getStrings(): RuntimeStrings {
    const locale = resolveLocale(this.repository.getSettings().locale, vscode.env.language);
    return getStrings(locale);
  }

  private postState(notice?: string, noticeTone: 'success' | 'error' | 'info' = 'info'): void {
    if (!this.panel) {
      return;
    }

    const strings = this.getStrings();
    const settings = this.repository.getSettings();
    this.panel.title = strings.settingsPanelTitle;
    this.panel.iconPath = getPanelIconPath('settings-gear');
    const payload: SettingsViewState = {
      strings,
      languageOptions: getLanguageOptions(strings),
      sendShortcutOptions: getSendShortcutOptions(strings),
      chatTabModeOptions: getChatTabModeOptions(strings),
      settings,
      notice,
      noticeTone: notice ? noticeTone : undefined
    };

    void this.panel.webview.postMessage({
      type: 'state',
      payload
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
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 24px;
        background: var(--bg);
        color: var(--fg);
        font-family: var(--vscode-font-family);
      }

      .shell {
        max-width: 860px;
        margin: 0 auto;
      }

      .hero {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
      }

      .hero-title {
        margin: 0;
        font-size: 24px;
        font-weight: 700;
      }

      .hero-copy {
        margin-top: 8px;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.6;
      }

      .btn-primary {
        border: 1px solid transparent;
        border-radius: 8px;
        padding: 9px 14px;
        background: var(--button-bg);
        color: var(--button-fg);
        cursor: pointer;
        white-space: nowrap;
      }

      .btn-primary:hover {
        background: var(--button-hover);
      }

      .grid {
        display: grid;
        gap: 16px;
      }

      .section {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 16px;
      }

      .section-title {
        margin: 0 0 14px;
        font-size: 13px;
        font-weight: 700;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      label {
        font-size: 12px;
        color: var(--muted);
      }

      select {
        width: 100%;
        border: 1px solid var(--input-border);
        border-radius: 8px;
        padding: 9px 10px;
        background: var(--input-bg);
        color: var(--input-fg);
        font: inherit;
      }

      .help {
        margin-top: 8px;
        color: var(--muted);
        font-size: 12px;
      }

      .data-actions,
      .danger-actions {
        margin-top: 12px;
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

      .btn-secondary,
      .btn-danger {
        border-radius: 8px;
        padding: 8px 12px;
        cursor: pointer;
      }

      .btn-secondary {
        border: 1px solid var(--input-border);
        background: transparent;
        color: var(--fg);
      }

      .btn-secondary:hover {
        background: var(--button-hover);
      }

      .btn-danger {
        border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
        background: transparent;
        color: var(--vscode-inputValidation-errorForeground, var(--fg));
      }

      .btn-danger:hover {
        background: var(--vscode-inputValidation-errorBackground, var(--button-hover));
      }

${SHARED_TOAST_STYLE}
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="hero">
        <div>
          <h1 class="hero-title" id="title"></h1>
          <div class="hero-copy" id="description"></div>
        </div>
        <button class="btn-primary" id="saveBtn" type="button"></button>
      </div>

      <div class="grid">
        <section class="section">
          <h2 class="section-title" id="languageSectionTitle"></h2>
          <div class="field">
            <select id="locale"></select>
          </div>
          <div class="help" id="languageHelp"></div>
        </section>

        <section class="section">
          <h2 class="section-title" id="sendShortcutSectionTitle"></h2>
          <div class="field">
            <select id="sendShortcut"></select>
          </div>
          <div class="help" id="sendShortcutHelp"></div>
        </section>

        <section class="section">
          <h2 class="section-title" id="chatTabModeSectionTitle"></h2>
          <div class="field">
            <select id="chatTabMode"></select>
          </div>
          <div class="help" id="chatTabModeHelp"></div>
        </section>

        <section class="section">
          <h2 class="section-title" id="dataTransferSectionTitle"></h2>
          <div class="help" id="dataTransferDescription"></div>
          <div class="data-actions">
            <button class="btn-secondary" id="exportBtn" type="button"></button>
            <button class="btn-secondary" id="importBtn" type="button"></button>
          </div>
        </section>

        <section class="section">
          <h2 class="section-title" id="dangerSectionTitle"></h2>
          <div class="danger-copy" id="resetDataDescription"></div>
          <div class="danger-actions">
            <button class="btn-danger" id="resetBtn" type="button"></button>
          </div>
        </section>
      </div>

    </div>
    <div class="toast-stack" id="toastStack" aria-live="polite" aria-atomic="false"></div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const dom = {
        title: document.getElementById('title'),
        description: document.getElementById('description'),
        languageSectionTitle: document.getElementById('languageSectionTitle'),
        languageHelp: document.getElementById('languageHelp'),
        sendShortcutSectionTitle: document.getElementById('sendShortcutSectionTitle'),
        sendShortcutHelp: document.getElementById('sendShortcutHelp'),
        dataTransferSectionTitle: document.getElementById('dataTransferSectionTitle'),
        dataTransferDescription: document.getElementById('dataTransferDescription'),
        dangerSectionTitle: document.getElementById('dangerSectionTitle'),
        resetDataDescription: document.getElementById('resetDataDescription'),
        exportBtn: document.getElementById('exportBtn'),
        importBtn: document.getElementById('importBtn'),
        resetBtn: document.getElementById('resetBtn'),
        locale: document.getElementById('locale'),
        sendShortcut: document.getElementById('sendShortcut'),
        chatTabModeSectionTitle: document.getElementById('chatTabModeSectionTitle'),
        chatTabModeHelp: document.getElementById('chatTabModeHelp'),
        chatTabMode: document.getElementById('chatTabMode'),
        saveBtn: document.getElementById('saveBtn'),
        toastStack: document.getElementById('toastStack')
      };

      let state = {
        strings: {},
        languageOptions: [],
        sendShortcutOptions: [],
        chatTabModeOptions: [],
        settings: {
          locale: 'auto',
          sendShortcut: 'enter',
          chatTabMode: 'single'
        },
        notice: '',
        noticeTone: 'info'
      };
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

      function renderText() {
        dom.title.textContent = state.strings.settingsTitle;
        dom.description.textContent = state.strings.settingsDescription;
        dom.languageSectionTitle.textContent = state.strings.languageSection;
        dom.languageHelp.textContent = state.strings.languageHelp;
        dom.sendShortcutSectionTitle.textContent = state.strings.sendShortcutSection;
        dom.sendShortcutHelp.textContent = state.strings.sendShortcutHelp;
        dom.chatTabModeSectionTitle.textContent = state.strings.chatTabModeSection;
        dom.chatTabModeHelp.textContent = state.strings.chatTabModeHelp;
        dom.dataTransferSectionTitle.textContent = state.strings.dataTransferSectionTitle;
        dom.dataTransferDescription.textContent = state.strings.dataTransferDescription;
        dom.dangerSectionTitle.textContent = state.strings.dangerSectionTitle;
        dom.resetDataDescription.textContent = state.strings.resetDataDescription;
        dom.exportBtn.textContent = state.strings.exportDataAction;
        dom.importBtn.textContent = state.strings.importDataAction;
        dom.resetBtn.textContent = state.strings.resetDataAction;
        dom.saveBtn.textContent = state.strings.saveSettings;
        dom.locale.title = state.strings.languageSection;
        dom.sendShortcut.title = state.strings.sendShortcutSection;
        dom.exportBtn.title = state.strings.exportDataAction;
        dom.importBtn.title = state.strings.importDataAction;
        dom.resetBtn.title = state.strings.resetDataAction;
        dom.saveBtn.title = state.strings.saveSettings;
      }

      function renderLanguageOptions() {
        dom.locale.innerHTML = state.languageOptions.map((option) => {
          return '<option value="' + option.value + '">' + option.label + '</option>';
        }).join('');
        dom.sendShortcut.innerHTML = state.sendShortcutOptions.map((option) => {
          return '<option value="' + option.value + '">' + option.label + '</option>';
        }).join('');
        dom.chatTabMode.innerHTML = state.chatTabModeOptions.map((option) => {
          return '<option value="' + option.value + '">' + option.label + '</option>';
        }).join('');
      }

      function renderValues() {
        dom.locale.value = state.settings.locale || 'auto';
        dom.sendShortcut.value = state.settings.sendShortcut || 'enter';
        dom.chatTabMode.value = state.settings.chatTabMode || 'single';
      }

      function renderAll() {
        renderText();
        renderLanguageOptions();
        renderValues();
      }

      function collectPayload() {
        return {
          locale: dom.locale.value,
          sendShortcut: dom.sendShortcut.value,
          chatTabMode: dom.chatTabMode.value === 'multi' ? 'multi' : 'single'
        };
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type !== 'state') {
          return;
        }
        state = message.payload;
        renderAll();
        if (state.notice) {
          const tone = state.noticeTone || 'info';
          if (state.notice !== lastToastNotice) {
            showToast(state.notice, tone);
          }
          lastToastNotice = state.notice;
        } else {
          lastToastNotice = '';
        }
      });

      dom.saveBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'save',
          payload: collectPayload()
        });
      });

      dom.resetBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'reset' });
      });

      dom.exportBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'exportData' });
      });

      dom.importBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'importData' });
      });

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }
}
