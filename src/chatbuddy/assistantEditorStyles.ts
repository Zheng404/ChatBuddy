/**
 * 助手编辑器自定义样式。
 *
 * 从 assistantEditorPanel 的 getHtml 方法中提取的 CSS。
 */
import { SHARED_WEBVIEW_BASE } from './webviewBaseTheme';
import { SHARED_FORM_STYLE } from './webviewFormTheme';
import { SHARED_TOAST_STYLE } from './webviewShared';

export function getAssistantEditorStyles(): string {
  return `${SHARED_WEBVIEW_BASE}
      body {
        padding: 24px;
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

      ${SHARED_FORM_STYLE}

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

      .note-textarea {
        min-height: 68px;
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

      .mcp-server-check-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .mcp-server-check-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
        cursor: pointer;
        font-size: 13px;
      }

      .mcp-server-check-item input[type="checkbox"] {
        width: 14px;
        height: 14px;
        cursor: pointer;
      }

      .mcp-server-check-item .mcp-server-transport {
        font-size: 11px;
        color: var(--muted);
      }

${SHARED_TOAST_STYLE}

      @media (max-width: 760px) {
        body {
          padding: 16px;
        }

        .field-grid {
          grid-template-columns: 1fr;
        }
      }`;
}
