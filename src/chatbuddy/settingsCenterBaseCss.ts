/**
 * 设置中心基础布局与通用组件样式。
 *
 * 从 settingsCenterStyles.ts 中提取的基础布局、导航、通用表单、
 * 数据管理、Toast 和响应式样式。
 */
import { SHARED_TOAST_STYLE } from './toastTheme';
import { SHARED_WEBVIEW_BASE } from './webviewBaseTheme';
import { SHARED_FORM_STYLE } from './webviewFormTheme';

export function getSettingsCenterBaseCss(): string {
  return `
      ${SHARED_WEBVIEW_BASE}

      :root {
        --panel-bg: color-mix(in srgb, var(--bg) 92%, white 8%);
        --panel-bg-strong: color-mix(in srgb, var(--bg) 86%, white 14%);
        --accent: var(--vscode-focusBorder, var(--vscode-button-background));

        --radius-sm: 6px;
        --radius-md: 8px;
        --radius-lg: 10px;
        --radius-xl: 12px;
        --radius-pill: 999px;

        --color-success: #10b981;
        --color-info: #3b82f6;
        --color-warning: #f59e0b;
        --color-error: #be1100;
        --color-muted: #6b7280;
        --color-purple: #a855f7;
      }

      body {
        padding: 18px;
      }

      .shell {
        max-width: 1380px;
        margin: 0 auto;
      }

      .frame {
        border: 1px solid var(--border);
        border-radius: 14px;
        display: grid;
        grid-template-columns: 1fr;
        grid-template-rows: auto 1fr;
        min-height: 720px;
        background: var(--panel-bg);
      }

      .settings-bar {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--border);
        background: color-mix(in srgb, var(--bg) 96%, white 4%);
        border-radius: 14px 14px 0 0;
        min-width: 0;
      }

      .settings-bar-title {
        margin: 0;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        margin-right: 8px;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .settings-tabs {
        display: flex;
        align-items: center;
        gap: 2px;
        overflow-x: auto;
        flex: 1;
        min-width: 0;
        scrollbar-width: none;
        scroll-behavior: smooth;
      }

      .settings-tabs::-webkit-scrollbar {
        display: none;
      }

      .tab-arrow {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border: none;
        border-radius: 50%;
        background: var(--panel-bg-strong);
        color: var(--fg);
        cursor: pointer;
        padding: 0;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s;
      }

      .tab-arrow.visible {
        opacity: 0.7;
        pointer-events: auto;
      }

      .tab-arrow.visible:hover {
        opacity: 1;
      }

      .nav-item {
        flex-shrink: 0;
        border: 1px solid transparent;
        border-bottom: 2px solid transparent;
        border-radius: var(--radius-md) var(--radius-md) 0 0;
        background: transparent;
        color: inherit;
        text-align: left;
        padding: 6px 12px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        font-size: 13px;
      }

      .nav-item:hover {
        background: var(--panel-bg-strong);
      }

      .nav-item.active {
        color: var(--fg);
        border-bottom-color: var(--accent);
        background: var(--panel-bg-strong);
      }

      .nav-item-icon {
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.8;
        font-size: 14px;
      }

      .nav-item.active .nav-item-icon {
        opacity: 1;
      }

      .nav-item-title {
        font-size: 13px;
        font-weight: 600;
      }

      .settings-content {
        min-width: 0;
        padding: 16px;
        overflow: auto;
      }

      .settings-pane {
        display: none;
      }

      .settings-pane.active {
        display: block;
      }

      ${SHARED_FORM_STYLE}

      .section-grid {
        display: grid;
        gap: 16px;
      }

      .section-card,
      .panel {
        border: 1px solid var(--border);
        border-radius: var(--radius-xl);
        padding: 16px;
        background: color-mix(in srgb, var(--bg) 96%, white 4%);
      }

      .section-title,
      .panel-title {
        margin: 0 0 12px;
        font-size: 13px;
        font-weight: 700;
      }

      .notice-list {
        margin: 10px 0 0;
        padding-left: 18px;
        display: grid;
        gap: 8px;
      }

      .notice-list li {
        color: var(--fg);
        line-height: 1.5;
      }

      .changelog-content {
        margin: 10px 0 0;
        max-height: 420px;
        overflow: auto;
        border: 1px solid var(--input-border);
        border-radius: var(--radius-md);
        background: var(--input-bg);
        color: var(--input-fg);
        padding: 12px;
        font-size: 12px;
        line-height: 1.5;
        word-break: break-word;
      }

      .changelog-markdown h1,
      .changelog-markdown h2,
      .changelog-markdown h3,
      .changelog-markdown h4,
      .changelog-markdown h5,
      .changelog-markdown h6 {
        margin: 12px 0 6px;
        line-height: 1.3;
      }

      .changelog-markdown h1:first-child,
      .changelog-markdown h2:first-child,
      .changelog-markdown h3:first-child,
      .changelog-markdown h4:first-child,
      .changelog-markdown h5:first-child,
      .changelog-markdown h6:first-child {
        margin-top: 0;
      }

      .changelog-markdown p {
        margin: 8px 0;
      }

      .changelog-markdown ul,
      .changelog-markdown ol {
        margin: 8px 0 8px 18px;
        padding: 0;
      }

      .changelog-markdown code {
        font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
        background: color-mix(in srgb, var(--panel-bg-strong) 92%, black 8%);
        border-radius: var(--radius-sm);
        padding: 0 4px;
      }

      .changelog-markdown pre {
        margin: 8px 0;
        padding: 10px;
        border: 1px solid var(--input-border);
        border-radius: var(--radius-sm);
        background: color-mix(in srgb, var(--panel-bg-strong) 92%, black 8%);
        overflow: auto;
      }

      .changelog-markdown pre code {
        background: transparent;
        padding: 0;
      }

      .field-input-with-action {
        display: flex;
        gap: 4px;
        align-items: center;
      }

      .field-input-with-action input {
        flex: 1;
        min-width: 0;
      }

      .field-action {
        flex-shrink: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--input-border);
        border-radius: var(--radius-sm);
        background: var(--input-bg);
        color: var(--muted);
        cursor: pointer;
        padding: 0;
      }

      .field-action:hover {
        color: var(--fg);
      }

      input.readonly {
        opacity: 0.6;
        cursor: not-allowed;
        background: var(--input-bg);
      }

      .help {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.55;
      }

      .help.invalid {
        color: var(--vscode-inputValidation-errorForeground, #be1100);
      }

      .input-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .input-row > select,
      .input-row > input {
        flex: 1;
      }

      .header-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
      }

      .header-row > .section-title {
        margin: 0;
        flex: 1;
      }

      .section-card + .section-card {
        margin-top: 12px;
      }

      .data-actions,
      .danger-actions,
      .panel-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 12px;
      }

      .data-tab-container {
        border: 1px solid var(--border);
        border-radius: var(--radius-xl);
        overflow: hidden;
        background: color-mix(in srgb, var(--bg) 96%, white 4%);
      }

      .data-tab-container > .editor-tabs {
        border-bottom: 1px solid var(--border);
        padding: 0 8px;
      }

      .data-tab-container > .editor-pane {
        padding: 16px;
      }

      .selective-export-section {
        margin-top: 16px;
      }

      .selective-export-checks {
        display: flex;
        flex-wrap: wrap;
        gap: 12px 18px;
        margin: 8px 0 12px 0;
      }

      .selective-export-check {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        font-size: 13px;
      }

      .selective-export-check input[type="checkbox"] {
        cursor: pointer;
      }

      .mcp-last-probe {
        font-style: italic;
        margin: 0 0 8px 0;
        opacity: 0.7;
      }

      .backup-password-row {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 8px;
      }

      .backup-password-status {
        font-size: 13px;
        opacity: 0.7;
      }

      .backup-password-status.has-password {
        color: var(--success, #10b981);
        opacity: 1;
        font-weight: 500;
      }

      .field-toggle-row {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }

      .field-toggle-row + .field {
        margin-top: 14px;
      }

      #autoBackupSectionTitle ~ .field + .field {
        margin-top: 14px;
      }

      .backup-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        margin-bottom: 6px;
        gap: 12px;
      }

      .backup-item-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        flex: 1;
      }

      .backup-item-name {
        font-size: 13px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .backup-item-meta {
        font-size: 11px;
        color: var(--muted);
      }

      .backup-item-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }

      .help-inline {
        font-size: 11px;
        color: var(--muted);
        margin-left: 4px;
      }

      .danger-copy {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }

${SHARED_TOAST_STYLE}

      @media (max-width: 760px) {
        body {
          padding: 14px;
        }

        .about-notice-grid {
          grid-template-columns: 1fr;
        }

        .about-hero-panel {
          grid-template-columns: 1fr;
        }

        .about-headline {
          font-size: 24px;
        }

        .about-hero-aside {
          align-content: start;
        }

        .field-grid {
          grid-template-columns: 1fr;
        }

        .settings-content {
          padding: 12px;
        }
      }`;
}
