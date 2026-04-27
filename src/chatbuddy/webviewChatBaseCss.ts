/**
 * 聊天面板基础布局与消息结构样式。
 *
 * 包含：CSS 变量、layout、messages、空状态、message-row/card/meta、
 * action 按钮、loading 动画、streaming 光标。
 */
export function getWebviewChatBaseCss(): string {
  return `
      :root {
        --hover: var(--vscode-list-hoverBackground);
        --active-bg: var(--vscode-list-activeSelectionBackground);
        --active-fg: var(--vscode-list-activeSelectionForeground);
        --toolbar-hover: var(--vscode-toolbar-hoverBackground);
        --accent: var(--vscode-focusBorder, var(--vscode-button-background));
        --user-bg: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 88%, var(--bg) 12%);
        --assistant-bg: color-mix(in srgb, var(--bg) 94%, var(--fg) 6%);
        --code-bg: color-mix(in srgb, var(--bg) 85%, var(--fg) 15%);
      }

      html, body {
        height: 100%;
      }

      body {
        overflow: hidden;
      }

      .layout {
        height: 100%;
        min-height: 0;
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        overflow: hidden;
      }

      @supports (height: 100dvh) {
        .layout {
          height: 100dvh;
        }
      }

      .assistant-badge {
        width: 36px;
        height: 36px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--border);
        background: var(--vscode-list-hoverBackground);
      }

      .assistant-badge .codicon {
        font-size: 18px;
      }

      .content {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }

      .stage {
        flex: 1;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .messages {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 18px 22px 16px;
        scroll-padding-bottom: 16px;
        box-sizing: border-box;
      }

      .messages::after {
        content: '';
        display: block;
        height: 2px;
      }

      .messages-inner {
        max-width: 920px;
        margin: 0 auto;
      }

      .empty-state {
        min-height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 28px 0;
      }

      .empty-card {
        width: min(460px, 100%);
        border: 1px solid var(--border);
        border-radius: 16px;
        background: color-mix(in srgb, var(--bg) 93%, var(--fg) 7%);
        padding: 22px;
      }

      .empty-card .assistant-badge {
        width: 40px;
        height: 40px;
      }

      .empty-title {
        margin-top: 14px;
        font-size: 18px;
        font-weight: 700;
      }

      .empty-copy {
        margin-top: 8px;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.6;
      }

      .message-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin-bottom: 14px;
      }

      .message-row.user {
        justify-content: flex-end;
      }

      .message-avatar {
        width: 28px;
        height: 28px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--vscode-list-hoverBackground);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .message-avatar .codicon {
        font-size: 14px;
      }

      .message-card {
        width: min(760px, 90%);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px 14px;
        background: var(--assistant-bg);
      }

      .message-row.user .message-card {
        background: var(--user-bg);
      }

      .message-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
        font-size: 11px;
        color: var(--muted);
      }

      .message-meta-main {
        min-width: 0;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .message-role {
        font-weight: 700;
        color: inherit;
      }

      .message-meta-actions {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        margin-left: auto;
      }

      .message-text {
        line-height: 1.65;
        word-break: break-word;
      }

      .message-text a,
      .reasoning-content a {
        color: var(--vscode-textLink-foreground);
        text-decoration: underline;
      }

      .message-text a:hover,
      .reasoning-content a:hover {
        color: var(--vscode-textLink-activeForeground);
      }

      .message-text img,
      .reasoning-content img {
        display: block;
        max-width: min(100%, 560px);
        height: auto;
        margin: 10px 0 0;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: color-mix(in srgb, var(--bg) 90%, var(--fg) 10%);
      }

      .message-text video,
      .reasoning-content video {
        display: block;
        width: min(100%, 560px);
        max-width: 100%;
        margin: 10px 0 0;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: #000;
      }

      .message-images {
        display: flex;
        flex-direction: row;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 6px;
      }

      .message-image {
        max-width: 260px;
        max-height: 200px;
        border-radius: 8px;
        object-fit: contain;
        cursor: pointer;
      }

      .message-files {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 6px;
      }

      .file-attachment {
        border: 1px solid var(--border);
        border-radius: 8px;
        overflow: hidden;
        background: color-mix(in srgb, var(--bg) 92%, var(--fg) 8%);
      }

      .file-attachment-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        cursor: pointer;
        user-select: none;
        transition: background 0.15s;
      }

      .file-attachment-header:hover {
        background: var(--hover);
      }

      .file-attachment-name {
        flex: 1;
        font-size: 13px;
        font-weight: 500;
        color: var(--fg);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .file-attachment-toggle {
        display: inline-block;
        font-size: 10px;
        color: var(--muted);
        transition: transform 0.2s;
      }

      .file-attachment-header.expanded .file-attachment-toggle {
        transform: rotate(180deg);
      }

      .file-attachment-content {
        border-top: 1px solid var(--border);
        padding: 8px 12px;
        background: var(--bg);
      }

      .file-attachment-content pre {
        margin: 0;
        padding: 8px;
        border-radius: 6px;
        background: var(--code-bg, rgba(128,128,128,0.08));
        overflow-x: auto;
        font-size: 12px;
        line-height: 1.5;
        max-height: 300px;
        overflow-y: auto;
      }

      .file-attachment-content code {
        font-family: var(--vscode-editor-font-family), monospace;
        color: var(--fg);
      }

.message-action-btn {
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--muted);
        width: 22px;
        height: 22px;
        padding: 0;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .message-action-btn:hover {
        color: var(--fg);
        background: var(--toolbar-hover);
      }

      .action-btn-icon {
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--muted);
        width: 22px;
        height: 22px;
        padding: 0;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .action-btn-icon:hover {
        color: var(--fg);
        background: var(--toolbar-hover);
      }

      .action-btn-icon .codicon {
        font-size: 16px;
      }

      .codicon svg {
        width: 16px;
        height: 16px;
      }
  `;
}
