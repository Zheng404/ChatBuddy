export const SHARED_TOAST_STYLE = `
      .toast-stack {
        position: fixed;
        top: 18px;
        right: 18px;
        z-index: 1200;
        display: grid;
        gap: 8px;
        pointer-events: none;
      }

      .toast {
        min-width: 240px;
        max-width: min(420px, calc(100vw - 36px));
        padding: 10px 12px;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: color-mix(in srgb, var(--bg) 94%, black 6%);
        color: var(--fg);
        font-size: 12px;
        line-height: 1.45;
        box-shadow: 0 8px 24px color-mix(in srgb, black 30%, transparent);
        opacity: 0;
        transform: translateY(-6px);
        animation: toast-enter 160ms ease forwards;
      }

      .toast.success {
        border-color: var(--vscode-testing-iconPassed, #2ea043);
      }

      .toast.error {
        border-color: var(--vscode-inputValidation-errorBorder, #be1100);
      }

      @keyframes toast-enter {
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
`;
