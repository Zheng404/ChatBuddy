/**
 * 共享表单和 UI 组件样式。
 *
 * 提供跨 WebView 面板（Settings、Assistant Editor、Chat）复用的
 * 按钮、表单控件、字段布局和区域卡片样式。
 */
export const SHARED_FORM_STYLE = `
      .btn-primary {
        border: 1px solid transparent;
        border-radius: var(--radius-md, 8px);
        padding: 8px 14px;
        background: var(--button-bg);
        color: var(--button-fg);
        cursor: pointer;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .btn-primary:hover {
        background: var(--button-hover);
      }

      .btn-stop {
        border: 1px solid transparent;
        border-radius: var(--radius-md, 8px);
        padding: 8px 14px;
        background: #be1100;
        color: #fff;
        cursor: pointer;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .btn-stop:hover {
        background: #991a0a;
      }

      .btn-secondary {
        border: 1px solid var(--input-border);
        border-radius: var(--radius-md, 8px);
        padding: 8px 14px;
        background: transparent;
        color: var(--fg);
        cursor: pointer;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .btn-secondary:hover {
        background: var(--panel-bg-strong, color-mix(in srgb, var(--bg) 88%, white 12%));
      }

      .btn-danger {
        border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
        border-radius: var(--radius-md, 8px);
        padding: 8px 14px;
        background: transparent;
        color: var(--vscode-inputValidation-errorForeground, var(--fg));
        cursor: pointer;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .btn-danger:hover {
        background: var(--panel-bg-strong, color-mix(in srgb, var(--bg) 88%, white 12%));
      }

      .btn-danger.filled {
        background: var(--vscode-inputValidation-errorBackground, rgba(190, 17, 0, 0.1));
      }

      .field-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .field.full {
        grid-column: 1 / -1;
      }

      label {
        font-size: 12px;
        color: var(--muted);
      }

      input,
      select,
      textarea {
        width: 100%;
        border: 1px solid var(--input-border);
        border-radius: var(--radius-md, 8px);
        padding: 9px 10px;
        background: var(--input-bg);
        color: var(--input-fg);
        font: inherit;
      }

      textarea {
        min-height: 72px;
        resize: vertical;
      }
`;
