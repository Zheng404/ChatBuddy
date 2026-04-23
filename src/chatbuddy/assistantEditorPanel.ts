/**
 * 助手编辑器面板控制器。
 *
 * 管理助手创建/编辑的 WebViewPanel，提供表单界面供用户编辑助手的
 * 所有属性（名称、系统提示词、问候语、模型选择、温度等参数）。
 *
 * 类型/常量/工具 → assistantEditorTypes.ts
 * 自定义样式     → assistantEditorStyles.ts
 * HTML/JS 模板   → assistantEditorJs.ts
 */
import * as vscode from 'vscode';

import { getPanelIconPath } from './panelIcon';
import { ChatStateRepository, UpdateAssistantInput } from './stateRepository';
import type { AssistantProfile, RuntimeStrings } from './types';
import { getCodiconStyleText } from './codicon';
import { getStrings, resolveLocale } from './i18n';
import { getNonce, buildCsp } from './utils';

import type {
  AssistantEditorMessage,
  AssistantEditorState
} from './assistantEditorTypes';
import { toUpdatePayload, getAvailableAvatarIcons, buildEditorGroups } from './assistantEditorTypes';
import { getAssistantEditorStyles } from './assistantEditorStyles';
import { getAssistantEditorHtmlBody, getAssistantEditorJs } from './assistantEditorJs';

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
          retainContextWhenHidden: true
        }
      );
      this.panel.iconPath = getPanelIconPath('account');
      this.panel.webview.html = this.getHtml(this.panel.webview);
      const messageListener = this.panel.webview.onDidReceiveMessage(async (message: AssistantEditorMessage) => {
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
          }).then(undefined, () => {});
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
      this.panel.onDidDispose(() => {
        messageListener.dispose();
        this.panel = undefined;
        this.editingAssistantId = undefined;
        this.creatingAssistantDraft = undefined;
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
      groupId: 'default',
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
      enabledMcpServerIds: [],
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

  private collectModelOptions(assistant: AssistantProfile) {
    const strings = this.getStrings();
    const options = this.repository.getModelOptions(false, strings as unknown as Record<string, string>);
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
      groups: buildEditorGroups(this.repository, assistant, strings),
      models: this.collectModelOptions(assistant),
      mcpServers: this.repository.getMcpServers().filter((s) => s.enabled).map((server) => ({
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        transport: server.transport
      })),
      notice
    };
    void this.panel.webview.postMessage({ type: 'state', payload }).then(undefined, () => {});
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const codiconStyleText = getCodiconStyleText();
    const csp = buildCsp(webview, nonce);

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${codiconStyleText}</style>
    <style>${getAssistantEditorStyles()}</style>
  </head>
  <body>
    ${getAssistantEditorHtmlBody()}
    <script nonce="${nonce}">
      ${getAssistantEditorJs()}
    </script>
  </body>
</html>`;
  }
}
