import { SHARED_TOAST_STYLE } from './toastTheme';

/**
 * Returns the CSS for the settings center webview panel.
 * Contains all styles for the settings UI including navigation,
 * form elements, provider workspace, MCP section, and modals.
 */
export function getSettingsCenterCss(): string {
  return `
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
        --panel-bg: color-mix(in srgb, var(--bg) 92%, white 8%);
        --panel-bg-strong: color-mix(in srgb, var(--bg) 86%, white 14%);
        --accent: var(--vscode-focusBorder, var(--vscode-button-background));
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 18px;
        background: var(--bg);
        color: var(--fg);
        font-family: var(--vscode-font-family);
      }

      button,
      input,
      select {
        font: inherit;
      }

      .shell {
        max-width: 1380px;
        margin: 0 auto;
      }



      .frame {
        border: 1px solid var(--border);
        border-radius: 14px;
        overflow: hidden;
        display: grid;
        grid-template-columns: 260px minmax(0, 1fr);
        min-height: 720px;
        background: var(--panel-bg);
      }

      .settings-nav {
        border-right: 1px solid var(--border);
        background: color-mix(in srgb, var(--bg) 96%, white 4%);
        padding: 16px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .nav-heading {
        padding: 4px 6px 10px;
      }

      .nav-heading-title {
        margin: 0;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .nav-item {
        width: 100%;
        border: 1px solid transparent;
        border-radius: 12px;
        background: transparent;
        color: inherit;
        text-align: left;
        padding: 12px;
        cursor: pointer;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 10px;
        align-items: center;
      }

      .nav-item:hover {
        background: var(--panel-bg-strong);
      }

      .nav-item.active {
        background: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
        border-color: color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 75%, white 25%);
      }

      .nav-item-content {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }

      .nav-item-icon {
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.8;
      }

      .nav-item.active .nav-item-icon {
        opacity: 1;
      }

      .nav-item-title {
        font-size: 13px;
        font-weight: 700;
      }

      .nav-item-desc {
        font-size: 11px;
        line-height: 1.5;
        color: inherit;
        opacity: 0.8;
      }

      .settings-content {
        min-width: 0;
        padding: 16px;
      }

      .settings-pane {
        display: none;
      }

      .settings-pane.active {
        display: block;
      }

      .pane-toolbar {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-bottom: 12px;
      }

      .btn-primary {
        border: 1px solid transparent;
        border-radius: 8px;
        padding: 8px 14px;
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
        padding: 8px 14px;
        background: transparent;
        color: var(--fg);
        cursor: pointer;
        white-space: nowrap;
      }

      .btn-secondary:hover {
        background: var(--panel-bg-strong);
      }

      .btn-danger {
        border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
        border-radius: 8px;
        padding: 8px 14px;
        background: transparent;
        color: var(--vscode-inputValidation-errorForeground, var(--fg));
        cursor: pointer;
        white-space: nowrap;
      }

      .btn-danger:hover {
        background: var(--panel-bg-strong);
      }

      .btn-danger.filled {
        background: var(--vscode-inputValidation-errorBackground, rgba(190, 17, 0, 0.1));
      }

      .section-grid {
        display: grid;
        gap: 16px;
      }

      .section-card,
      .panel {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 16px;
        background: color-mix(in srgb, var(--bg) 96%, white 4%);
      }

      .section-title,
      .panel-title {
        margin: 0 0 12px;
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

      input,
      select,
      textarea {
        width: 100%;
        border: 1px solid var(--input-border);
        border-radius: 8px;
        padding: 9px 10px;
        background: var(--input-bg);
        color: var(--input-fg);
      }

      textarea {
        min-height: 72px;
        resize: vertical;
        font: inherit;
      }

      .help {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.55;
      }

      .help.invalid {
        color: var(--vscode-inputValidation-errorForeground, #be1100);
      }

      .collapsible-header {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        user-select: none;
      }

      .collapsible-header:hover {
        opacity: 0.85;
      }

      .collapsible-arrow {
        font-size: 10px;
        transition: transform 0.15s ease;
      }

      .collapsible-arrow.open {
        transform: rotate(90deg);
      }

      .collapsible-body {
        display: none;
      }

      .collapsible-body.open {
        display: block;
      }

      .data-actions,
      .danger-actions,
      .panel-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .danger-copy {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }

      .provider-workspace {
        border: 1px solid var(--border);
        border-radius: 12px;
        overflow: hidden;
        min-height: 620px;
        display: grid;
        grid-template-columns: 300px minmax(0, 1fr);
        background: color-mix(in srgb, var(--bg) 96%, white 4%);
      }

      .provider-nav {
        border-right: 1px solid var(--border);
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-height: 0;
      }

      .toolbar {
        display: flex;
        gap: 8px;
      }

      .provider-search {
        width: 100%;
        border: 1px solid var(--input-border);
        border-radius: 8px;
        padding: 8px 10px;
        background: var(--input-bg);
        color: var(--input-fg);
      }

      .provider-list {
        min-height: 0;
        overflow-y: auto;
        display: grid;
        gap: 6px;
      }

      .provider-item {
        border: 1px solid var(--border);
        border-radius: 10px;
        background: transparent;
        color: inherit;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        padding: 8px 10px;
      }

      .provider-item:hover {
        background: var(--panel-bg-strong);
      }

      .provider-item.active {
        background: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
      }

      .provider-item-main {
        border: 0;
        background: transparent;
        color: inherit;
        text-align: left;
        padding: 0;
        cursor: pointer;
        min-width: 0;
      }

      .provider-item-name {
        font-size: 12px;
        font-weight: 700;
      }

      .provider-item-meta {
        margin-top: 4px;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 11px;
      }

      .provider-item-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--muted);
      }

      .provider-item-toggle input {
        width: 14px;
        height: 14px;
        margin: 0;
      }

      .pill {
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 1px 8px;
      }

      .pill.off {
        color: var(--muted);
      }

      .editor {
        min-width: 0;
        padding: 16px;
        display: grid;
        gap: 14px;
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }

      .models-grid {
        display: grid;
        gap: 8px;
        max-height: 300px;
        overflow-y: auto;
      }

      .model-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 8px 10px;
      }

      .model-row input {
        width: 14px;
        height: 14px;
        margin-top: 2px;
      }

      .model-meta {
        min-width: 0;
      }

      .model-name {
        font-size: 12px;
        font-weight: 600;
      }

      .model-desc {
        margin-top: 2px;
        color: var(--muted);
        font-size: 11px;
      }

      .model-caps {
        margin-top: 4px;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
      }

      .cap-pill {
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 0 6px;
        font-size: 10px;
        line-height: 16px;
        color: var(--muted);
        opacity: 0.42;
        cursor: pointer;
        user-select: none;
      }

      .cap-pill:hover {
        opacity: 0.75;
      }

      .cap-pill.active {
        opacity: 1;
      }

      .cap-pill.active.cap-vision { border-color: #3b82f6; color: #3b82f6; }
      .cap-pill.active.cap-reasoning { border-color: #a855f7; color: #a855f7; }
      .cap-pill.active.cap-audio { border-color: #f59e0b; color: #f59e0b; }
      .cap-pill.active.cap-video { border-color: #10b981; color: #10b981; }
      .cap-pill.active.cap-tools { border-color: #6b7280; color: #6b7280; }

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

${SHARED_TOAST_STYLE}

      @media (max-width: 1120px) {
        .frame {
          grid-template-columns: 1fr;
        }

        .settings-nav {
          border-right: 0;
          border-bottom: 1px solid var(--border);
        }

        .provider-workspace {
          grid-template-columns: 1fr;
        }

        .provider-nav {
          border-right: 0;
          border-bottom: 1px solid var(--border);
          max-height: 280px;
        }
      }

      @media (max-width: 760px) {
        body {
          padding: 14px;
        }

        .field-grid {
          grid-template-columns: 1fr;
        }

        .settings-content {
          padding: 12px;
        }
      }
      .mcp-server-card {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px;
        margin-bottom: 8px;
        background: transparent;
      }

      .mcp-server-card-row {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .mcp-server-name-display {
        font-size: 13px;
        font-weight: 700;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      .mcp-server-actions {
        display: flex;
        gap: 6px;
        align-items: center;
        flex-shrink: 0;
      }

      .mcp-server-actions .btn-secondary {
        padding: 3px 8px;
        font-size: 11px;
        border-radius: 6px;
      }

      .mcp-server-actions .btn-danger {
        padding: 3px 8px;
        font-size: 11px;
        border-radius: 6px;
      }

      .mcp-status-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--muted);
        vertical-align: middle;
        margin-right: 4px;
      }

      .mcp-status-dot.mcp-status-ok {
        background: #22c55e;
      }

      .mcp-status-dot.mcp-status-fail {
        background: var(--vscode-inputValidation-errorBorder, #be1100);
      }

      .mcp-tool-count {
        font-size: 11px;
        color: var(--muted);
        cursor: pointer;
        white-space: nowrap;
        padding: 0 2px;
      }

      .mcp-tool-count:hover {
        text-decoration: underline;
      }

      .mcp-tools-section {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid var(--border);
      }

      .mcp-tools-header {
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--fg);
        background: transparent;
        border: 0;
        padding: 0;
        width: 100%;
      }

      .mcp-tools-header:hover {
        text-decoration: underline;
      }

      .mcp-tools-list {
        margin-top: 6px;
        font-size: 11px;
        color: var(--muted);
        line-height: 1.6;
      }

      .mcp-tools-list .tool-entry {
        padding: 2px 0;
      }

      .mcp-tools-list .tool-name {
        font-weight: 600;
        color: var(--fg);
      }

      .mcp-modal-field-grid {
        display: grid;
        gap: 10px;
      }

      .mcp-kv-row {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      .mcp-kv-row input {
        flex: 1;
        min-width: 0;
      }

      .mcp-kv-remove {
        border: 1px solid var(--input-border);
        border-radius: 6px;
        padding: 3px 8px;
        background: transparent;
        color: var(--fg);
        cursor: pointer;
        font-size: 11px;
        white-space: nowrap;
      }

      .mcp-kv-remove:hover {
        background: var(--panel-bg-strong);
      }

      .mcp-add-row-btn {
        border: 1px dashed var(--input-border);
        border-radius: 6px;
        padding: 4px 10px;
        background: transparent;
        color: var(--muted);
        cursor: pointer;
        font-size: 11px;
      }

      .mcp-add-row-btn:hover {
        color: var(--fg);
      }

      .mcp-server-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--muted);
      }

      .mcp-server-toggle input {
        width: 14px;
        height: 14px;
        margin: 0;
      }
`;
}
