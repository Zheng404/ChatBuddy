/**
 * 聊天面板工具与推理样式。
 *
 * 包含：reasoning-block、tool-rounds-block、MCP 条目、图片预览。
 */
export function getWebviewChatToolsCss(): string {
  return `
      .reasoning-block {
        margin: 0 0 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: color-mix(in srgb, var(--assistant-bg) 86%, var(--bg) 14%);
        overflow: hidden;
      }

      .reasoning-block summary {
        cursor: pointer;
        user-select: none;
        list-style: none;
        padding: 8px 10px;
        font-size: 12px;
        color: var(--muted);
      }

      .reasoning-block summary::-webkit-details-marker {
        display: none;
      }

      .reasoning-content {
        padding: 0 10px 10px;
        line-height: 1.6;
        font-size: 12px;
        color: var(--muted);
      }

      .tool-rounds-block {
        margin: 0 0 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: color-mix(in srgb, var(--assistant-bg) 86%, var(--bg) 14%);
        overflow: hidden;
      }

      .tool-rounds-block summary {
        cursor: pointer;
        user-select: none;
        list-style: none;
        padding: 8px 10px;
        font-size: 12px;
        color: var(--muted);
      }

      .tool-rounds-block summary::-webkit-details-marker {
        display: none;
      }

      .tool-rounds-content {
        padding: 0 10px 10px;
        line-height: 1.5;
        font-size: 12px;
        color: var(--muted);
      }

      .tool-round-item {
        margin-bottom: 8px;
      }

      .tool-round-item:last-child {
        margin-bottom: 0;
      }

      .tool-call-name {
        font-weight: 600;
        color: var(--fg);
      }

      .tool-call-args {
        margin: 4px 0;
        padding: 4px 8px;
        background: var(--code-bg);
        border-radius: var(--radius-sm);
        font-family: "Cascadia Code", "JetBrains Mono", monospace;
        font-size: 11px;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 120px;
        overflow-y: auto;
      }

      .tool-call-output {
        margin-top: 4px;
        padding: 4px 8px;
        background: var(--code-bg);
        border-radius: var(--radius-sm);
        font-family: "Cascadia Code", "JetBrains Mono", monospace;
        font-size: 11px;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 200px;
        overflow-y: auto;
      }

      .tool-round-separator {
        border: none;
        border-top: 1px solid var(--border);
        margin: 8px 0;
      }

      .mcp-entry-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .mcp-entry {
        width: 100%;
        text-align: left;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 10px 12px;
        background: color-mix(in srgb, var(--bg) 92%, var(--fg) 8%);
        color: var(--fg);
        cursor: pointer;
        transition: background var(--duration-normal) ease;
      }

      .mcp-entry:hover {
        background: var(--hover);
      }

      .mcp-entry-title {
        font-size: 13px;
        font-weight: 700;
      }

      .mcp-entry-meta {
        margin-top: 4px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
        word-break: break-word;
      }
  `;
}
