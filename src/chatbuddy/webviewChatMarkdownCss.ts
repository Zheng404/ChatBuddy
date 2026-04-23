/**
 * 聊天面板 Markdown 渲染样式。
 *
 * 包含：代码块、数学公式 (KaTeX)、Mermaid 图表、表格、任务列表、
 * Markdown 标题与行内格式。
 */
export function getWebviewChatMarkdownCss(): string {
  return `
      .code-block-wrapper {
        position: relative;
        margin: 10px 0 0;
      }

      .code-block-wrapper pre {
        background: var(--code-bg);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px;
        overflow-x: auto;
        margin: 0;
      }

      .code-block-lang {
        position: absolute;
        top: 4px;
        left: 10px;
        font-size: 11px;
        color: var(--color-text-subtle);
        opacity: 0.7;
        pointer-events: none;
        text-transform: uppercase;
        font-family: var(--font-sans);
      }

      .code-block-wrapper pre code {
        font-family: "Cascadia Code", "JetBrains Mono", monospace;
        background: transparent !important;
      }

      .code-block-copy {
        position: absolute;
        top: 4px;
        right: 6px;
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        color: var(--color-text-subtle);
        opacity: 0;
        transition: opacity 0.15s, color 0.15s;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .code-block-wrapper:hover .code-block-copy {
        opacity: 1;
      }

      .code-block-copy:hover {
        color: var(--color-text);
        background: var(--color-bg-hover);
      }

      .code-block-copy.copied {
        color: #4caf50;
        opacity: 1;
      }

      .message-text code {
        font-family: "Cascadia Code", "JetBrains Mono", monospace;
      }

      /* Display math wrapper (our outer container, not KaTeX's internal .katex-display) */
      .message-text .math-block {
        margin: 8px 0;
        padding: 4px 0;
        overflow: hidden;
        text-align: center;
      }
      /* Reset KaTeX's default .katex-display margin inside our wrapper */
      .message-text .math-block > .katex-display {
        margin: 0;
      }
      /* Unrendered LaTeX fallback (also used for render failures via data-latex-failed) */
      .message-text [data-latex-display],
      .message-text [data-latex-failed] {
        font-family: "Cascadia Code", "JetBrains Mono", monospace;
        background: var(--code-bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 6px 8px;
        margin: 8px 0;
        overflow-x: auto;
        text-align: center;
        color: var(--fg);
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
      .message-text .mermaid-error {
        color: #e57373;
      }

      .message-text .markdown-table-wrap,
      .reasoning-content .markdown-table-wrap {
        margin: 10px 0 0;
        overflow-x: auto;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: color-mix(in srgb, var(--bg) 94%, var(--fg) 6%);
      }

      .message-text .markdown-table,
      .reasoning-content .markdown-table {
        width: 100%;
        min-width: 420px;
        border-collapse: collapse;
        table-layout: auto;
      }

      .message-text .markdown-table th,
      .message-text .markdown-table td,
      .reasoning-content .markdown-table th,
      .reasoning-content .markdown-table td {
        padding: 8px 10px;
        border-bottom: 1px solid var(--border);
        border-right: 1px solid var(--border);
        text-align: left;
        vertical-align: top;
        white-space: nowrap;
      }

      .message-text .markdown-table th:last-child,
      .message-text .markdown-table td:last-child,
      .reasoning-content .markdown-table th:last-child,
      .reasoning-content .markdown-table td:last-child {
        border-right: none;
      }

      .message-text .markdown-table tbody tr:last-child td,
      .reasoning-content .markdown-table tbody tr:last-child td {
        border-bottom: none;
      }

      .message-text .markdown-table th,
      .reasoning-content .markdown-table th {
        font-weight: 700;
        background: color-mix(in srgb, var(--assistant-bg) 82%, var(--bg) 18%);
      }

      .message-text .markdown-table .is-left,
      .reasoning-content .markdown-table .is-left {
        text-align: left;
      }

      .message-text .markdown-table .is-center,
      .reasoning-content .markdown-table .is-center {
        text-align: center;
      }

      .message-text .markdown-table .is-right,
      .reasoning-content .markdown-table .is-right {
        text-align: right;
      }

      .message-text .task-list,
      .reasoning-content .task-list {
        list-style: none;
        margin: 10px 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .message-text .task-list-item,
      .reasoning-content .task-list-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
      }

      .message-text .task-checkbox,
      .reasoning-content .task-checkbox {
        width: 16px;
        height: 16px;
        margin-top: 3px;
        flex-shrink: 0;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: color-mix(in srgb, var(--bg) 92%, var(--fg) 8%);
        position: relative;
      }

      .message-text .task-checkbox.is-checked,
      .reasoning-content .task-checkbox.is-checked {
        background: color-mix(in srgb, var(--vscode-testing-iconPassed) 78%, var(--bg) 22%);
        border-color: color-mix(in srgb, var(--vscode-testing-iconPassed) 84%, var(--border) 16%);
      }

      .message-text .task-checkbox.is-checked::after,
      .reasoning-content .task-checkbox.is-checked::after {
        content: '';
        position: absolute;
        left: 4px;
        top: 1px;
        width: 5px;
        height: 9px;
        border-right: 2px solid var(--vscode-editor-background);
        border-bottom: 2px solid var(--vscode-editor-background);
        transform: rotate(45deg);
      }

      .message-text .task-list-text,
      .reasoning-content .task-list-text {
        min-width: 0;
        line-height: 1.6;
      }

      .message-text .task-list-item.is-checked .task-list-text,
      .reasoning-content .task-list-item.is-checked .task-list-text {
        color: var(--muted);
        text-decoration: line-through;
      }

      /* Markdown: Headings */
      .message-text h1,.message-text h2,.message-text h3{margin:1em 0 .5em;font-weight:600}
      .message-text h1{font-size:2em}.message-text h2{font-size:1.5em}.message-text h3{font-size:1.25em}
      /* Markdown: Inline formatting */
      .message-text strong{font-weight:600}.message-text em{font-style:italic}.message-text del{text-decoration:line-through}
  `;
}
