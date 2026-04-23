/**
 * 设置中心 Modal 弹窗样式。
 *
 * 从 settingsCenterStyles.ts 中提取的模态框、fetch models 加载等样式。
 */
export function getSettingsCenterModalCss(): string {
  return `
      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: color-mix(in srgb, var(--bg) 48%, black 52%);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        z-index: 999;
      }

      .modal-backdrop.visible {
        display: flex;
      }

      .modal-card {
        width: min(520px, 100%);
        border: 1px solid var(--border);
        border-radius: var(--radius-xl);
        background: var(--bg);
        padding: 16px;
        display: grid;
        gap: 12px;
      }

      .modal-card-wide {
        width: min(780px, 100%);
      }

      .modal-header {
        margin-bottom: 0;
      }

      .modal-header-copy {
        min-width: 0;
      }

      .fetch-models-list {
        display: grid;
        gap: 8px;
        max-height: min(60vh, 520px);
        overflow-y: auto;
      }

      .fetch-models-loading {
        min-height: 220px;
        border: 1px dashed var(--border);
        border-radius: var(--radius-xl);
        display: grid;
        place-items: center;
        gap: 12px;
        padding: 24px;
        color: var(--muted);
        text-align: center;
        background: color-mix(in srgb, var(--bg) 96%, white 4%);
      }

      .fetch-models-spinner {
        width: 26px;
        height: 26px;
        border-radius: var(--radius-pill);
        border: 2px solid color-mix(in srgb, var(--accent) 22%, var(--border) 78%);
        border-top-color: var(--accent);
        animation: settings-modal-spin 0.85s linear infinite;
      }

      .fetch-models-loading-copy {
        max-width: 280px;
        font-size: 12px;
        line-height: 1.6;
      }

      .fetch-model-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        align-items: start;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 10px 12px;
        background: transparent;
      }

      .fetch-model-row.is-added {
        background: color-mix(in srgb, var(--color-success) 10%, var(--bg) 90%);
      }

      .fetch-model-row .btn-secondary {
        padding: 6px 12px;
      }

      .modal-title {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
      }

      .modal-copy {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
      }

      @keyframes settings-modal-spin {
        to {
          transform: rotate(360deg);
        }
      }`;
}
