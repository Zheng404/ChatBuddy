import * as vscode from 'vscode';
import { getCodiconStyleText } from './codicon';
import { SHARED_TOAST_STYLE } from './toastTheme';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export function getChatWebviewHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  const codiconStyleText = getCodiconStyleText();
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} https: data:`,
    `media-src ${webview.cspSource} https: data:`,
    'connect-src https:'
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ChatBuddy</title>
    <style>${codiconStyleText}</style>
    <style>
      :root {
        --bg: var(--vscode-editor-background);
        --fg: var(--vscode-editor-foreground);
        --muted: var(--vscode-descriptionForeground);
        --border: var(--vscode-panel-border);
        --hover: var(--vscode-list-hoverBackground);
        --active-bg: var(--vscode-list-activeSelectionBackground);
        --active-fg: var(--vscode-list-activeSelectionForeground);
        --input-bg: var(--vscode-input-background);
        --input-fg: var(--vscode-input-foreground);
        --input-border: var(--vscode-input-border, var(--vscode-panel-border));
        --button-bg: var(--vscode-button-background);
        --button-fg: var(--vscode-button-foreground);
        --button-hover: var(--vscode-button-hoverBackground);
        --toolbar-hover: var(--vscode-toolbar-hoverBackground);
        --user-bg: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 88%, var(--bg) 12%);
        --assistant-bg: color-mix(in srgb, var(--bg) 94%, var(--fg) 6%);
        --code-bg: color-mix(in srgb, var(--bg) 85%, var(--fg) 15%);
      }

      * {
        box-sizing: border-box;
      }

      html, body {
        height: 100%;
      }

      body {
        margin: 0;
        color: var(--fg);
        background: var(--bg);
        font-family: var(--vscode-font-family);
        overflow: hidden;
      }

      button, textarea, input {
        font: inherit;
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

      svg {
        width: 16px;
        height: 16px;
      }

    </style>
  </head>
  <body>
    <div class="layout">
      <section class="content" id="content">
        <section class="stage">
          <div class="messages" id="messages">
            <div class="messages-inner" id="messagesInner"></div>
          </div>
        </section>
      </section>

      <footer class="composer-shell">
        <div class="composer">
          <div class="composer-box">
            <div class="composer-resizer" id="composerResizer"></div>
            <textarea class="composer-textarea" id="composerInput"></textarea>
            <div class="composer-actions">
              <div class="composer-inline-controls">
                <button class="action-btn-icon" id="clearBtn" type="button"><span class="codicon codicon-clear-all"></span></button>
                <select id="tempModelSelect" class="model-select"></select>
                <span class="chip temp-chip" id="tempModelChip"></span>
              </div>
              <div class="send-group">
                <label class="toggle">
                  <input type="checkbox" id="streamingToggle" />
                  <span id="streamingLabel"></span>
                </label>
                <button class="action-btn secondary" id="stopBtn" type="button"></button>
                <button class="action-btn primary" id="sendBtn" type="button"></button>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
    <div class="toast-stack" id="toastStack" aria-live="polite" aria-atomic="false"></div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();

      const icons = {
        send: '<span class="codicon codicon-send"></span>',
        stop: '<span class="codicon codicon-debug-stop"></span>',
        regenerateReply: '<span class="codicon codicon-refresh"></span>',
        regenerateFrom: '<span class="codicon codicon-debug-restart"></span>',
        edit: '<span class="codicon codicon-edit"></span>',
        copy: '<span class="codicon codicon-copy"></span>',
        delete: '<span class="codicon codicon-trash"></span>'
      };

      const dom = {
        content: document.getElementById('content'),
        messages: document.getElementById('messages'),
        messagesInner: document.getElementById('messagesInner'),
        composerResizer: document.getElementById('composerResizer'),
        composerInput: document.getElementById('composerInput'),
        sendBtn: document.getElementById('sendBtn'),
        stopBtn: document.getElementById('stopBtn'),
        clearBtn: document.getElementById('clearBtn'),
        tempModelSelect: document.getElementById('tempModelSelect'),
        tempModelChip: document.getElementById('tempModelChip'),
        streamingToggle: document.getElementById('streamingToggle'),
        streamingLabel: document.getElementById('streamingLabel'),
        toastStack: document.getElementById('toastStack')
      };

      let state = {
        locale: 'en',
        strings: {},
        assistants: [],
        assistantMeta: {},
        selectedAssistant: undefined,
        selectedAssistantId: undefined,
        sessions: [],
        selectedSessionId: undefined,
        selectedSession: undefined,
        sessionPanelCollapsed: false,
        providerLabel: '-',
        modelLabel: '-',
        modelOptions: [],
        sessionTempModelRef: '',
        sendShortcut: 'enter',
        streaming: true,
        isGenerating: false,
        canChat: false,
        readOnlyReason: ''
      };
      const renderSigs = {
        messages: '',
        composer: ''
      };
      let lastStateError = '';
      const COMPOSER_MIN_HEIGHT = 100;
      const COMPOSER_MAX_HEIGHT = 340;
      let isResizingComposer = false;
      let composerResizeStartY = 0;
      let composerResizeStartHeight = 0;

      function clampComposerHeight(value) {
        return Math.max(COMPOSER_MIN_HEIGHT, Math.min(COMPOSER_MAX_HEIGHT, Math.round(value)));
      }

      function showToast(message, tone = 'error') {
        const text = String(message || '').trim();
        if (!text) {
          return;
        }
        const toast = document.createElement('div');
        toast.className = 'toast ' + (tone === 'success' || tone === 'error' ? tone : 'info');
        toast.textContent = text;
        dom.toastStack.appendChild(toast);
        while (dom.toastStack.children.length > 4) {
          dom.toastStack.removeChild(dom.toastStack.firstElementChild);
        }
        window.setTimeout(() => {
          toast.remove();
        }, 3200);
      }

      function escapeHtml(input) {
        return String(input)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function escapeHtmlAttr(input) {
        return String(input)
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/'/g, '&#039;');
      }

      function decodeHtmlEntities(input) {
        return String(input || '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#0*39;/g, "'");
      }

      function normalizeCodicon(icon) {
        const raw = String(icon || '').trim().toLowerCase();
        if (!raw || !/^[a-z0-9-]+$/.test(raw)) {
          return 'account';
        }
        return raw;
      }

      function codiconMarkup(icon) {
        const normalized = normalizeCodicon(icon);
        return '<span class="codicon codicon-' + escapeHtml(normalized) + '"></span>';
      }

      function formatDate(ts) {
        try {
          const locale = state.locale === 'zh-CN' ? 'zh-CN' : 'en-US';
          return new Intl.DateTimeFormat(locale, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }).format(new Date(ts));
        } catch {
          return '';
        }
      }

      function markdownToHtml(input) {
        const source = String(input || '');
        const codeBlocks = [];
        const codeBlockPattern = new RegExp('[\\\\x60]{3}([a-zA-Z0-9_-]*)\\\\n([\\\\s\\\\S]*?)[\\\\x60]{3}', 'g');
        let escaped = escapeHtml(source).replace(codeBlockPattern, (_, lang, code) => {
          const cls = lang ? ' class="lang-' + lang + '"' : '';
          const marker = '@@CODE_BLOCK_' + codeBlocks.length + '@@';
          codeBlocks.push('<pre><code' + cls + '>' + code + '</code></pre>');
          return marker;
        });

        const toSafeHref = (raw, allowDataImage, allowDataVideo) => {
          const value = decodeHtmlEntities(raw).trim();
          if (!value) {
            return '';
          }
          if (allowDataImage && /^data:image\\/[a-z0-9.+-]+;base64,[a-z0-9+/=\\s]+$/i.test(value)) {
            return value.replace(/\\s+/g, '');
          }
          if (allowDataVideo && /^data:video\\/[a-z0-9.+-]+;base64,[a-z0-9+/=\\s]+$/i.test(value)) {
            return value.replace(/\\s+/g, '');
          }
          let parsed;
          try {
            parsed = new URL(value);
          } catch {
            return '';
          }
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return '';
          }
          return parsed.toString();
        };

        escaped = escaped.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, (full, alt, rawUrl) => {
          const mediaType = String(alt || '').trim().toLowerCase();
          const altText = decodeHtmlEntities(alt).trim();
          if (mediaType === 'video') {
            const safeUrl = toSafeHref(rawUrl, false, true);
            if (!safeUrl) {
              return full;
            }
            return '<video controls preload="metadata" src="' + escapeHtmlAttr(safeUrl) + '"></video>';
          }
          const safeUrl = toSafeHref(rawUrl, true, false);
          if (!safeUrl) {
            return full;
          }
          return (
            '<img src="' +
            escapeHtmlAttr(safeUrl) +
            '" alt="' +
            escapeHtmlAttr(altText) +
            '" loading="lazy" />'
          );
        });

        escaped = escaped.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, (full, label, rawUrl) => {
          const safeUrl = toSafeHref(rawUrl, false, false);
          if (!safeUrl) {
            return full;
          }
          return (
            '<a href="' +
            escapeHtmlAttr(safeUrl) +
            '" target="_blank" rel="noopener noreferrer">' +
            label +
            '</a>'
          );
        });

        // ---- Markdown inline / block extensions ----
        // Headings
        escaped = escaped.replace(/^(#{1,6})\\s+(.+)$/gm, (m, hashes, txt) => {
          const lv = hashes.length;
          return '<h' + lv + '>' + txt + '</h' + lv + '>';
        });
        // Bold
        escaped = escaped.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        // Italic
        escaped = escaped.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
        // Strikethrough
        escaped = escaped.replace(/~~(.+?)~~/g, '<del>$1</del>');

        // Paragraph breaks (double newline) → spacer; single newline → line break
        escaped = escaped.replace(/\\n\\n/g, '@@PARA@@');
        escaped = escaped.replace(/\\n/g, '<br/>');
        escaped = escaped.replace(/@@PARA@@/g, '<br/>');

        // Restore code block placeholders
        escaped = escaped.replace(/@@CODE_BLOCK_(\\d+)@@/g, (_, index) => {
          const value = codeBlocks[Number(index)];
          return typeof value === 'string' ? value : '';
        });

        // Remove <br/> directly before/after block-level elements to prevent extra spacing
        escaped = escaped.replace(/<br\\/>\\s*<(h[1-6]|pre|div|ul|ol|li|blockquote|table|hr)/g, '<$1');
        escaped = escaped.replace(/<\\/(h[1-6]|pre|div|ul|ol|li|blockquote|table|hr)>\\s*<br\\/>/g, '</$1>');

        return escaped;
      }

      function getSelectedAssistantAvatar() {
        return normalizeCodicon(state.selectedAssistant?.avatar || 'account');
      }

      function messageDigest(message) {
        if (!message) {
          return '';
        }
        const content = String(message.content || '');
        const reasoning = String(message.reasoning || '');
        return [
          String(message.id || ''),
          String(message.role || ''),
          String(content.length),
          content.slice(-80),
          String(reasoning.length),
          reasoning.slice(-80),
          String(message.timestamp || ''),
          String(message.model || '')
        ].join('~');
      }

      function buildMessagesSignature() {
        const current = state.selectedSession?.messages ?? [];
        const selectedAssistantName = String(state.selectedAssistant?.name || '').trim();
        return [
          String(state.locale || ''),
          String(state.selectedAssistantId || ''),
          selectedAssistantName,
          String(state.selectedSessionId || ''),
          state.canChat ? '1' : '0',
          String(state.readOnlyReason || ''),
          String(state.strings.emptyStateTitle || ''),
          String(state.strings.emptyStateBody || ''),
          String(state.strings.noAssistantSelectedTitle || ''),
          String(state.strings.noAssistantSelectedBody || ''),
          String(state.strings.userRole || ''),
          String(state.strings.assistantRole || ''),
          String(state.strings.systemRole || ''),
          String(state.strings.regenerateReplyAction || ''),
          String(state.strings.regenerateFromMessageAction || ''),
          String(state.strings.copyMessageAction || ''),
          String(state.strings.deleteMessageAction || ''),
          String(state.strings.reasoningSectionTitle || ''),
          String(current.length),
          messageDigest(current[current.length - 1])
        ].join('|');
      }

      function buildComposerSignature() {
        const modelOptionsDigest = (state.modelOptions || [])
          .map((option) => option.ref + '~' + option.label)
          .join('^');
        return [
          state.canChat ? '1' : '0',
          state.isGenerating ? '1' : '0',
          state.streaming ? '1' : '0',
          String(state.readOnlyReason || ''),
          String(state.providerLabel || ''),
          String(state.modelLabel || ''),
          String(state.sessionTempModelRef || ''),
          String(state.sendShortcut || ''),
          modelOptionsDigest,
          String(state.strings.composerPlaceholder || ''),
          String(state.strings.send || ''),
          String(state.strings.stop || ''),
          String(state.strings.streaming || ''),
          String(state.strings.sendShortcutEnter || ''),
          String(state.strings.sendShortcutCtrlEnter || ''),
          String(state.strings.provider || ''),
          String(state.strings.model || ''),
          String(state.strings.chatModelFollowAssistant || ''),
          String(state.strings.chatTemporaryModelLabel || ''),
          String(state.strings.noAssistantSelectedBody || '')
        ].join('|');
      }

      function getCurrentSendShortcutText() {
        return state.sendShortcut === 'ctrlEnter'
          ? String(state.strings.sendShortcutCtrlEnter || '')
          : String(state.strings.sendShortcutEnter || '');
      }

      function renderEmptyState() {
        const title = state.selectedAssistantId
          ? state.strings.emptyStateTitle
          : (state.strings.noAssistantSelectedTitle || state.strings.emptyStateTitle);
        const body = state.selectedAssistantId
          ? state.strings.emptyStateBody
          : (state.strings.noAssistantSelectedBody || state.strings.emptyStateBody);
        dom.messagesInner.innerHTML = '' +
          '<div class="empty-state">' +
            '<div class="empty-card">' +
              '<div class="assistant-badge">' + codiconMarkup(getSelectedAssistantAvatar()) + '</div>' +
              '<div class="empty-title">' + escapeHtml(title) + '</div>' +
              '<div class="empty-copy">' + escapeHtml(body) + '</div>' +
            '</div>' +
          '</div>';
      }

      function renderMessages() {
        const current = state.selectedSession?.messages ?? [];
        if (!current.length) {
          renderEmptyState();
          return;
        }

        const latestAssistantId = [...current].reverse().find((item) => item.role === 'assistant')?.id || '';
        const assistantDisplayName = String(state.selectedAssistant?.name || '').trim() || state.strings.assistantRole;
        const isGenerating = state.isGenerating;
        const lastMsg = current[current.length - 1];

        dom.messagesInner.innerHTML = current.map((message) => {
          // Only show cursor on the last message when it's an assistant message and still generating
          const showCursor = isGenerating && lastMsg && lastMsg.role === 'assistant' && message.id === lastMsg.id;
          const role =
            message.role === 'user'
              ? state.strings.userRole
              : message.role === 'assistant'
                ? assistantDisplayName
                : state.strings.systemRole;
          const rowClass = message.role === 'user' ? 'message-row user' : 'message-row';
          const avatarNode =
            message.role === 'assistant'
              ? '<div class="message-avatar">' + codiconMarkup(getSelectedAssistantAvatar()) + '</div>'
              : message.role === 'system'
                ? '<div class="message-avatar">' + codiconMarkup('settings-gear') + '</div>'
                : '';
          const modelText = String(message.model || '').trim();
          const shouldShowModel = !!modelText && !/^[^:\\s]+:[^:\\s]+$/.test(modelText);
          const metaExtra = shouldShowModel ? ' · ' + escapeHtml(modelText) : '';
          const reasoningText = String(message.reasoning || '').trim();
          const reasoningBlock = message.role === 'assistant' && reasoningText
            ? '<details class="reasoning-block">' +
                '<summary>' + escapeHtml(state.strings.reasoningSectionTitle || '') + '</summary>' +
                '<div class="reasoning-content">' + markdownToHtml(reasoningText) + '</div>' +
              '</details>'
            : '';
          const messageActions = state.canChat ? '' +
            '<div class="message-meta-actions">' +
              (message.id === latestAssistantId && message.role === 'assistant'
                ? '<button class="message-action-btn" type="button" data-msg-action="regenerate-reply" data-id="' + escapeHtml(message.id) + '" title="' + escapeHtml(state.strings.regenerateReplyAction || '') + '">' + icons.regenerateReply + '</button>'
                : '') +
              (message.role === 'user'
                ? '<button class="message-action-btn" type="button" data-msg-action="edit-message" data-id="' + escapeHtml(message.id) + '" title="' + escapeHtml(state.strings.editMessageAction || '') + '">' + icons.edit + '</button>'
                : '') +
              (message.role !== 'system'
                ? '<button class="message-action-btn" type="button" data-msg-action="regenerate-from" data-id="' + escapeHtml(message.id) + '" title="' + escapeHtml(state.strings.regenerateFromMessageAction || '') + '">' + icons.regenerateFrom + '</button>'
                : '') +
              '<button class="message-action-btn" type="button" data-msg-action="copy-message" data-id="' + escapeHtml(message.id) + '" title="' + escapeHtml(state.strings.copyMessageAction || '') + '">' + icons.copy + '</button>' +
              '<button class="message-action-btn" type="button" data-msg-action="delete-message" data-id="' + escapeHtml(message.id) + '" title="' + escapeHtml(state.strings.deleteMessageAction || '') + '">' + icons.delete + '</button>' +
            '</div>'
            : '';
          return '' +
            '<div class="' + rowClass + '">' +
              avatarNode +
              '<div class="message-card">' +
                '<div class="message-meta">' +
                  '<div class="message-meta-main">' +
                    '<span class="message-role">' + escapeHtml(role) + '</span>' +
                    '<span>' + escapeHtml(formatDate(message.timestamp)) + metaExtra + '</span>' +
                  '</div>' +
                  messageActions +
                '</div>' +
                reasoningBlock +
                '<div class="message-text">' + markdownToHtml(message.content || '') + ((showCursor && message.id === lastMsg.id) ? '<span class="streaming-cursor"></span>' : '') + '</div>' +
              '</div>' +
            '</div>';
        }).join('') + (isGenerating && lastMsg && lastMsg.role === 'assistant' && !lastMsg.content ? '<div class="loading-indicator-wrapper"><div class="loading-dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>' : '');


        dom.messages.scrollTop = dom.messages.scrollHeight;
      }

      function renderComposer() {
        const assistantModelRef = String(state.selectedAssistant?.modelRef || '').trim();
        const assistantModelLabel = state.modelLabel || '-';
        const activeModelRef = String(state.sessionTempModelRef || assistantModelRef || '').trim();
        const modelMap = new Map();
        (state.modelOptions || []).forEach((option) => {
          if (!option || !option.ref || modelMap.has(option.ref)) {
            return;
          }
          modelMap.set(option.ref, option.label || option.ref);
        });
        if (activeModelRef && !modelMap.has(activeModelRef)) {
          modelMap.set(activeModelRef, assistantModelLabel);
        }
        dom.tempModelSelect.innerHTML = Array.from(modelMap.entries()).map(([ref, label]) => {
          return '<option value="' + escapeHtml(ref) + '">' + escapeHtml(label) + '</option>';
        }).join('');
        dom.tempModelSelect.value = activeModelRef;

        dom.composerInput.placeholder = state.canChat
          ? state.strings.composerPlaceholder
          : (state.readOnlyReason || state.strings.noAssistantSelectedBody || state.strings.composerPlaceholder);
        dom.sendBtn.innerHTML = icons.send + '<span>' + state.strings.send + '</span>';
        dom.stopBtn.innerHTML = icons.stop + '<span>' + state.strings.stop + '</span>';
        const sendShortcutText = getCurrentSendShortcutText();
        dom.sendBtn.title = [state.strings.send || '', sendShortcutText].filter(Boolean).join(' · ');
        dom.stopBtn.title = state.strings.stop || '';
        dom.streamingLabel.textContent = state.strings.streaming;
        const isTemporaryModel = !!state.sessionTempModelRef;
        dom.tempModelChip.textContent = state.strings.chatTemporaryModelLabel || '';
        dom.tempModelChip.classList.toggle('visible', isTemporaryModel && state.canChat);
        const activeLabel = modelMap.get(activeModelRef) || assistantModelLabel;
        dom.tempModelSelect.title = state.strings.model + ': ' + activeLabel;
        dom.streamingToggle.checked = !!state.streaming;
        dom.composerInput.disabled = !state.canChat;
        dom.tempModelSelect.disabled = !state.canChat || state.isGenerating;
        dom.streamingToggle.disabled = !state.canChat || state.isGenerating;
        dom.sendBtn.disabled = state.isGenerating || !state.canChat;
        dom.stopBtn.disabled = !state.isGenerating;
        dom.clearBtn.title = state.strings.clearSessionAction || '';
        dom.clearBtn.disabled = !state.canChat || state.isGenerating || !state.selectedSession?.messages?.length;
      }

      function renderByDiff(force) {
        const messagesSig = buildMessagesSignature();
        if (force || messagesSig !== renderSigs.messages) {
          renderMessages();
          renderSigs.messages = messagesSig;
        }

        const composerSig = buildComposerSignature();
        if (force || composerSig !== renderSigs.composer) {
          renderComposer();
          renderSigs.composer = composerSig;
        }
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || !message.type) {
          return;
        }
        if (message.type === 'state') {
          const wasGenerating = state.isGenerating;
          state = message.payload;
          renderByDiff(false);
          if (wasGenerating && !state.isGenerating) {
            dom.messagesInner.querySelectorAll('.streaming-cursor, .loading-indicator-wrapper').forEach((el) => el.remove());
          }
          if (state.error) {
            if (state.error !== lastStateError) {
              showToast(state.error, 'error');
            }
            lastStateError = state.error;
          } else {
            lastStateError = '';
          }
        }
        if (message.type === 'error') {
          const text = typeof message.message === 'string' ? message.message : state.strings.unknownError || '';
          showToast(text, 'error');
        }
        if (message.type === 'toast') {
          const text = typeof message.message === 'string' ? message.message : '';
          showToast(text, message.tone || 'info');
        }
      });

      dom.streamingToggle.addEventListener('change', () => {
        if (!state.canChat) {
          return;
        }
        vscode.postMessage({ type: 'setStreaming', enabled: !!dom.streamingToggle.checked });
      });

      dom.tempModelSelect.addEventListener('change', () => {
        if (!state.canChat) {
          return;
        }
        const selectedModelRef = String(dom.tempModelSelect.value || '').trim();
        const assistantModelRef = String(state.selectedAssistant?.modelRef || '').trim();
        const nextTempModelRef = selectedModelRef && selectedModelRef !== assistantModelRef ? selectedModelRef : '';
        vscode.postMessage({ type: 'setSessionTempModel', modelRef: nextTempModelRef });
      });

      dom.stopBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'stopGeneration' });
      });

      dom.sendBtn.addEventListener('click', () => {
        if (!state.canChat) {
          return;
        }
        const content = dom.composerInput.value.trim();
        if (!content) {
          return;
        }
        dom.composerInput.value = '';
        vscode.postMessage({ type: 'sendMessage', content });
      });

      dom.clearBtn.addEventListener('click', () => {
        if (!state.canChat || !state.selectedSession) {
          return;
        }
        const current = state.selectedSession?.messages ?? [];
        if (!current.length) {
          return;
        }
        vscode.postMessage({ type: 'clearSession' });
      });

      dom.composerInput.addEventListener('keydown', (event) => {
        if (!state.canChat) {
          return;
        }
        const isCtrlEnterMode = state.sendShortcut === 'ctrlEnter';
        const shouldSend = isCtrlEnterMode
          ? event.key === 'Enter' && event.ctrlKey && !event.shiftKey && !event.metaKey
          : event.key === 'Enter' && !event.ctrlKey && !event.shiftKey && !event.metaKey;
        if (shouldSend) {
          event.preventDefault();
          dom.sendBtn.click();
        }
      });

      dom.composerResizer.addEventListener('mousedown', (event) => {
        if (event.button !== 0) {
          return;
        }
        isResizingComposer = true;
        composerResizeStartY = event.clientY;
        composerResizeStartHeight = dom.composerInput.offsetHeight;
        document.body.classList.add('resizing');
        event.preventDefault();
      });

      window.addEventListener('mousemove', (event) => {
        if (!isResizingComposer) {
          return;
        }
        const delta = composerResizeStartY - event.clientY;
        const nextHeight = clampComposerHeight(composerResizeStartHeight + delta);
        dom.composerInput.style.height = nextHeight + 'px';
      });

      window.addEventListener('mouseup', () => {
        if (!isResizingComposer) {
          return;
        }
        isResizingComposer = false;
        document.body.classList.remove('resizing');
      });

      dom.messagesInner.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const trigger = target.closest('[data-msg-action]');
        const action = trigger?.getAttribute('data-msg-action');
        const messageId = trigger?.getAttribute('data-id');
        if (!action) {
          return;
        }
        if (action === 'regenerate-reply') {
          vscode.postMessage({ type: 'regenerateReply' });
          return;
        }
        if (!messageId) {
          return;
        }
        if (action === 'regenerate-from') {
          vscode.postMessage({ type: 'regenerateFromMessage', messageId });
          return;
        }
        if (action === 'copy-message') {
          vscode.postMessage({ type: 'copyMessage', messageId });
          return;
        }
        if (action === 'edit-message') {
          const msg = state.selectedSession?.messages?.find((m) => m.id === messageId);
          if (msg && dom.composerInput) {
            dom.composerInput.value = msg.content || '';
            dom.composerInput.focus();
          }
          vscode.postMessage({ type: 'editMessage', messageId, newContent: msg?.content || '' });
          return;
        }
        if (action === 'delete-message') {
          vscode.postMessage({ type: 'deleteMessage', messageId });
          return;
        }
      });

      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
}
