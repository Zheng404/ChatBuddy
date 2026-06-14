/**
 * 侧边栏 WebviewView 抽象基类。
 *
 * 实现 vscode.WebviewViewProvider 接口，封装 4 个侧边栏 view 共有的生命周期：
 * - HTML 注入与 onDidReceiveMessage 监听注册
 * - ready 握手协议（前端加载完成后发送 {type:'ready'}，Host 收到后才推送状态）
 * - 全量状态推送（未 ready 时静默丢弃，避免竞态）
 * - 显式清空搜索（reset / import 场景调用）
 * - 资源释放
 *
 * 参考生命周期模式：settingsCenterPanel.ts、assistantEditorPanel.ts。
 *
 * 注意：retainContextWhenHidden 在 registerWebviewViewProvider 的 options 里设置，
 *      不由此类管理（由工厂文件负责）。
 */
import * as vscode from 'vscode';

export abstract class BaseSidebarViewProvider<TState, TMessage extends { type: string }>
  implements vscode.WebviewViewProvider
{
  protected view: vscode.WebviewView | undefined;
  private ready = false;
  private messageListener: vscode.Disposable | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    protected readonly extensionUri: vscode.Uri,
    protected readonly viewType: string,
    private readonly htmlBuilder: (webview: vscode.Webview) => string,
    private readonly onReadyCallback: () => void
  ) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = this.createWebviewOptions();
    view.webview.html = this.htmlBuilder(view.webview);
    this.messageListener = view.webview.onDidReceiveMessage((raw: unknown) => {
      this.handleMessageWrapper(raw as TMessage);
    });
    view.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  /** 全量状态推送，未 ready 时静默丢弃避免首屏竞态 */
  public postState(state: TState): void {
    if (!this.view || !this.ready) {
      return;
    }
    // postMessage 可能在 view 释放前投递失败，安全忽略
    void this.view.webview
      .postMessage({ type: 'state', payload: state })
      .then(undefined, () => {});
  }

  /** 显式清空搜索框（reset / import 场景调用） */
  public postClearSearch(): void {
    if (!this.view || !this.ready) {
      return;
    }
    void this.view.webview
      .postMessage({ type: 'clearSearch' })
      .then(undefined, () => {});
  }

  public isReady(): boolean {
    return this.ready;
  }

  public isVisible(): boolean {
    return this.view?.visible ?? false;
  }

  protected createWebviewOptions(): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
  }

  private handleMessageWrapper(message: TMessage): void {
    if (message.type === 'ready') {
      this.ready = true;
      this.onReadyCallback();
      return;
    }
    this.handleMessage(message);
  }

  /** 子类实现非 ready 消息的具体处理逻辑 */
  protected abstract handleMessage(message: TMessage): void | Promise<void>;

  public dispose(): void {
    this.ready = false;
    this.messageListener?.dispose();
    this.messageListener = undefined;
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
    this.view = undefined;
  }
}
