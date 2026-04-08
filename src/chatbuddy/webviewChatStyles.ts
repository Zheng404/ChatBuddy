import { SHARED_WEBVIEW_BASE } from './webviewBaseTheme';
import { SHARED_TOAST_STYLE } from './toastTheme';

/**
 * Returns the CSS for the chat webview panel.
 * Includes the shared base theme plus chat-specific styles.
 */
export function getChatPanelCss(): string {
  return `
${SHARED_WEBVIEW_BASE}
      :root {
        --hover: var(--vscode-list-hoverBackground);
        --active-bg: var(--vscode-list-activeSelectionBackground);
        --active-fg: var(--vscode-list-activeSelectionForeground);
        --toolbar-hover: var(--vscode-toolbar-hoverBackground);
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

      .reasoning-block {
        margin: 0 0 10px;
        border: 1px solid var(--border);
        border-radius: 10px;
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
        border-radius: 10px;
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
        border-radius: 6px;
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
        border-radius: 6px;
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

      .message-text pre {
        margin: 10px 0 0;
        background: var(--code-bg);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px;
        overflow-x: auto;
      }

      .message-text pre code {
        font-family: "Cascadia Code", "JetBrains Mono", monospace;
        background: transparent !important;
      }

      .message-text code {
        font-family: "Cascadia Code", "JetBrains Mono", monospace;
      }

      /* LaTeX display math */
      .message-text .katex-display {
        margin: 12px 0;
        overflow-x: auto;
        overflow-y: hidden;
        padding: 8px 0;
        text-align: center;
      }
      /* Unrendered LaTeX fallback */
      .message-text [data-latex-display] {
        font-family: "Cascadia Code", "JetBrains Mono", monospace;
        background: var(--code-bg);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px;
        margin: 10px 0 0;
        overflow-x: auto;
        text-align: center;
      }
      .message-text [data-latex-inline] {
        font-family: "Cascadia Code", "JetBrains Mono", monospace;
      }
      /* Mermaid diagram container */
      .message-text .mermaid-placeholder {
        margin: 10px 0 0;
        background: color-mix(in srgb, var(--bg) 92%, var(--fg) 8%);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px;
        overflow-x: auto;
        text-align: center;
      }
      .message-text .mermaid-placeholder svg,
      .message-text [data-rendered] svg {
        max-width: 100%;
        height: auto;
      }

      /* Markdown: Headings */
      .message-text h1,.message-text h2,.message-text h3{margin:1em 0 .5em;font-weight:600}
      .message-text h1{font-size:2em}.message-text h2{font-size:1.5em}.message-text h3{font-size:1.25em}
      /* Markdown: Inline formatting */
      .message-text strong{font-weight:600}.message-text em{font-style:italic}.message-text del{text-decoration:line-through}

      /* Loading dots */
      .loading-dots{display:flex;gap:4px;align-items:center;padding:10px 0}
      .loading-dots .dot{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:ld-bounce 1.4s infinite ease-in-out both}
      .loading-dots .dot:nth-child(1){animation-delay:-.32s}.loading-dots .dot:nth-child(2){animation-delay:-.16s}
      @keyframes ld-bounce{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}

      /* Loading indicator wrapper */
      .loading-indicator-wrapper{padding:20px;text-align:center}

      /* Streaming cursor */
      .streaming-cursor{display:inline-block;width:2px;height:1.2em;background:var(--fg);margin-left:2px;vertical-align:text-bottom;animation:sc-blink 1s step-end infinite}
      @keyframes sc-blink{0%,100%{opacity:1}50%{opacity:0}}

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

      .mcp-entry-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .mcp-entry {
        width: 100%;
        text-align: left;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px 12px;
        background: color-mix(in srgb, var(--bg) 92%, var(--fg) 8%);
        color: var(--fg);
        cursor: pointer;
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

      .action-btn {
        border: 1px solid transparent;
        border-radius: 10px;
        padding: 8px 12px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .action-btn.primary {
        background: var(--button-bg);
        color: var(--button-fg);
      }

      .action-btn.primary:hover {
        background: var(--button-hover);
      }

      .action-btn.secondary {
        background: transparent;
        color: inherit;
      }

      .action-btn.secondary:hover {
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

${SHARED_TOAST_STYLE}

      .codicon svg {
        width: 16px;
        height: 16px;
      }

      .raw-modal-overlay { position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:1000 }
      .raw-modal-overlay.visible { display:flex }
      .raw-modal { width:min(800px,90%);max-height:80vh;border:1px solid var(--border);border-radius:12px;background:var(--bg);display:flex;flex-direction:column;overflow:hidden }
      .raw-modal-header { display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);background:var(--hover) }
      .raw-modal-title { font-weight:600;font-size:14px }
      .raw-modal-close { border:0;background:transparent;color:var(--fg);width:28px;height:28px;padding:0;cursor:pointer;border-radius:6px;display:flex;align-items:center;justify-content:center }
      .raw-modal-close:hover { background:var(--toolbar-hover) }
      .raw-modal-body { padding:16px;overflow-y:auto;flex:1;min-height:0 }
      .raw-modal-body pre { white-space:pre-wrap;word-break:break-word;font-family:"Cascadia Code","JetBrains Mono",monospace;font-size:13px;line-height:1.6;color:var(--fg);margin:0 }
      .raw-reasoning-block { margin:0 0 12px;border:1px solid var(--border);border-radius:8px;background:var(--code-bg);overflow:hidden }
      .raw-reasoning-block summary { cursor:pointer;user-select:none;list-style:none;padding:6px 10px;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:4px;font-family:"Cascadia Code","JetBrains Mono",monospace }
      .raw-reasoning-block summary::-webkit-details-marker { display:none }
      .raw-reasoning-block summary .chevron-icon { display:inline-flex;transition:transform .15s ease;font-size:14px }
      .raw-reasoning-block[open] summary .chevron-icon { transform:rotate(90deg) }
      .raw-reasoning-block pre { margin:0;padding:8px 10px;border-top:1px solid var(--border);white-space:pre-wrap;word-break:break-word;font-family:"Cascadia Code","JetBrains Mono",monospace;font-size:13px;line-height:1.6;color:var(--muted) }
      .confirm-copy { color: var(--muted); font-size: 13px; line-height: 1.7; white-space: pre-wrap }
      .confirm-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:16px }
`;
}
