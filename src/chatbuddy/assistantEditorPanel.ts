import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { DEFAULT_GROUP_ID, DELETED_GROUP_ID, isLegacyDefaultGroupName } from './constants';
import { getCodiconRootUri, getCodiconStyleText } from './codicon';
import { getStrings, resolveLocale } from './i18n';
import { getPanelIconPath } from './panelIcon';
import { ChatStateRepository, UpdateAssistantInput } from './stateRepository';
import { SHARED_TOAST_STYLE } from './toastTheme';
import { AssistantGroup, AssistantProfile, ProviderModelOption, RuntimeStrings } from './types';

type AssistantEditorMessage =
  | { type: 'ready' }
  | {
      type: 'pickAvatar';
      currentAvatar?: string;
    }
  | {
      type: 'save';
      payload: AssistantEditorPayload;
    };

type AssistantEditorPayload = {
  name: string;
  note: string;
  avatar: string;
  greeting: string;
  systemPrompt: string;
  questionPrefix: string;
  groupId: string;
  modelRef: string;
  streaming: boolean;
  temperature: number;
  topP: number;
  maxTokens: number;
  contextCount: number;
  presencePenalty: number;
  frequencyPenalty: number;
};

type AssistantEditorState = {
  strings: RuntimeStrings;
  assistant: AssistantProfile;
  groups: AssistantGroup[];
  models: ReadonlyArray<ProviderModelOption>;
  notice?: string;
};

const AVATAR_ICON_OPTIONS: ReadonlyArray<string> = [
  'account',
  'add',
  'archive',
  'arrow-right',
  'beaker',
  'bell',
  'book',
  'bookmark',
  'briefcase',
  'bug',
  'calendar',
  'check',
  'checklist',
  'chip',
  'clock',
  'cloud',
  'code',
  'comment',
  'copilot',
  'database',
  'debug-alt',
  'device-camera',
  'edit',
  'eye',
  'file',
  'flame',
  'gear',
  'git-branch',
  'globe',
  'heart',
  'history',
  'home',
  'info',
  'key',
  'layers',
  'lightbulb',
  'link',
  'list-tree',
  'lock',
  'mail',
  'megaphone',
  'mention',
  'mic',
  'notebook',
  'paintcan',
  'pencil',
  'person',
  'plug',
  'pulse',
  'question',
  'rocket',
  'search',
  'send',
  'server',
  'shield',
  'sparkle',
  'star-full',
  'symbol-color',
  'terminal',
  'tools',
  'wand',
  'zap'
];

let cachedAvailableAvatarIcons: ReadonlyArray<string> | undefined;

function getAvailableAvatarIcons(): ReadonlyArray<string> {
  if (cachedAvailableAvatarIcons) {
    return cachedAvailableAvatarIcons;
  }
  try {
    const codiconCssPath = path.join(getCodiconRootUri().fsPath, 'codicon.css');
    const cssContent = fs.readFileSync(codiconCssPath, 'utf8');
    const available = AVATAR_ICON_OPTIONS.filter((icon) => cssContent.includes(`.codicon-${icon}:before`));
    cachedAvailableAvatarIcons = available.length > 0 ? available : AVATAR_ICON_OPTIONS;
  } catch {
    cachedAvailableAvatarIcons = AVATAR_ICON_OPTIONS;
  }
  return cachedAvailableAvatarIcons;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function toUpdatePayload(input: AssistantEditorPayload, fallback: AssistantProfile): UpdateAssistantInput {
  return {
    name: input.name.trim() || fallback.name,
    note: input.note,
    avatar: input.avatar.trim(),
    greeting: input.greeting,
    systemPrompt: input.systemPrompt,
    questionPrefix: input.questionPrefix,
    groupId: input.groupId,
    modelRef: input.modelRef.trim() || fallback.modelRef,
    streaming: input.streaming,
    temperature: clamp(input.temperature, 0, 2, fallback.temperature),
    topP: clamp(input.topP, 0, 1, fallback.topP),
    maxTokens: clamp(input.maxTokens, 0, 65535, fallback.maxTokens),
    contextCount: clamp(input.contextCount, 0, Number.MAX_SAFE_INTEGER, fallback.contextCount),
    presencePenalty: clamp(input.presencePenalty, -2, 2, fallback.presencePenalty),
    frequencyPenalty: clamp(input.frequencyPenalty, -2, 2, fallback.frequencyPenalty)
  };
}

export class AssistantEditorPanelController {
  private panel: vscode.WebviewPanel | undefined;
  private editingAssistantId: string | undefined;
  private creatingAssistantDraft: AssistantProfile | undefined;

  constructor(
    private readonly repository: ChatStateRepository,
    private readonly onSave: (assistantId: string, patch: UpdateAssistantInput) => void,
    private readonly onCreate: (patch: UpdateAssistantInput) => string | undefined
  ) {}

  public openAssistantEditor(assistantId: string): void {
    this.editingAssistantId = assistantId;
    this.creatingAssistantDraft = undefined;
    this.ensurePanel();
    this.postState();
  }

  public openCreateAssistantEditor(): void {
    this.editingAssistantId = undefined;
    this.creatingAssistantDraft = this.buildDraftAssistant();
    this.ensurePanel();
    this.postState();
  }

  public refresh(): void {
    this.postState();
  }

  private ensurePanel(): void {
    const strings = this.getStrings();
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'chatbuddy.assistantEditorPanel',
        strings.assistantPanelTitle,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [getCodiconRootUri()]
        }
      );
      this.panel.iconPath = getPanelIconPath('account');
      this.panel.webview.html = this.getHtml(this.panel.webview);
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.editingAssistantId = undefined;
        this.creatingAssistantDraft = undefined;
      });
      this.panel.webview.onDidReceiveMessage(async (message: AssistantEditorMessage) => {
        if (message.type === 'ready') {
          this.postState();
          return;
        }
        if (message.type === 'pickAvatar') {
          const selected = await this.pickAvatar(message.currentAvatar);
          if (!selected || !this.panel) {
            return;
          }
          void this.panel.webview.postMessage({
            type: 'avatarPicked',
            payload: {
              icon: selected
            }
          });
          return;
        }
        if (message.type === 'save') {
          const current = this.getCurrentAssistant();
          if (!current) {
            return;
          }
          const patch = toUpdatePayload(message.payload, current);
          if (this.creatingAssistantDraft) {
            const createdAssistantId = this.onCreate(patch);
            if (!createdAssistantId) {
              return;
            }
            this.editingAssistantId = createdAssistantId;
            this.creatingAssistantDraft = undefined;
            this.postState(this.getStrings().assistantSaved);
            return;
          }
          if (!this.editingAssistantId) {
            return;
          }
          this.onSave(this.editingAssistantId, patch);
          this.postState(this.getStrings().assistantSaved);
        }
      });
      return;
    }
    this.panel.reveal(vscode.ViewColumn.One);
  }

  private getEditingAssistant(): AssistantProfile | undefined {
    if (!this.editingAssistantId) {
      return undefined;
    }
    return this.repository.getAssistantById(this.editingAssistantId);
  }

  private getCurrentAssistant(): AssistantProfile | undefined {
    if (this.creatingAssistantDraft) {
      return this.creatingAssistantDraft;
    }
    return this.getEditingAssistant();
  }

  private buildDraftAssistant(): AssistantProfile {
    const settings = this.repository.getSettings();
    const timestamp = Date.now();
    const strings = this.getStrings();
    const defaultAssistantModel = settings.defaultModels.assistant;
    return {
      id: 'assistant-draft',
      name: strings.assistantRole,
      note: '',
      avatar: undefined,
      groupId: DEFAULT_GROUP_ID,
      systemPrompt: '',
      greeting: '',
      questionPrefix: '',
      modelRef: defaultAssistantModel ? `${defaultAssistantModel.providerId}:${defaultAssistantModel.modelId}` : '',
      temperature: settings.temperature,
      topP: settings.topP,
      maxTokens: 0,
      contextCount: 16,
      presencePenalty: settings.presencePenalty,
      frequencyPenalty: settings.frequencyPenalty,
      streaming: settings.streamingDefault,
      pinned: false,
      isDeleted: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastInteractedAt: timestamp
    };
  }

  private async pickAvatar(currentAvatar?: string): Promise<string | undefined> {
    const strings = this.getStrings();
    const icons = getAvailableAvatarIcons();
    const picked = await vscode.window.showQuickPick(
      icons.map((icon) => ({
        label: `$(${icon}) ${icon}`,
        description: icon === (currentAvatar?.trim() || '') ? strings.assistantAvatarSelected : undefined,
        icon
      })),
      {
        title: strings.assistantAvatarQuickPickTitle,
        placeHolder: strings.assistantAvatarQuickPickPlaceholder,
        ignoreFocusOut: true,
        matchOnDescription: true
      }
    );
    return picked?.icon;
  }

  private getStrings(): RuntimeStrings {
    const locale = resolveLocale(this.repository.getSettings().locale, vscode.env.language);
    return getStrings(locale);
  }

  private collectModelOptions(assistant: AssistantProfile): ProviderModelOption[] {
    const strings = this.getStrings();
    const options = this.repository.getModelOptions();
    const resolvedCurrent = this.repository.resolveModelOption(assistant.modelRef);
    if (resolvedCurrent) {
      return options;
    }
    if (!assistant.modelRef) {
      return options;
    }
    return [
      ...options,
      {
        ref: assistant.modelRef,
        providerId: '',
        providerName: '',
        modelId: assistant.modelRef,
        label: `${assistant.modelRef} (${strings.modelUnavailableShort})`
      }
    ];
  }

  private postState(notice?: string): void {
    if (!this.panel) {
      return;
    }
    const assistant = this.getCurrentAssistant();
    if (!assistant) {
      this.panel.dispose();
      return;
    }

    const strings = this.getStrings();
    this.panel.title = `${strings.assistantPanelTitle} · ${assistant.name}`;
    this.panel.iconPath = getPanelIconPath(assistant.avatar ?? 'account');
    const payload: AssistantEditorState = {
      strings,
      assistant,
      groups: this.repository
        .getGroups()
        .filter((group) => group.kind !== 'deleted' || group.id === assistant.groupId)
        .map((group) => ({
          ...group,
          name:
            group.id === DEFAULT_GROUP_ID
              ? !group.name.trim() || (group.updatedAt === group.createdAt && isLegacyDefaultGroupName(group.name))
                ? strings.defaultGroupName
                : group.name
              : group.id === DELETED_GROUP_ID
                ? strings.deletedGroupName
                : group.name
        })),
      models: this.collectModelOptions(assistant),
      notice
    };
    void this.panel.webview.postMessage({ type: 'state', payload });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const codiconStyleText = getCodiconStyleText();
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${codiconStyleText}</style>
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
        max-width: 980px;
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

      .label-content {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .hint-icon {
        cursor: help;
        color: var(--muted);
        opacity: 0.95;
      }

      .hint-icon:hover,
      .hint-icon:focus {
        color: var(--fg);
        outline: none;
      }

      .field-help {
        display: none;
      }

      .avatar-picker {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .avatar-preview {
        flex: 1;
        min-width: 0;
        border: 1px solid var(--input-border);
        border-radius: 8px;
        padding: 8px 10px;
        background: var(--input-bg);
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .avatar-preview-icon {
        width: 16px;
        height: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .avatar-preview-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--muted);
        font-size: 12px;
      }

      .secondary-btn {
        border: 1px solid var(--input-border);
        border-radius: 8px;
        background: var(--input-bg);
        color: var(--input-fg);
        padding: 8px 10px;
        cursor: pointer;
        white-space: nowrap;
      }

      .secondary-btn:hover {
        background: var(--button-hover);
      }

      .note-textarea {
        min-height: 68px;
      }

      input,
      textarea,
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
        min-height: 92px;
        resize: vertical;
      }

      .checkbox-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .checkbox-row input {
        width: 14px;
        height: 14px;
      }

${SHARED_TOAST_STYLE}

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
      <div class="hero">
        <div>
          <h1 class="hero-title" id="title"></h1>
          <div class="hero-copy" id="description"></div>
        </div>
        <button class="save-btn" id="saveBtn" type="button"></button>
      </div>

      <div class="grid">
        <section class="section">
          <h2 class="section-title" id="baseSectionTitle"></h2>
          <div class="field-grid">
            <div class="field">
              <label for="name" id="nameLabel"></label>
              <input id="name" type="text" />
            </div>
            <div class="field">
              <label id="avatarLabel"></label>
              <div class="avatar-picker">
                <div class="avatar-preview" id="avatarPreview">
                  <span class="avatar-preview-icon codicon" id="avatarPreviewIcon"></span>
                  <span class="avatar-preview-text" id="avatarPreviewText"></span>
                </div>
                <button id="avatarSelectBtn" class="secondary-btn" type="button"></button>
              </div>
              <input id="avatar" type="hidden" />
            </div>
            <div class="field full">
              <label for="groupId" id="groupLabel"></label>
              <select id="groupId"></select>
            </div>
            <div class="field full">
              <label for="note" id="noteLabel"></label>
              <textarea id="note" class="note-textarea"></textarea>
            </div>
          </div>
        </section>

        <section class="section">
          <h2 class="section-title" id="modelSectionTitle"></h2>
          <div class="field-grid">
            <div class="field full">
              <label for="modelRef" id="modelLabel"></label>
              <select id="modelRef"></select>
            </div>
            <div class="field full">
              <div class="checkbox-row">
                <input id="streaming" type="checkbox" />
                <label for="streaming" id="streamingLabel"></label>
              </div>
            </div>
          </div>
        </section>

        <section class="section">
          <h2 class="section-title" id="promptSectionTitle"></h2>
          <div class="field-grid">
            <div class="field full">
              <label for="greeting" id="greetingLabel"></label>
              <textarea id="greeting"></textarea>
            </div>
            <div class="field full">
              <label for="systemPrompt" id="promptLabel"></label>
              <textarea id="systemPrompt"></textarea>
            </div>
            <div class="field full">
              <label for="questionPrefix" id="questionPrefixLabel"></label>
              <textarea id="questionPrefix"></textarea>
            </div>
          </div>
        </section>

        <section class="section">
          <h2 class="section-title" id="paramsSectionTitle"></h2>
          <div class="field-grid">
            <div class="field">
              <label for="temperature" id="temperatureLabel"></label>
              <input id="temperature" type="number" min="0" max="2" step="0.1" />
            </div>
            <div class="field">
              <label for="topP" id="topPLabel"></label>
              <input id="topP" type="number" min="0" max="1" step="0.1" />
            </div>
            <div class="field">
              <label for="maxTokens" id="maxTokensLabel"></label>
              <input id="maxTokens" type="number" min="0" max="65535" step="1" />
            </div>
            <div class="field">
              <label for="contextCount" id="contextCountLabel"></label>
              <input id="contextCount" type="number" min="0" step="1" />
            </div>
            <div class="field">
              <label for="presencePenalty" id="presencePenaltyLabel"></label>
              <input id="presencePenalty" type="number" min="-2" max="2" step="0.1" />
            </div>
            <div class="field">
              <label for="frequencyPenalty" id="frequencyPenaltyLabel"></label>
              <input id="frequencyPenalty" type="number" min="-2" max="2" step="0.1" />
            </div>
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
        saveBtn: document.getElementById('saveBtn'),
        baseSectionTitle: document.getElementById('baseSectionTitle'),
        promptSectionTitle: document.getElementById('promptSectionTitle'),
        modelSectionTitle: document.getElementById('modelSectionTitle'),
        paramsSectionTitle: document.getElementById('paramsSectionTitle'),
        nameLabel: document.getElementById('nameLabel'),
        noteLabel: document.getElementById('noteLabel'),
        avatarLabel: document.getElementById('avatarLabel'),
        avatarSelectBtn: document.getElementById('avatarSelectBtn'),
        greetingLabel: document.getElementById('greetingLabel'),
        promptLabel: document.getElementById('promptLabel'),
        questionPrefixLabel: document.getElementById('questionPrefixLabel'),
        groupLabel: document.getElementById('groupLabel'),
        modelLabel: document.getElementById('modelLabel'),
        streamingLabel: document.getElementById('streamingLabel'),
        temperatureLabel: document.getElementById('temperatureLabel'),
        topPLabel: document.getElementById('topPLabel'),
        maxTokensLabel: document.getElementById('maxTokensLabel'),
        contextCountLabel: document.getElementById('contextCountLabel'),
        presencePenaltyLabel: document.getElementById('presencePenaltyLabel'),
        frequencyPenaltyLabel: document.getElementById('frequencyPenaltyLabel'),
        name: document.getElementById('name'),
        note: document.getElementById('note'),
        avatar: document.getElementById('avatar'),
        avatarPreviewIcon: document.getElementById('avatarPreviewIcon'),
        avatarPreviewText: document.getElementById('avatarPreviewText'),
        greeting: document.getElementById('greeting'),
        systemPrompt: document.getElementById('systemPrompt'),
        questionPrefix: document.getElementById('questionPrefix'),
        groupId: document.getElementById('groupId'),
        modelRef: document.getElementById('modelRef'),
        streaming: document.getElementById('streaming'),
        temperature: document.getElementById('temperature'),
        topP: document.getElementById('topP'),
        maxTokens: document.getElementById('maxTokens'),
        contextCount: document.getElementById('contextCount'),
        presencePenalty: document.getElementById('presencePenalty'),
        frequencyPenalty: document.getElementById('frequencyPenalty'),
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

      function renderText(strings) {
        dom.title.textContent = strings.assistantEditorTitle;
        dom.description.textContent = strings.assistantEditorDescription;
        dom.saveBtn.textContent = strings.assistantSaveAction;
        dom.baseSectionTitle.textContent = strings.assistantBaseSection;
        dom.promptSectionTitle.textContent = strings.assistantPromptSection;
        dom.modelSectionTitle.textContent = strings.assistantModelSection;
        dom.paramsSectionTitle.textContent = strings.assistantParamsSection;
        dom.nameLabel.textContent = strings.assistantNameLabel;
        dom.noteLabel.textContent = strings.assistantNoteLabel;
        dom.avatarLabel.textContent = strings.assistantAvatarLabel;
        dom.avatarSelectBtn.textContent = strings.assistantAvatarSelectAction;
        dom.greetingLabel.textContent = strings.assistantGreetingLabel;
        dom.promptLabel.textContent = strings.assistantPromptLabel;
        dom.questionPrefixLabel.textContent = strings.assistantQuestionPrefixLabel;
        dom.groupLabel.textContent = strings.assistantGroupLabel;
        dom.modelLabel.textContent = strings.assistantModelLabel;
        dom.streamingLabel.textContent = strings.assistantStreamingLabel;
        dom.temperatureLabel.textContent = strings.temperatureLabel;
        dom.topPLabel.textContent = strings.topPLabel;
        dom.maxTokensLabel.textContent = strings.maxTokensLabel;
        dom.contextCountLabel.textContent = strings.contextCountLabel;
        dom.presencePenaltyLabel.textContent = strings.presencePenaltyLabel;
        dom.frequencyPenaltyLabel.textContent = strings.frequencyPenaltyLabel;
        dom.saveBtn.title = strings.assistantSaveAction;
        dom.avatarSelectBtn.title = strings.assistantAvatarSelectAction;
        dom.groupId.title = strings.assistantGroupLabel;
        dom.modelRef.title = strings.assistantModelLabel;
      }

      function renderOptions() {
        dom.groupId.innerHTML = (state.groups || []).map((group) => {
          return '<option value="' + escapeHtml(group.id) + '">' + escapeHtml(group.name) + '</option>';
        }).join('');
        dom.modelRef.innerHTML = (state.models || []).map((model) => {
          return '<option value="' + escapeHtml(model.ref) + '">' + escapeHtml(model.label) + '</option>';
        }).join('');
      }

      function ensureModelOption(modelRef) {
        if (!modelRef) {
          return;
        }
        const exists = Array.from(dom.modelRef.options).some((option) => option.value === modelRef);
        if (!exists) {
          const option = document.createElement('option');
          option.value = modelRef;
          option.textContent = modelRef;
          dom.modelRef.appendChild(option);
        }
      }

      function normalizeAvatarValue(value) {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw || !/^[a-z0-9-]+$/.test(raw)) {
          return 'account';
        }
        return raw;
      }

      function renderAvatarPreview() {
        const avatar = normalizeAvatarValue(dom.avatar.value);
        dom.avatar.value = avatar;
        dom.avatarPreviewIcon.className = 'avatar-preview-icon codicon codicon-' + avatar;
        const beforeContent = window.getComputedStyle(dom.avatarPreviewIcon, '::before').content;
        const hasGlyph = Boolean(beforeContent && beforeContent !== 'none' && beforeContent !== '""');
        if (!hasGlyph && avatar !== 'account') {
          dom.avatar.value = 'account';
          dom.avatarPreviewIcon.className = 'avatar-preview-icon codicon codicon-account';
          dom.avatarPreviewText.textContent = 'account';
          return;
        }
        dom.avatarPreviewText.textContent = avatar;
      }

      function renderValues() {
        const assistant = state.assistant;
        dom.name.value = assistant.name || '';
        dom.note.value = assistant.note || '';
        dom.avatar.value = normalizeAvatarValue(assistant.avatar || 'account');
        dom.greeting.value = assistant.greeting || '';
        dom.systemPrompt.value = assistant.systemPrompt || '';
        dom.questionPrefix.value = assistant.questionPrefix || '';
        dom.groupId.value = assistant.groupId || '';
        ensureModelOption(assistant.modelRef);
        dom.modelRef.value = assistant.modelRef || '';
        dom.streaming.checked = !!assistant.streaming;
        dom.temperature.value = String(assistant.temperature ?? 0.7);
        dom.topP.value = String(assistant.topP ?? 1);
        dom.maxTokens.value = String(assistant.maxTokens ?? 0);
        dom.contextCount.value = String(assistant.contextCount ?? 16);
        dom.presencePenalty.value = String(assistant.presencePenalty ?? 0);
        dom.frequencyPenalty.value = String(assistant.frequencyPenalty ?? 0);
        renderAvatarPreview();
      }

      function renderAll() {
        renderText(state.strings);
        renderOptions();
        renderValues();
      }

      function collectPayload() {
        return {
          name: dom.name.value,
          note: dom.note.value,
          avatar: dom.avatar.value.trim(),
          greeting: dom.greeting.value,
          systemPrompt: dom.systemPrompt.value,
          questionPrefix: dom.questionPrefix.value,
          groupId: dom.groupId.value,
          modelRef: dom.modelRef.value,
          streaming: !!dom.streaming.checked,
          temperature: Number.parseFloat(dom.temperature.value),
          topP: Number.parseFloat(dom.topP.value),
          maxTokens: Number.parseInt(dom.maxTokens.value, 10),
          contextCount: Number.parseInt(dom.contextCount.value, 10),
          presencePenalty: Number.parseFloat(dom.presencePenalty.value),
          frequencyPenalty: Number.parseFloat(dom.frequencyPenalty.value)
        };
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type === 'avatarPicked') {
          const pickedIcon = message?.payload?.icon;
          if (typeof pickedIcon === 'string' && pickedIcon.trim()) {
            dom.avatar.value = normalizeAvatarValue(pickedIcon);
            renderAvatarPreview();
          }
          return;
        }
        if (message?.type !== 'state') {
          return;
        }
        state = message.payload;
        renderAll();
        if (state.notice) {
          const tone = state.notice === state.strings.assistantSaved ? 'success' : 'error';
          if (state.notice !== lastToastNotice) {
            showToast(state.notice, tone);
          }
          lastToastNotice = state.notice;
        } else {
          lastToastNotice = '';
        }
      });

      dom.avatarSelectBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'pickAvatar',
          currentAvatar: dom.avatar.value
        });
      });

      dom.saveBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'save',
          payload: collectPayload()
        });
      });

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }
}
