/**
 * 聊天面板搜索与模态框样式。
 *
 * 包含：search-bar、search-highlight、raw-modal、raw-reasoning-block、confirm。
 */
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
        background: var(--vscode-inputBackground);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 3px 8px;
        font-size: 13px;
        outline: none;
        font-family: var(--font-sans);
      }

      .search-input:focus {
        border-color: var(--vscode-focusBorder);
      }

      .search-count {
        font-size: 11px;
        color: var(--color-text-subtle);
        min-width: 40px;
        text-align: center;
        font-family: var(--font-sans);
      }

      .search-nav-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 3px;
        color: var(--color-text-subtle);
        display: flex;
        align-items: center;
      }

      .search-nav-btn:hover {
        background: var(--color-bg-hover);
        color: var(--fg);
      }

      mark.search-highlight {
        background: #f0c04080;
        color: inherit;
        border-radius: 2px;
        padding: 0 1px;
      }

      mark.search-highlight.active {
        background: #f0a020c0;
        color: #000;
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
