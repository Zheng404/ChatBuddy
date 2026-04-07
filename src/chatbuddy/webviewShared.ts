import { SHARED_TOAST_STYLE } from './toastTheme';

/** Toast container HTML element (place inside the webview body). */
export const TOAST_CONTAINER_HTML = `
    <div class="toast-stack" id="toastStack" aria-live="polite" aria-atomic="false"></div>
`;

/** Re-export for convenience so consumers don't need two imports. */
export { SHARED_TOAST_STYLE };

/** Shared toast JS function (call `showToast(message, tone)` from webview scripts). */
export function getToastScript(): string {
  return `
    function showToast(message, tone) {
      tone = tone || 'info';
      var text = String(message || '').trim();
      if (!text) { return; }
      var toast = document.createElement('div');
      toast.className = 'toast ' + (tone === 'success' || tone === 'error' ? tone : 'info');
      toast.textContent = text;
      dom.toastStack.appendChild(toast);
      while (dom.toastStack.children.length > 4) {
        dom.toastStack.removeChild(dom.toastStack.firstElementChild);
      }
      window.setTimeout(function() {
        toast.remove();
      }, 3200);
    }
`;
}
