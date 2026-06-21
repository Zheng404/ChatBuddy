/**
 * 聊天面板搜索与模态框样式。
 *
 * 包含：search-bar、search-highlight、modal、raw-reasoning-block、confirm。
 */
import { SHARED_MODAL_STYLE } from './webviewModalTheme';

export function getWebviewChatSearchModalCss(): string {
  return `
      .search-bar {
        display: none;
        position: sticky;
        top: 0;
        z-index: 10;
        max-width: 920px;
        margin: 0 auto;
        padding: 6px 10px;
        background: var(--bg);
        border-bottom: 1px solid var(--border);
        align-items: center;
        gap: 4px;
      }

      .search-bar.visible {
        display: flex;
      }

      .search-input {
        flex: 1;
        background: var(--input-bg);
        color: var(--fg);
        border: 1px solid var(--input-border);
        border-radius: var(--radius-md);
        padding: 9px 10px;
        font-size: 13px;
        outline: none;
        font-family: var(--font-sans);
      }

      .search-input:focus {
        border-color: var(--accent);
      }

      .search-count {
        font-size: 11px;
        color: var(--muted);
        min-width: 40px;
        text-align: center;
        font-family: var(--font-sans);
      }

      .search-nav-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 2px 4px;
        border-radius: var(--radius-sm);
        color: var(--muted);
        display: flex;
        align-items: center;
        transition: background var(--duration-normal) ease, color var(--duration-normal) ease;
      }

      .search-nav-btn:hover {
        background: var(--panel-bg-strong);
        color: var(--fg);
      }

      mark.search-highlight {
        background: #f0c04080;
        color: inherit;
        border-radius: var(--radius-sm);
        padding: 0 1px;
      }

      mark.search-highlight.active {
        background: #f0a020c0;
        color: #000;
      }

${SHARED_MODAL_STYLE}

      .raw-reasoning-block { margin:0 0 12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--code-bg);overflow:hidden }
      .raw-reasoning-block summary { cursor:pointer;user-select:none;list-style:none;padding:6px 10px;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:4px;font-family:"Cascadia Code","JetBrains Mono",monospace }
      .raw-reasoning-block summary::-webkit-details-marker { display:none }
      .raw-reasoning-block summary .chevron-icon { display:inline-flex;transition:transform var(--duration-normal) ease;font-size:14px }
      .raw-reasoning-block[open] summary .chevron-icon { transform:rotate(90deg) }
      .raw-reasoning-block pre { margin:0;padding:8px 10px;border-top:1px solid var(--border);white-space:pre-wrap;word-break:break-word;font-family:"Cascadia Code","JetBrains Mono",monospace;font-size:13px;line-height:1.6;color:var(--muted) }
      .confirm-copy { color: var(--muted); font-size: 13px; line-height: 1.7; white-space: pre-wrap }
      .confirm-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:16px }
  `;
}
