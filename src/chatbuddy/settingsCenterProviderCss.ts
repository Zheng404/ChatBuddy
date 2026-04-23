/**
 * 设置中心 Provider 工作区与模型管理样式。
 *
 * 从 settingsCenterStyles.ts 中提取的 Provider 配置、模型列表、
 * capability pills 等专属样式。
 */
export function getSettingsCenterProviderCss(): string {
  return `
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
      }`;
}
