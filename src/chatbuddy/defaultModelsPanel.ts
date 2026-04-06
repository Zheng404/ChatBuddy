import * as vscode from 'vscode';

import { getStrings, resolveLocale } from './i18n';
import { createModelRef, DEFAULT_TITLE_SUMMARY_PROMPT, parseModelRef } from './modelCatalog';
import { getPanelIconPath } from './panelIcon';
import { ChatStateRepository } from './stateRepository';
import { SHARED_TOAST_STYLE } from './toastTheme';
import { ChatBuddySettings, ProviderModelOption, RuntimeStrings } from './types';

type DefaultModelsMessage =
  | { type: 'ready' }
  | { type: 'saveAssistant'; payload: { assistant: string } }
  | { type: 'saveTitleSummary'; payload: { titleSummary: string } }
  | { type: 'saveTitleSummaryPrompt'; payload: { titleSummaryPrompt: string } };

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
        const current = this.repository.getSettings();
        const next: ChatBuddySettings = {
          ...current,
          defaultModels: { ...current.defaultModels }
        };
        if (message.type === 'saveAssistant') {
          next.defaultModels = {
            ...next.defaultModels,
            assistant: parseModelRef(message.payload.assistant.trim())
          };
          this.onSave(next);
          this.postState(this.getStrings().defaultAssistantModelSaved);
        } else if (message.type === 'saveTitleSummary') {
          next.defaultModels = {
            ...next.defaultModels,
            titleSummary: parseModelRef(message.payload.titleSummary.trim()) || undefined
          };
          this.onSave(next);
          this.postState(this.getStrings().defaultTitleSummaryModelSaved);
        } else if (message.type === 'saveTitleSummaryPrompt') {
          next.defaultModels = {
            ...next.defaultModels,
            titleSummaryPrompt: message.payload.titleSummaryPrompt.trim() || undefined
          };
          this.onSave(next);
          this.postState(this.getStrings().defaultTitleSummaryPromptSaved);
        } else {
          return;
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

      .btn-secondary {
        border: 1px solid var(--input-border);
        border-radius: 8px;
        padding: 9px 14px;
        background: transparent;
        color: var(--fg);
        cursor: pointer;
        white-space: nowrap;
      }

      .btn-secondary:hover {
        background: rgba(255, 255, 255, 0.04);
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

      textarea {
        width: 100%;
        border: 1px solid var(--input-border);
        border-radius: 8px;
        padding: 9px 10px;
        background: var(--input-bg);
        color: var(--input-fg);
        font: inherit;
        min-height: 72px;
        resize: vertical;
      }

      .help {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.55;
      }

      .invalid {
        color: var(--vscode-inputValidation-errorForeground, #be1100);
      }

      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
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

      .panel-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

${SHARED_TOAST_STYLE}
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="hero">
        <h1 class="hero-title" id="title"></h1>
        <div class="hero-copy" id="description"></div>
      </div>

      <section class="section">
        <div class="field">
          <label for="assistant" id="assistantLabel"></label>
          <select id="assistant"></select>
          <div class="help" id="assistantHelp"></div>
        </div>
      </section>

      <section class="section" style="margin-top: 12px;">
        <div class="field">
          <label for="titleSummary" id="titleSummaryLabel"></label>
          <div style="display:flex;align-items:center;gap:8px;">
            <select id="titleSummary" style="flex:1;"></select>
            <button class="btn-secondary" id="editTitleSummaryPromptBtn" type="button"></button>
          </div>
          <div class="help" id="titleSummaryHelp"></div>
        </div>
      </section>
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

    <div class="toast-stack" id="toastStack" aria-live="polite" aria-atomic="false"></div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const dom = {
        title: document.getElementById('title'),
        description: document.getElementById('description'),
        assistantLabel: document.getElementById('assistantLabel'),
        assistantHelp: document.getElementById('assistantHelp'),
        assistant: document.getElementById('assistant'),
        titleSummaryLabel: document.getElementById('titleSummaryLabel'),
        titleSummaryHelp: document.getElementById('titleSummaryHelp'),
        titleSummary: document.getElementById('titleSummary'),
        editTitleSummaryPromptBtn: document.getElementById('editTitleSummaryPromptBtn'),
        titleSummaryPromptModal: document.getElementById('titleSummaryPromptModal'),
        titleSummaryPromptModalTitle: document.getElementById('titleSummaryPromptModalTitle'),
        titleSummaryPromptModalDescription: document.getElementById('titleSummaryPromptModalDescription'),
        titleSummaryPromptModalTextarea: document.getElementById('titleSummaryPromptModalTextarea'),
        cancelTitleSummaryPromptBtn: document.getElementById('cancelTitleSummaryPromptBtn'),
        resetTitleSummaryPromptBtn: document.getElementById('resetTitleSummaryPromptBtn'),
        saveTitleSummaryPromptBtn: document.getElementById('saveTitleSummaryPromptBtn'),
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
          .concat((state.modelOptions || []).map((option) => {
            const caps = option.capabilities;
            const capSuffix = caps && (caps.vision || caps.reasoning || caps.audio || caps.video || caps.tools)
              ? ' [' + [
                  caps.vision ? state.strings.capabilityVision : '',
                  caps.reasoning ? state.strings.capabilityReasoning : '',
                  caps.audio ? state.strings.capabilityAudio : '',
                  caps.video ? state.strings.capabilityVideo : '',
                  caps.tools ? state.strings.capabilityTools : ''
                ].filter(Boolean).join(', ') + ']'
              : '';
            return { ref: option.ref, label: option.label + capSuffix };
          }))
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
        dom.assistantLabel.textContent = strings.defaultAssistantModelLabel;
        dom.assistant.title = strings.defaultAssistantModelLabel;

        const defaults = state.settings.defaultModels || {};
        renderSelect(dom.assistant, bindingToRef(defaults.assistant), state.invalidSelection);
        dom.assistantHelp.textContent = state.invalidSelection ? strings.invalidDefaultModelHint : '';
        dom.assistantHelp.className = state.invalidSelection ? 'help invalid' : 'help';

        dom.titleSummaryLabel.textContent = strings.defaultTitleSummaryModelLabel;
        dom.titleSummary.title = strings.defaultTitleSummaryModelLabel;
        dom.editTitleSummaryPromptBtn.textContent = strings.editTitleSummaryPromptAction;

        renderSelect(dom.titleSummary, bindingToRef(defaults.titleSummary), '');
        dom.titleSummaryHelp.textContent = '';
        dom.titleSummaryHelp.className = 'help';

        // Modal labels
        dom.titleSummaryPromptModalTitle.textContent = strings.titleSummaryPromptModalTitle;
        dom.titleSummaryPromptModalDescription.textContent = strings.titleSummaryPromptModalDescription;
        dom.cancelTitleSummaryPromptBtn.textContent = strings.cancelAction;
        dom.resetTitleSummaryPromptBtn.textContent = strings.resetToDefaultAction;
        dom.saveTitleSummaryPromptBtn.textContent = strings.saveAction;
      }

      function openPromptModal() {
        const defaults = (state.settings && state.settings.defaultModels) || {};
        dom.titleSummaryPromptModalTextarea.value = defaults.titleSummaryPrompt || ${JSON.stringify(DEFAULT_TITLE_SUMMARY_PROMPT)};
        dom.titleSummaryPromptModal.classList.add('visible');
        dom.titleSummaryPromptModal.setAttribute('aria-hidden', 'false');
        dom.titleSummaryPromptModalTextarea.focus();
      }

      function closePromptModal() {
        dom.titleSummaryPromptModal.classList.remove('visible');
        dom.titleSummaryPromptModal.setAttribute('aria-hidden', 'true');
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type !== 'state') {
          return;
        }
        state = message.payload;
        render();
        if (state.notice) {
          const isSaved = state.notice === state.strings.defaultAssistantModelSaved
            || state.notice === state.strings.defaultTitleSummaryModelSaved
            || state.notice === state.strings.defaultTitleSummaryPromptSaved;
          const tone = isSaved ? 'success' : 'error';
          if (state.notice !== lastToastNotice) {
            showToast(state.notice, tone);
          }
          lastToastNotice = state.notice;
        } else {
          lastToastNotice = '';
        }
      });

      dom.assistant.addEventListener('change', () => {
        vscode.postMessage({ type: 'saveAssistant', payload: { assistant: dom.assistant.value } });
      });

      dom.titleSummary.addEventListener('change', () => {
        vscode.postMessage({ type: 'saveTitleSummary', payload: { titleSummary: dom.titleSummary.value } });
      });

      dom.editTitleSummaryPromptBtn.addEventListener('click', () => {
        openPromptModal();
      });

      dom.cancelTitleSummaryPromptBtn.addEventListener('click', () => {
        closePromptModal();
      });

      dom.resetTitleSummaryPromptBtn.addEventListener('click', () => {
        dom.titleSummaryPromptModalTextarea.value = ${JSON.stringify(DEFAULT_TITLE_SUMMARY_PROMPT)};
      });

      dom.saveTitleSummaryPromptBtn.addEventListener('click', () => {
        const value = dom.titleSummaryPromptModalTextarea.value;
        closePromptModal();
        vscode.postMessage({ type: 'saveTitleSummaryPrompt', payload: { titleSummaryPrompt: value } });
      });

      dom.titleSummaryPromptModal.addEventListener('click', (event) => {
        if (event.target === dom.titleSummaryPromptModal) {
          closePromptModal();
        }
      });

      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && dom.titleSummaryPromptModal.classList.contains('visible')) {
          closePromptModal();
        }
      });

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }
}
