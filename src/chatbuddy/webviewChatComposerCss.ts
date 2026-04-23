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

      .composer-resizer {
        height: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: ns-resize;
        border-bottom: 1px solid var(--border);
        background: color-mix(in srgb, var(--input-bg) 94%, var(--fg) 6%);
      }

      .composer-resizer::before {
        content: '';
        width: 42px;
        height: 3px;
        border-radius: 999px;
        background: var(--border);
      }

      .composer-resizer:hover {
        background: var(--toolbar-hover);
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
        gap: 12px;
        flex-wrap: wrap;
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

      .send-group .btn-primary,
      .send-group .btn-secondary {
        border-radius: 10px;
        padding: 8px 12px;
        gap: 8px;
      }

      .send-group .btn-secondary {
        border-color: transparent;
      }

      .send-group .btn-secondary:hover {
        background: var(--toolbar-hover);
      }

      .toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--muted);
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
        min-width: 260px;
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
  `;
}
