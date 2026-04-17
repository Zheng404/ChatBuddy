import * as vscode from 'vscode';

import { getCodiconRootUri } from './codicon';
import { getStrings } from './i18n';
import { getPanelIconPath } from './panelIcon';
import { ChatStateRepository } from './stateRepository';
import { RuntimeLocale, WebviewInboundMessage } from './types';
import { ToolOrchestratorPanelContext } from './chatControllerToolOrchestrator';

const CHAT_PANEL_VIEW_TYPE = 'chatbuddy.mainChat';

type ChatPanelManagerDeps = {
  repository: ChatStateRepository;
  extensionUri: vscode.Uri;
  getLocale: () => RuntimeLocale;
  ensureSession: (assistantId: string) => void;
  setStreamingEnabled: (enabled: boolean) => void;
  renderWebviewHtml: (webview: vscode.Webview) => string;
  handleWebviewMessage: (message: WebviewInboundMessage, context: ToolOrchestratorPanelContext) => Promise<void>;
  handlePanelDisposing: (panel: vscode.WebviewPanel, assistantId?: string) => void;
};

type PendingPanelState = {
  error?: string;
  assistantId?: string;
};

export type OpenAssistantChatResult = {
  panel: vscode.WebviewPanel;
  panelReady: boolean;
};

export class ChatPanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private readonly panelsByAssistantId = new Map<string, vscode.WebviewPanel>();
  private readonly panelReadyState = new WeakMap<vscode.WebviewPanel, boolean>();
  private readonly pendingPanelStates = new WeakMap<vscode.WebviewPanel, PendingPanelState>();
  private onActivePanelChange?: () => void;

  constructor(private readonly deps: ChatPanelManagerDeps) {}

  public getActivePanel(): vscode.WebviewPanel | undefined {
    return this.panel;
  }

  public getPanelsByAssistantId(): Map<string, vscode.WebviewPanel> {
    return this.panelsByAssistantId;
  }

  public setActivePanel(panel: vscode.WebviewPanel | undefined): void {
    this.panel = panel;
  }

  public isPanelReady(panel: vscode.WebviewPanel): boolean {
    return this.panelReadyState.get(panel) === true;
  }

  public queuePendingState(panel: vscode.WebviewPanel, state: PendingPanelState): void {
    const current = this.pendingPanelStates.get(panel);
    this.pendingPanelStates.set(panel, {
      assistantId: state.assistantId ?? current?.assistantId,
      error: state.error
    });
  }

  public markPanelReady(panel: vscode.WebviewPanel): PendingPanelState | undefined {
    this.panelReadyState.set(panel, true);
    const pending = this.pendingPanelStates.get(panel);
    this.pendingPanelStates.delete(panel);
    return pending;
  }

  public openAssistantChat(assistantId?: string): OpenAssistantChatResult {
    if (assistantId) {
      this.deps.repository.setSelectedAssistant(assistantId);
    }

    const assistant = this.deps.repository.getSelectedAssistant();
    if (assistant && !assistant.isDeleted) {
      this.deps.ensureSession(assistant.id);
      this.deps.setStreamingEnabled(assistant.streaming);
    }

    const strings = getStrings(this.deps.getLocale());
    const panelTitle = assistant?.name?.trim() || strings.chatPanelTitle;
    const panelIcon = getPanelIconPath(assistant?.avatar ?? 'account');
    const chatTabMode = this.deps.repository.getSettings().chatTabMode;

    if (chatTabMode === 'multi' && assistant) {
      const existing = this.panelsByAssistantId.get(assistant.id);
      if (existing) {
        this.presentPanel(existing, panelTitle, panelIcon);
        existing.reveal(vscode.ViewColumn.One);
        this.panel = existing;
        return {
          panel: existing,
          panelReady: this.isPanelReady(existing)
        };
      } else {
        const newPanel = this.createChatPanel(panelTitle, panelIcon, { assistantId: assistant.id });
        this.panelsByAssistantId.set(assistant.id, newPanel);
        this.panel = newPanel;
        return {
          panel: newPanel,
          panelReady: false
        };
      }
    }

    if (!this.panel) {
      this.panel = this.createChatPanel(panelTitle, panelIcon);
      return {
        panel: this.panel,
        panelReady: false
      };
    }

    this.presentPanel(this.panel, panelTitle, panelIcon);
    this.panel.reveal(vscode.ViewColumn.One);
    return {
      panel: this.panel,
      panelReady: this.isPanelReady(this.panel)
    };
  }

  public disposePanelForAssistant(assistantId: string): void {
    const panel = this.panelsByAssistantId.get(assistantId);
    if (!panel) {
      return;
    }
    this.panelsByAssistantId.delete(assistantId);
    panel.dispose();
    if (this.panel === panel) {
      this.panel = undefined;
    }
  }

  public setActivePanelChangeCallback(callback: () => void): void {
    this.onActivePanelChange = callback;
  }

  public dispose(): void {
    for (const panel of this.panelsByAssistantId.values()) {
      panel.dispose();
    }
    this.panelsByAssistantId.clear();
    this.panel?.dispose();
    this.panel = undefined;
  }

  private createPanelOptions(): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [getCodiconRootUri(), vscode.Uri.joinPath(this.deps.extensionUri, 'node_modules')]
    };
  }

  private presentPanel(panel: vscode.WebviewPanel, title: string, iconPath: vscode.IconPath): void {
    panel.title = title;
    panel.iconPath = iconPath;
  }

  private createChatPanel(
    panelTitle: string,
    panelIcon: vscode.IconPath,
    context: { assistantId?: string } = {}
  ): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      CHAT_PANEL_VIEW_TYPE,
      panelTitle,
      vscode.ViewColumn.One,
      this.createPanelOptions()
    );
    this.presentPanel(panel, panelTitle, panelIcon);
    panel.webview.html = this.deps.renderWebviewHtml(panel.webview);
    this.panelReadyState.set(panel, false);

    const messageListener = panel.webview.onDidReceiveMessage((message: WebviewInboundMessage) => {
      this.panel = panel;
      this.deps.handleWebviewMessage(message, {
        panel,
        assistantId: context.assistantId
      }).catch(() => {});
    });

    const viewStateListener = panel.onDidChangeViewState((event) => {
      if (!event.webviewPanel.active || !context.assistantId) {
        return;
      }
      this.panel = panel;
      this.deps.repository.setSelectedAssistant(context.assistantId);
      this.onActivePanelChange?.();
    });

    panel.onDidDispose(() => {
      this.deps.handlePanelDisposing(panel, context.assistantId);
      messageListener.dispose();
      viewStateListener.dispose();
      if (context.assistantId) {
        this.panelsByAssistantId.delete(context.assistantId);
      }
      this.panelReadyState.delete(panel);
      this.pendingPanelStates.delete(panel);
      if (this.panel === panel) {
        this.panel = undefined;
      }
    });

    return panel;
  }
}
