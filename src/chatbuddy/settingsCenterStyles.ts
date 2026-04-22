import { SHARED_TOAST_STYLE } from './toastTheme';
import { SHARED_WEBVIEW_BASE } from './webviewBaseTheme';

/**
 * Returns the CSS for the settings center webview panel.
 * Contains all styles for the settings UI including navigation,
 * form elements, provider workspace, MCP section, and modals.
 */
export function getSettingsCenterCss(): string {
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

      .btn-primary {
        border: 1px solid transparent;
        border-radius: var(--radius-md);
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
        border-radius: var(--radius-md);
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
        border-radius: var(--radius-md);
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

      .about-grid {
        display: grid;
        gap: 14px;
        margin-top: 0;
      }

      .about-layout {
        display: block;
      }

      .about-hero-panel {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(320px, 396px);
        gap: 20px;
        padding: 18px;
        border: 1px solid var(--border);
        border-radius: var(--radius-xl);
        background: color-mix(in srgb, var(--bg) 97%, white 3%);
      }

      .about-hero-copy {
        min-width: 0;
        display: grid;
        align-content: center;
        gap: 10px;
      }

      .about-headline-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }

      .about-headline {
        margin: 0;
        font-size: 28px;
        line-height: 1.08;
        font-weight: 750;
        color: var(--fg);
      }

      .about-version-pill {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 0 13px;
        border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--border) 66%);
        border-radius: var(--radius-pill);
        background: color-mix(in srgb, var(--accent) 13%, var(--bg) 87%);
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 18%, transparent 82%);
        color: color-mix(in srgb, var(--accent) 78%, var(--fg) 22%);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.03em;
      }

      .about-license-pill {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 0 13px;
        border: 1px solid color-mix(in srgb, var(--accent) 16%, var(--border) 84%);
        border-radius: var(--radius-pill);
        background: color-mix(in srgb, var(--panel-bg-strong) 88%, var(--accent) 12%);
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 16%, transparent 84%);
        color: var(--fg);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.03em;
      }

      .about-hero-text {
        margin: 0;
        max-width: 48ch;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }

      .about-hero-author {
        margin: 2px 0 0;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 12px;
        line-height: 1.5;
      }

      .about-hero-author-label {
        color: var(--muted);
      }

      .about-hero-author-name {
        color: var(--fg);
        font-weight: 600;
      }

      .about-hero-author-link {
        color: inherit;
        text-decoration: none;
        border-bottom: 1px solid transparent;
        transition:
          color 120ms ease,
          border-color 120ms ease;
      }

      .about-hero-author-link:hover {
        color: var(--accent);
        border-bottom-color: color-mix(in srgb, var(--accent) 45%, transparent 55%);
      }

      .about-hero-aside {
        display: grid;
        align-content: center;
      }

      .about-link-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .about-link-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        text-decoration: none;
        min-height: 40px;
        padding: 9px 10px;
        text-align: center;
        white-space: normal;
        line-height: 1.25;
        font-size: 11px;
        font-weight: 700;
        text-wrap: balance;
      }

      .about-link-btn.btn-primary {
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 18%, transparent 82%);
      }

      .about-link-btn.btn-primary:hover {
        text-decoration: none;
      }

      .about-meta-chip,
      .about-notice-header .section-title,
      .about-changelog-block .panel-title {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 0 10px;
        border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border) 82%);
        border-radius: var(--radius-pill);
        background: color-mix(in srgb, var(--accent) 5%, transparent 95%);
        color: var(--muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
      }

      .about-meta-chip-muted {
        border-color: color-mix(in srgb, var(--border) 88%, transparent 12%);
        background: color-mix(in srgb, var(--bg) 92%, white 8%);
      }

      .about-notice-header .section-title,
      .about-changelog-block .panel-title {
        display: block;
        min-height: 0;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        text-transform: uppercase;
      }

      .about-notice-shell {
        margin-top: 14px;
        display: grid;
        gap: 16px;
      }

      .about-notice-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 12px;
      }

      .about-info-card {
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 14px;
        background: color-mix(in srgb, var(--bg) 97%, white 3%);
      }

      .about-notice-header .section-title,
      .about-changelog-block .panel-title {
        margin: 0 0 8px;
      }

      .about-notice-header .help,
      .about-changelog-block .help {
        margin: 0;
      }

      .about-notice-shell .notice-list {
        margin: 0;
        padding-left: 18px;
      }

      .about-info-card .changelog-content {
        margin-top: 0;
      }

      .about-changelog-block {
        display: grid;
        gap: 10px;
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

      label {
        font-size: 12px;
        color: var(--muted);
      }

      input,
      select,
      textarea {
        width: 100%;
        border: 1px solid var(--input-border);
        border-radius: var(--radius-md);
        padding: 9px 10px;
        background: var(--input-bg);
        color: var(--input-fg);
      }

      textarea {
        min-height: 72px;
        resize: vertical;
        font: inherit;
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

      .field-input-with-action {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      .field-input-with-action input {
        flex: 1;
        min-width: 0;
      }

      .field-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--bg);
        color: var(--fg);
        cursor: pointer;
        flex-shrink: 0;
      }

      .field-action:hover {
        background: var(--hover);
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

      .provider-workspace {
        border: 1px solid var(--border);
        border-radius: var(--radius-xl);
        overflow: hidden;
        min-height: 620px;
        display: grid;
        grid-template-columns: 300px minmax(0, 1fr);
        background: color-mix(in srgb, var(--bg) 96%, white 4%);
      }

      .provider-workspace.stacked {
        grid-template-columns: 1fr;
      }

      .provider-workspace.stacked .provider-nav {
        border-right: 0;
        border-bottom: 1px solid var(--border);
        max-height: 280px;
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
        border-radius: var(--radius-md);
        padding: 8px 10px;
        background: var(--input-bg);
        color: var(--input-fg);
      }

      .provider-list {
        min-height: 0;
        overflow-y: auto;
        display: grid;
        gap: 8px;
      }

      .provider-item {
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: transparent;
        color: inherit;
        align-items: center;
        padding: 12px 14px;
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
        display: block;
        width: 100%;
      }

      .provider-item-name {
        font-size: 13px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .provider-item-name .pill {
        font-size: 10px;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: var(--radius-pill);
      }

      .provider-item-name .pill.enabled {
        background: color-mix(in srgb, var(--color-success) 15%, transparent);
        color: var(--color-success);
      }

      .provider-item-name .pill.disabled {
        background: color-mix(in srgb, var(--color-muted) 15%, transparent);
        color: var(--color-muted);
      }

      .provider-item-meta {
        margin-top: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 11px;
      }

      .pill {
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
        padding: 1px 8px;
      }

      .provider-empty {
        display: none;
        min-width: 0;
        padding: 16px;
        justify-content: center;
        align-items: center;
        flex-direction: column;
        gap: 10px;
        color: var(--muted);
        text-align: center;
      }

      .provider-empty.visible {
        display: flex;
      }

      .provider-empty .codicon {
        font-size: 32px;
        opacity: 0.4;
      }

      .provider-empty p {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
      }

      .editor {
        min-width: 0;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 0;
      }

      .editor-tabs {
        display: flex;
        gap: 0;
        border-bottom: 1px solid var(--border);
        margin-bottom: 14px;
      }

      .editor-tab {
        padding: 6px 14px;
        border: none;
        border-bottom: 2px solid transparent;
        background: transparent;
        color: var(--muted);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }

      .editor-tab:hover {
        color: var(--fg);
      }

      .editor-tab.active {
        color: var(--fg);
        border-bottom-color: var(--accent);
      }

      .editor-pane {
        display: none;
      }

      .editor-pane.active {
        display: block;
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }

      .panel-header-left {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .panel-header-left .panel-title {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .provider-enabled-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        font-size: 12px;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .provider-save-status {
        min-height: 24px;
        border: 1px solid transparent;
        border-radius: var(--radius-pill);
        padding: 0 10px;
        display: none;
        align-items: center;
        font-size: 11px;
        line-height: 22px;
        white-space: nowrap;
      }

      .provider-save-status.visible {
        display: inline-flex;
      }

      .provider-save-status.saving {
        border-color: color-mix(in srgb, var(--accent) 34%, var(--border) 66%);
        color: var(--accent);
        background: color-mix(in srgb, var(--accent) 10%, transparent 90%);
      }

      .provider-save-status.saved {
        border-color: color-mix(in srgb, var(--color-success) 42%, var(--border) 58%);
        color: var(--color-success);
        background: color-mix(in srgb, var(--color-success) 10%, transparent 90%);
      }

      .provider-save-status.invalid {
        border-color: color-mix(in srgb, var(--color-warning) 42%, var(--border) 58%);
        color: var(--color-warning);
        background: color-mix(in srgb, var(--color-warning) 10%, transparent 90%);
      }

      .models-grid {
        display: grid;
        gap: 8px;
        max-height: 260px;
        overflow-y: auto;
      }

      .model-sections {
        display: grid;
        gap: 12px;
        margin-top: 12px;
      }

      .model-section-card {
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 12px;
        background: color-mix(in srgb, var(--bg) 97%, white 3%);
      }

      .model-section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }

      .model-section-actions {
        display: flex;
        gap: 6px;
      }

      .model-section-title {
        margin: 0;
        font-size: 12px;
        font-weight: 700;
      }

      .model-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
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
        border-radius: var(--radius-pill);
        padding: 0 6px;
        font-size: 10px;
        line-height: 16px;
        color: var(--fg);
        cursor: pointer;
        user-select: none;
      }

      .cap-pill:hover {
        opacity: 0.75;
      }

      .cap-pill.active {
      }

      .cap-pill.active.cap-vision { border-color: var(--color-info); color: var(--color-info); }
      .cap-pill.active.cap-reasoning { border-color: var(--color-purple); color: var(--color-purple); }
      .cap-pill.active.cap-websearch { border-color: var(--color-info); color: var(--color-info); }
      .cap-pill.active.cap-tools { border-color: #f59e0b; color: #f59e0b; }

      .selected-model-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        align-items: start;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 10px 12px;
        background: transparent;
      }

      .selected-model-main {
        min-width: 0;
      }

      .selected-model-title {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .selected-model-actions {
        display: flex;
        gap: 6px;
        align-items: center;
        flex-wrap: wrap;
      }

      .selected-model-actions .btn-secondary,
      .selected-model-actions .btn-danger {
        padding: 4px 10px;
        font-size: 11px;
      }

      .kind-pill {
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
        padding: 0 6px;
        font-size: 10px;
        line-height: 18px;
        color: var(--muted);
        margin-left: 6px;
      }

      .kind-pill.kind-chat {
        border-color: color-mix(in srgb, var(--color-success) 50%, var(--border) 50%);
        color: var(--color-success);
      }

      .kind-pill.kind-image {
        border-color: color-mix(in srgb, var(--color-info) 50%, var(--border) 50%);
        color: var(--color-info);
      }

      .kind-pill.kind-video {
        border-color: color-mix(in srgb, #a855f7 50%, var(--border) 50%);
        color: #a855f7;
      }

      .kind-pill.kind-audio {
        border-color: color-mix(in srgb, var(--color-warning) 50%, var(--border) 50%);
        color: var(--color-warning);
      }

      .kind-pill.kind-embedding {
        border-color: color-mix(in srgb, #06b6d4 50%, var(--border) 50%);
        color: #06b6d4;
      }

      .kind-pill.kind-rerank {
        border-color: color-mix(in srgb, #ec4899 50%, var(--border) 50%);
        color: #ec4899;
      }

      .model-empty {
        border: 1px dashed var(--border);
        border-radius: var(--radius-lg);
        padding: 14px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.55;
        background: color-mix(in srgb, var(--bg) 98%, white 2%);
      }

      .capability-checks {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
      }

      .capability-checks .cap-check {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--fg);
        cursor: pointer;
        font-size: 12px;
        user-select: none;
      }

      .capability-checks .cap-check input[type="checkbox"] {
        width: 15px;
        height: 15px;
        margin: 0;
        cursor: pointer;
        accent-color: var(--accent);
      }

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
        width: min(780px, 100%);
      }

      .modal-header {
        margin-bottom: 0;
      }

      .modal-header-copy {
        min-width: 0;
      }

      .fetch-models-list {
        display: grid;
        gap: 8px;
        max-height: min(60vh, 520px);
        overflow-y: auto;
      }

      .fetch-models-loading {
        min-height: 220px;
        border: 1px dashed var(--border);
        border-radius: var(--radius-xl);
        display: grid;
        place-items: center;
        gap: 12px;
        padding: 24px;
        color: var(--muted);
        text-align: center;
        background: color-mix(in srgb, var(--bg) 96%, white 4%);
      }

      .fetch-models-spinner {
        width: 26px;
        height: 26px;
        border-radius: var(--radius-pill);
        border: 2px solid color-mix(in srgb, var(--accent) 22%, var(--border) 78%);
        border-top-color: var(--accent);
        animation: settings-modal-spin 0.85s linear infinite;
      }

      .fetch-models-loading-copy {
        max-width: 280px;
        font-size: 12px;
        line-height: 1.6;
      }

      .fetch-model-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        align-items: start;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 10px 12px;
        background: transparent;
      }

      .fetch-model-row.is-added {
        background: color-mix(in srgb, var(--color-success) 10%, var(--bg) 90%);
      }

      .fetch-model-row .btn-secondary {
        padding: 6px 12px;
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

      @keyframes settings-modal-spin {
        to {
          transform: rotate(360deg);
        }
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
      }
      .mcp-server-card {
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
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
        border-radius: var(--radius-sm);
      }

      .mcp-server-actions .btn-danger {
        padding: 3px 8px;
        font-size: 11px;
        border-radius: var(--radius-sm);
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
        background: var(--color-success);
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
        border-radius: var(--radius-sm);
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
        border-radius: var(--radius-sm);
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
