/**
 * 共享 Modal 弹窗样式。
 *
 * 提供跨 WebView 面板（Chat、Assistant Editor）复用的
 * Modal 弹窗样式，参考 settingsCenterModalCss.ts 的设计。
 */
export const SHARED_MODAL_STYLE = `
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
        border-radius: var(--radius-xl);
        background: var(--bg);
        padding: 16px;
        display: grid;
        gap: 12px;
      }

      .modal-card-wide {
        width: min(800px, 90%);
        max-height: 80vh;
      }

      .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0;
      }

      .modal-title {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
      }

      .modal-close {
        border: 0;
        background: transparent;
        color: var(--muted);
        width: 28px;
        height: 28px;
        padding: 0;
        cursor: pointer;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .modal-close:hover {
        background: var(--panel-bg-strong);
      }

      .modal-body {
        overflow-y: auto;
        flex: 1;
        min-height: 0;
      }

      .modal-body pre {
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--vscode-editor-font-family, "Cascadia Code", "JetBrains Mono", monospace);
        font-size: 13px;
        line-height: 1.6;
        color: var(--fg);
        margin: 0;
      }
`;
