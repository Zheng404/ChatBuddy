/**
 * 聊天面板 Composer（输入区）样式。
 *
 * 包含：composer shell/box/resizer、textarea、actions、chips、
 * action-btn、toggle、model-select、temp-chip、图片预览栏。
 */
export function getWebviewChatComposerCss(): string {
  return `
      .composer-shell {
        flex-shrink: 0;
        padding: 0 0 8px;
        background: var(--bg);
        position: relative;
        z-index: 1;
      }

      .composer {
        max-width: none;
        margin: 0;
      }

      .composer-box {
        border: 1px solid var(--input-border);
        border-radius: 14px;
        background: var(--input-bg);
        overflow: hidden;
      }

      .composer-toolbar {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--border);
        cursor: ns-resize;
        background: color-mix(in srgb, var(--input-bg) 94%, var(--fg) 6%);
        user-select: none;
      }

      .composer-toolbar::before {
        content: '';
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 80px;
        height: 4px;
        border-radius: 999px;
        background: var(--border);
        pointer-events: none;
        transition: all 0.3s ease;
      }

      .composer-toolbar.generating::before {
        background: linear-gradient(90deg, var(--border), var(--accent), var(--border));
        background-size: 200% 100%;
        animation: tb-sweep 1.4s linear infinite;
      }

      @keyframes tb-sweep {
        0% { background-position: 100% center; }
        50% { background-position: 0% center; }
        100% { background-position: 100% center; }
      }

      .composer-toolbar:hover {
        background: var(--toolbar-hover);
      }

      .composer-toolbar-left {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .composer-toolbar-right {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .composer-toolbar .action-btn-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        color: var(--muted);
        cursor: pointer;
        padding: 6px;
        border-radius: 6px;
      }

      .composer-toolbar .action-btn-icon:hover {
        background: var(--toolbar-hover);
        color: var(--fg);
      }

      .composer-toolbar .action-btn-icon .codicon {
        font-size: 16px;
      }

      .composer-textarea {
        width: 100%;
        min-height: 100px;
        max-height: 340px;
        height: 130px;
        padding: 14px 14px 10px;
        border: 0;
        outline: none;
        resize: none;
        background: transparent;
        color: var(--input-fg);
      }

      body.resizing,
      body.resizing * {
        cursor: ns-resize !important;
        user-select: none !important;
      }

      .composer-actions {
        padding: 0 10px 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .composer-inline-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 1;
        min-width: 0;
        overflow: visible;
        position: relative;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 9px;
        border: 1px solid var(--border);
        border-radius: 999px;
        font-size: 11px;
        color: var(--muted);
      }

      .send-group {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .send-group .btn-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        color: var(--muted);
        cursor: pointer;
        padding: 6px;
        border-radius: 6px;
      }

      .send-group .btn-icon:hover {
        background: var(--toolbar-hover);
        color: var(--fg);
      }

      .send-group .btn-icon .codicon {
        font-size: 18px;
      }

      .send-group .btn-primary,
      .send-group .btn-stop {
        border-radius: 10px;
        padding: 8px 12px;
        gap: 8px;
      }

      .send-group .btn-stop {
        border-color: transparent;
        background: #be1100;
        color: #fff;
      }

      .send-group .btn-stop:hover {
        background: #991a0a;
      }

      .toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--muted);
        white-space: nowrap;
        flex-shrink: 0;
      }

      .toggle input {
        margin: 0;
      }

      .composer-controls {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }

      .model-select {
        min-width: 120px;
        max-width: 320px;
        flex-shrink: 1;
        border: 1px solid var(--input-border);
        border-radius: 8px;
        background: var(--input-bg);
        color: var(--input-fg);
        padding: 4px 8px;
      }

      .temp-chip {
        display: none;
      }

      .temp-chip.visible {
        display: inline-flex;
      }

      .mcp-health-chip {
        display: none;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        cursor: default;
      }

      .mcp-health-chip.visible {
        display: inline-flex;
      }

      .mcp-health-chip.status-ok {
        color: var(--vscode-testing-iconPassed, #16a34a);
      }

      .mcp-health-chip.status-warn {
        color: var(--vscode-editorWarning-foreground, #facc15);
      }

      .mcp-health-chip.status-error {
        color: var(--vscode-errorForeground, #dc2626);
      }

      .temp-params-toggle {
        opacity: 0.7;
        cursor: pointer;
        flex-shrink: 0;
      }
      .temp-params-toggle:hover {
        opacity: 1;
      }
      .temp-params-toggle:disabled {
        opacity: 0.3;
        cursor: default;
      }

      .temp-params-popup {
        display: none;
        position: fixed;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 10px 12px;
        min-width: 240px;
        z-index: 9999;
        box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      }
      .temp-params-popup.visible {
        display: block;
      }

      .temp-params-popup-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--fg);
      }

      .temp-params-popup-body {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .temp-params-field {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--fg);
      }
      .temp-params-field span {
        min-width: 80px;
        flex-shrink: 0;
        white-space: nowrap;
      }
      .temp-params-field input {
        flex: 1;
        width: 100%;
        min-width: 60px;
        padding: 3px 6px;
        font-size: 12px;
        background: var(--input-bg);
        color: var(--input-fg);
        border: 1px solid var(--border);
        border-radius: 3px;
        outline: none;
      }
      .temp-params-field input:focus {
        border-color: var(--focus-border);
      }

      .image-preview-bar {
        display: none;
        flex-direction: row;
        gap: 6px;
        padding: 6px 10px 0;
        overflow-x: auto;
        flex-shrink: 0;
      }

      .image-preview-bar.visible {
        display: flex;
      }

      .image-preview-item {
        position: relative;
        flex-shrink: 0;
      }

      .image-preview-thumb {
        width: 60px;
        height: 60px;
        object-fit: cover;
        border-radius: 6px;
        border: 1px solid var(--border);
      }

      .image-preview-remove {
        position: absolute;
        top: -4px;
        right: -4px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: none;
        background: var(--fg);
        color: var(--bg);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }

      .image-preview-remove .codicon {
        font-size: 12px;
      }

      .file-preview-bar {
        display: none;
        flex-direction: column;
        gap: 4px;
        padding: 6px 10px 0;
        flex-shrink: 0;
      }

      .file-preview-bar.visible {
        display: flex;
      }

      .file-preview-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 10px;
        border-radius: 6px;
        background: color-mix(in srgb, var(--input-bg) 92%, var(--fg) 8%);
        border: 1px solid var(--border);
        font-size: 12px;
        color: var(--muted);
      }

      .file-preview-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .file-preview-remove {
        flex-shrink: 0;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: none;
        background: var(--fg);
        color: var(--bg);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }

      .file-preview-remove .codicon {
        font-size: 12px;
      }

      /* Note: File drag-and-drop is not supported in VS Code WebViews. */
  `;
}
