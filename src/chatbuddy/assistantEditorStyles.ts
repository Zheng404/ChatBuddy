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

      .failover-help {
        font-size: 12px;
        color: var(--muted);
        margin-bottom: 8px;
        line-height: 1.5;
      }

      .failover-check-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 200px;
        overflow-y: auto;
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 8px;
      }

      .failover-check-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 0;
        cursor: pointer;
        font-size: 13px;
      }

      .failover-check-item input[type="checkbox"] {
        width: 14px;
        height: 14px;
        cursor: pointer;
        flex-shrink: 0;
      }

      .failover-check-item span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .collapsible-section {
        padding: 0;
        overflow: hidden;
      }

      .collapsible-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 16px;
        background: none;
        border: none;
        cursor: pointer;
        color: inherit;
        font: inherit;
        text-align: left;
      }

      .collapsible-header .section-title {
        margin: 0;
      }

      .collapsible-icon {
        font-size: 14px;
        color: var(--muted);
        transition: transform 0.15s ease;
      }

      .collapsible-header.collapsed .collapsible-icon {
        transform: rotate(-90deg);
      }

      .collapsible-body {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.25s ease;
      }

      .collapsible-body.open {
        max-height: 800px;
      }

      .collapsible-body .field-grid {
        padding: 0 16px 16px;
      }

      .sub-section-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-top: 8px;
      }

      .hero-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
      }

      .raw-modal-overlay { position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:1000 }
      .raw-modal-overlay.visible { display:flex }
      .raw-modal { width:min(520px,90%);max-height:none;border:1px solid var(--border);border-radius:12px;background:var(--bg);display:flex;flex-direction:column;overflow:hidden }
      .raw-modal-header { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid var(--border) }
      .raw-modal-title { font-weight:600; font-size:14px }
      .raw-modal-close { display:flex; align-items:center; justify-content:center; border:none; background:transparent; color:var(--muted); cursor:pointer; width:28px; height:28px; border-radius:4px }
      .raw-modal-close:hover { background:var(--hover-bg) }
      .raw-modal-body { padding:16px; overflow-y:auto; flex:1; min-height:0 }
      .confirm-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:16px }
      .save-template-field { display:flex; flex-direction:column; gap:4px; margin-bottom:12px }
      .save-template-field label { font-size:12px; color:var(--muted); font-weight:500 }
      .save-template-field input, .save-template-field textarea { padding:6px 8px; border:1px solid var(--border); border-radius:4px; background:var(--input-bg); color:var(--fg); font-family:inherit; font-size:13px; resize:vertical }
      .save-template-preview { margin-bottom:8px }
      .save-template-preview > div { font-size:12px; color:var(--muted); margin-bottom:4px }
      .save-template-preview pre { margin:0; padding:8px 10px; border:1px solid var(--border); border-radius:4px; background:var(--input-bg); color:var(--muted); font-size:12px; max-height:160px; overflow:auto; white-space:pre-wrap; word-break:break-word }

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
