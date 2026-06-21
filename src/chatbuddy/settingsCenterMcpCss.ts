/**
 * 设置中心 MCP 服务器管理样式。
 *
 * 从 settingsCenterStyles.ts 中提取的 MCP 服务器卡片、
 * 工具列表、KV 行等专属样式。
 */
export function getSettingsCenterMcpCss(): string {
  return `
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

      .mcp-group-card {
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        margin-bottom: 8px;
        overflow: hidden;
      }

      .mcp-group-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        background: var(--panel-bg-strong);
        cursor: pointer;
      }

      .mcp-group-expand {
        font-size: 10px;
        color: var(--muted);
        width: 16px;
        text-align: center;
        flex-shrink: 0;
      }

      .mcp-group-name {
        font-size: 13px;
        font-weight: 700;
        flex: 1;
      }

      .mcp-group-count {
        font-size: 11px;
        color: var(--muted);
      }

      .mcp-group-servers {
        padding: 8px 12px 8px 36px;
      }

      .mcp-group-servers-empty {
        padding: 12px 12px 12px 36px;
        font-size: 12px;
        color: var(--muted);
        border: 1px solid var(--border);
        border-radius: var(--radius-xl);
        background: color-mix(in srgb, var(--bg) 96%, white 4%);
        text-align: center;
        margin: 4px 0;
      }

      .mcp-server-in-group {
        margin-bottom: 6px;
      }

      .mcp-server-move-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid var(--border);
        font-size: 11px;
      }

      .mcp-server-move-row label {
        color: var(--muted);
        white-space: nowrap;
      }

      .mcp-server-move-row select {
        padding: 2px 6px;
        font-size: 11px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--input-border);
        background: var(--vscode-dropdown-background);
        color: var(--fg);
      }

      .mcp-ungrouped-section {
        margin-top: 12px;
      }

      .mcp-ungrouped-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--muted);
        margin-bottom: 8px;
        padding-left: 4px;
      }

      .header-actions {
        display: flex;
        gap: 8px;
      }`;
}
