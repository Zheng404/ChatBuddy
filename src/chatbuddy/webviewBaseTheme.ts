import { SHARED_TOAST_STYLE } from './toastTheme';

/**
 * Shared CSS custom properties and base reset styles used across all webview panels.
 * Each panel imports this and supplements with panel-specific variables and overrides.
 */

/** 响应式断点（px）。CSS @media 无法使用 CSS 变量，故在 TS 层面统一。 */
export const BREAKPOINT_MOBILE = 760;

export const SHARED_WEBVIEW_BASE = `
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --muted: var(--vscode-descriptionForeground);
    --border: var(--vscode-panel-border);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border, var(--vscode-panel-border));
    --button-bg: var(--vscode-button-background);
    --button-fg: var(--vscode-button-foreground);
    --button-hover: var(--vscode-button-hoverBackground);

    --radius-sm: 6px;
    --radius-md: 8px;
    --radius-lg: 10px;
    --radius-xl: 12px;
    --radius-pill: 999px;

    --duration-fast: 120ms;
    --duration-normal: 180ms;
    --duration-slow: 300ms;

    --breakpoint-mobile: 760px;

    --color-success: #10b981;
    --color-info: #3b82f6;
    --color-warning: #f59e0b;
    --color-error: #be1100;
    --color-muted: #6b7280;
    --color-purple: #a855f7;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family);
  }

  button, input, select, textarea {
    font: inherit;
  }

  /* ── 统一滚动条 ──────────────────────────────────── */
  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  ::-webkit-scrollbar-track {
    background: transparent;
  }

  ::-webkit-scrollbar-thumb {
    background-color: var(--vscode-scrollbarSlider-background);
    border-radius: var(--radius-sm);
  }

  ::-webkit-scrollbar-thumb:hover {
    background-color: var(--vscode-scrollbarSlider-hoverBackground);
  }

  ::-webkit-scrollbar-thumb:active {
    background-color: var(--vscode-scrollbarSlider-activeBackground);
  }

  /* ── 统一过渡 ────────────────────────────────────── */
  .transition-bg {
    transition: background var(--duration-normal) ease;
  }

  .transition-border {
    transition: border-color var(--duration-normal) ease;
  }

  .transition-bg-border {
    transition: background var(--duration-normal) ease, border-color var(--duration-normal) ease;
  }

  /* ── 共享空状态卡片 ─────────────────────────────── */
  .empty-state-card {
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    padding: 16px;
    background: color-mix(in srgb, var(--bg) 96%, white 4%);
    color: var(--muted);
    font-size: 12px;
    line-height: 1.55;
    text-align: center;
  }

  /* ── 共享 Pill / Badge ───────────────────────────── */
  .pill {
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    padding: 1px 8px;
  }

  .pill.success {
    border-color: color-mix(in srgb, var(--color-success) 50%, var(--border) 50%);
    color: var(--color-success);
  }

  .pill.info {
    border-color: color-mix(in srgb, var(--color-info) 50%, var(--border) 50%);
    color: var(--color-info);
  }

  .pill.warning {
    border-color: color-mix(in srgb, var(--color-warning) 50%, var(--border) 50%);
    color: var(--color-warning);
  }

  .pill.error {
    border-color: color-mix(in srgb, var(--color-error) 50%, var(--border) 50%);
    color: var(--color-error);
  }

  .pill.purple {
    border-color: color-mix(in srgb, var(--color-purple) 50%, var(--border) 50%);
    color: var(--color-purple);
  }

  .pill.muted {
    border-color: color-mix(in srgb, var(--color-muted) 50%, var(--border) 50%);
    color: var(--color-muted);
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

  .cap-pill.active.cap-vision { border-color: var(--color-info); color: var(--color-info); }
  .cap-pill.active.cap-reasoning { border-color: var(--color-purple); color: var(--color-purple); }
  .cap-pill.active.cap-websearch { border-color: var(--color-info); color: var(--color-info); }
  .cap-pill.active.cap-tools { border-color: var(--color-warning); color: var(--color-warning); }
  .cap-pill.active.cap-json { border-color: var(--color-success); color: var(--color-success); }
  .cap-pill.active.cap-parallel { border-color: #8b5cf6; color: #8b5cf6; }

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
    border-color: color-mix(in srgb, var(--color-purple) 50%, var(--border) 50%);
    color: var(--color-purple);
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
`;

/** Re-export for convenience. */
export { SHARED_TOAST_STYLE };
