import { SHARED_TOAST_STYLE } from './toastTheme';

/**
 * Shared CSS custom properties and base reset styles used across all webview panels.
 * Each panel imports this and supplements with panel-specific variables and overrides.
 */
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
`;

/** Re-export for convenience. */
export { SHARED_TOAST_STYLE };
