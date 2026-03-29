import * as vscode from 'vscode';

import { getStrings, resolveLocale } from './i18n';
import { createModelRef, parseModelRef } from './modelCatalog';
import { getPanelIconPath } from './panelIcon';
import { ChatStateRepository } from './stateRepository';
import { SHARED_TOAST_STYLE } from './toastTheme';
import { ChatBuddySettings, ProviderModelOption, RuntimeStrings } from './types';

type DefaultModelsMessage =
  | { type: 'ready' }
  | {
      type: 'save';
      payload: {
        assistant: string;
      };
    };

type DefaultModelsState = {
  strings: RuntimeStrings;
  settings: ChatBuddySettings;
  modelOptions: ProviderModelOption[];
  invalidSelection: string;
  notice?: string;
};

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function normalizeSettings(assistantRef: string, fallback: ChatBuddySettings): ChatBuddySettings {
  return {
    ...fallback,
    defaultModels: {
      assistant: parseModelRef(assistantRef.trim())
    }
  };
}

export class DefaultModelsPanelController {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly repository: ChatStateRepository,
    private readonly onSave: (settings: ChatBuddySettings) => void
  ) {}

  public openPanel(): void {
    if (!this.panel) {
      const strings = this.getStrings();
      this.panel = vscode.window.createWebviewPanel(
        'chatbuddy.defaultModelsPanel',
        strings.defaultModelsPanelTitle,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );
      this.panel.iconPath = getPanelIconPath('symbol-constant');
      this.panel.webview.html = this.getHtml(this.panel.webview);
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((message: DefaultModelsMessage) => {
        if (message.type === 'ready') {
          this.postState();
          return;
        }
        if (message.type === 'save') {
          const next = normalizeSettings(message.payload.assistant, this.repository.getSettings());
          this.onSave(next);
          this.postState(this.getStrings().defaultModelsSaved);
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

  private toRef(value: ChatBuddySettings['defaultModels']['assistant']): string {
    return value ? createModelRef(value.providerId, value.modelId) : '';
  }

  private postState(notice?: string): void {
    if (!this.panel) {
      return;
    }
    const strings = this.getStrings();
    const settings = this.repository.getSettings();
    const modelOptions = this.repository.getModelOptions();
    const currentRef = this.toRef(settings.defaultModels.assistant);
    const invalidSelection = currentRef && !modelOptions.some((option) => option.ref === currentRef) ? currentRef : '';
    this.panel.title = strings.defaultModelsPanelTitle;
    this.panel.iconPath = getPanelIconPath('symbol-constant');
    void this.panel.webview.postMessage({
      type: 'state',
      payload: {
        strings,
        settings,
        modelOptions,
        invalidSelection,
        notice
      } satisfies DefaultModelsState
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
        max-width: 880px;
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

      .save-btn {
        border: 1px solid transparent;
        border-radius: 8px;
        padding: 9px 14px;
        background: var(--button-bg);
        color: var(--button-fg);
        cursor: pointer;
        white-space: nowrap;
      }

      .save-btn:hover {
        background: var(--button-hover);
      }

      .section {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 16px;
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
        color: var(--muted);
        font-size: 12px;
        line-height: 1.55;
      }

      .invalid {
        color: var(--vscode-inputValidation-errorForeground, #be1100);
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
        <button class="save-btn" id="saveBtn" type="button"></button>
      </div>

      <section class="section">
        <div class="field">
          <label for="assistant" id="assistantLabel"></label>
          <select id="assistant"></select>
          <div class="help" id="assistantHelp"></div>
        </div>
      </section>
    </div>

    <div class="toast-stack" id="toastStack" aria-live="polite" aria-atomic="false"></div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const dom = {
        title: document.getElementById('title'),
        description: document.getElementById('description'),
        saveBtn: document.getElementById('saveBtn'),
        assistantLabel: document.getElementById('assistantLabel'),
        assistantHelp: document.getElementById('assistantHelp'),
        assistant: document.getElementById('assistant'),
        toastStack: document.getElementById('toastStack')
      };

      let state = null;
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

      function bindingToRef(binding) {
        return binding && binding.providerId && binding.modelId ? binding.providerId + ':' + binding.modelId : '';
      }

      function renderSelect(select, currentRef, invalidRef) {
        const options = [{ ref: '', label: state.strings.noneOption }]
          .concat(state.modelOptions || [])
          .concat(invalidRef ? [{ ref: invalidRef, label: invalidRef + ' (' + state.strings.modelUnavailableShort + ')' }] : []);
        const seen = new Set();
        select.innerHTML = options
          .filter((option) => {
            if (seen.has(option.ref)) {
              return false;
            }
            seen.add(option.ref);
            return true;
          })
          .map((option) => {
            return '<option value="' + escapeHtml(option.ref) + '">' + escapeHtml(option.label) + '</option>';
          })
          .join('');
        select.value = currentRef || '';
      }

      function render() {
        const strings = state.strings;
        dom.title.textContent = strings.defaultModelsTitle;
        dom.description.textContent = strings.defaultModelsDescription;
        dom.saveBtn.textContent = strings.saveSettings;
        dom.assistantLabel.textContent = strings.defaultAssistantModelLabel;
        dom.saveBtn.title = strings.saveSettings;
        dom.assistant.title = strings.defaultAssistantModelLabel;

        const defaults = state.settings.defaultModels || {};
        renderSelect(dom.assistant, bindingToRef(defaults.assistant), state.invalidSelection);
        dom.assistantHelp.textContent = state.invalidSelection ? strings.invalidDefaultModelHint : '';
        dom.assistantHelp.className = state.invalidSelection ? 'help invalid' : 'help';
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type !== 'state') {
          return;
        }
        state = message.payload;
        render();
        if (state.notice) {
          const tone = state.notice === state.strings.defaultModelsSaved || state.notice === state.strings.settingsSaved
            ? 'success'
            : 'error';
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
          payload: {
            assistant: dom.assistant.value
          }
        });
      });

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }
}
