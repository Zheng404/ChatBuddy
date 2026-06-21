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
    var _toastTimers = [];
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
      var timer = window.setTimeout(function() {
        toast.remove();
        var idx = _toastTimers.indexOf(timer);
        if (idx !== -1) { _toastTimers.splice(idx, 1); }
      }, 3200);
      _toastTimers.push(timer);
    }
  `;
}

/**
 * 共享 Danger Modal JS 函数（自包含，注入即用）。
 *
 * 将 `openDangerModal(options)` 注入到 webview。函数行为：
 * - 创建 `.modal-backdrop` + `.modal-card` DOM（动态创建，关闭时移除）
 * - 显示 message 和「取消 / actionLabel」两个按钮
 * - 点击 actionLabel 或按 Enter 返回 true
 * - 点击取消、backdrop、按 Escape 返回 false
 * - 返回 Promise<boolean>
 *
 * 自包含样式：脚本首次执行时注入一个 `<style>` 块（使用 VS Code CSS 变量），
 * 不依赖各 webview 是否已加载 SHARED_MODAL_STYLE，真正做到「注入即用」。
 *
 * options: { message, title?, actionLabel, cancelLabel?, actionBtnClass? }
 *
 * 注入后访问方式：
 * - 设置中心 / 聊天面板：全局函数 `openDangerModal(...)`
 * - 侧边栏：`window.__sb.openDangerModal(...)`
 */
export function getDangerModalScript(): string {
  return `
    (function () {
      'use strict';
      if (window.__dangerModalInstalled) { return; }
      window.__dangerModalInstalled = true;

      // 动态注入样式（仅一次），使用 VS Code CSS 变量适配三主题
      if (!document.getElementById('__dangerModalStyle')) {
        var styleEl = document.createElement('style');
        styleEl.id = '__dangerModalStyle';
        styleEl.textContent = [
          '.danger-modal-backdrop {',
          '  position: fixed; inset: 0;',
          '  background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 52%, black 48%);',
          '  display: flex; align-items: center; justify-content: center;',
          '  padding: 24px; z-index: 10000;',
          '  font-family: var(--vscode-font-family);',
          '}',
          '.danger-modal-card {',
          '  width: min(440px, 100%);',
          '  background: var(--vscode-editor-background, #1e1e1e);',
          '  color: var(--vscode-editor-foreground, #cccccc);',
          '  border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));',
          '  border-radius: var(--radius-md, 8px);',
          '  padding: 16px 18px;',
          '  display: grid; gap: 12px;',
          '  box-shadow: 0 4px 16px rgba(0,0,0,0.4);',
          '}',
          '.danger-modal-title {',
          '  margin: 0; font-size: 14px; font-weight: 700;',
          '}',
          '.danger-modal-message {',
          '  margin: 0; font-size: 13px; line-height: 1.55;',
          '  color: var(--vscode-editor-foreground, #cccccc);',
          '  white-space: pre-wrap; word-break: break-word;',
          '}',
          '.danger-modal-actions {',
          '  display: flex; justify-content: flex-end; gap: 8px;',
          '}',
          '.danger-modal-btn {',
          '  min-width: 84px; height: 28px; padding: 0 12px;',
          '  border: 1px solid transparent; border-radius: var(--radius-sm, 4px);',
          '  cursor: pointer; font-size: 13px;',
          '  font-family: var(--vscode-font-family);',
          '}',
          '.danger-modal-cancel {',
          '  background: var(--vscode-button-secondaryBackground, #3a3d41);',
          '  color: var(--vscode-button-secondaryForeground, #ffffff);',
          '  border-color: var(--vscode-contrastBorder, transparent);',
          '}',
          '.danger-modal-cancel:hover {',
          '  background: var(--vscode-button-secondaryHoverBackground, #45494e);',
          '}',
          '.danger-modal-confirm {',
          '  background: var(--vscode-errorBackground, #5a1d1d);',
          '  color: var(--vscode-errorForeground, #f48771);',
          '  border-color: var(--vscode-contrastBorder, transparent);',
          '  font-weight: 600;',
          '}',
          '.danger-modal-confirm:hover {',
          '  filter: brightness(1.15);',
          '}'
        ].join('\\n');
        document.head.appendChild(styleEl);
      }

      var activeResolver = null;
      var activeBackdrop = null;

      function cleanup() {
        if (activeBackdrop) { activeBackdrop.remove(); activeBackdrop = null; }
        document.removeEventListener('keydown', onKeydown, true);
        activeResolver = null;
      }

      function onKeydown(e) {
        if (!activeResolver) { return; }
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          resolve(false);
        } else if (e.key === 'Enter') {
          e.preventDefault(); e.stopPropagation();
          resolve(true);
        }
      }

      function resolve(value) {
        if (!activeResolver) { return; }
        var r = activeResolver;
        cleanup();
        r(value);
      }

      /**
       * 打开 Danger Modal。
       * @param {object} options
       *   - message: string (必填，支持 \\n 换行)
       *   - title: string (可选)
       *   - actionLabel: string (必填，确认按钮文案)
       *   - cancelLabel: string (可选，默认 'Cancel')
       * @returns {Promise<boolean>} 用户确认返回 true，取消返回 false
       */
      function openDangerModal(options) {
        options = options || {};
        var message = String(options.message == null ? '' : options.message);
        var actionLabel = String(options.actionLabel == null ? 'OK' : options.actionLabel);
        var cancelLabel = String(options.cancelLabel == null ? '' : options.cancelLabel) || 'Cancel';
        var title = String(options.title == null ? '' : options.title);

        // 若已有 modal 打开，先关闭并视为取消
        if (activeResolver) { resolve(false); }

        var backdrop = document.createElement('div');
        backdrop.className = 'danger-modal-backdrop';

        var card = document.createElement('div');
        card.className = 'danger-modal-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');

        if (title) {
          var titleEl = document.createElement('h3');
          titleEl.className = 'danger-modal-title';
          titleEl.textContent = title;
          card.appendChild(titleEl);
        }

        var msgEl = document.createElement('p');
        msgEl.className = 'danger-modal-message';
        // 用 textContent 写入，天然防 XSS；支持换行通过 white-space:pre-wrap 呈现
        msgEl.textContent = message;
        card.appendChild(msgEl);

        var actions = document.createElement('div');
        actions.className = 'danger-modal-actions';

        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'danger-modal-btn danger-modal-cancel';
        cancelBtn.textContent = cancelLabel;
        cancelBtn.addEventListener('click', function () { resolve(false); });

        var confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'danger-modal-btn danger-modal-confirm';
        confirmBtn.textContent = actionLabel;
        confirmBtn.addEventListener('click', function () { resolve(true); });

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
        card.appendChild(actions);
        backdrop.appendChild(card);

        // 点击 backdrop 空白处 → 取消；点击卡片内不关闭
        backdrop.addEventListener('click', function (ev) {
          if (ev.target === backdrop) { resolve(false); }
        });

        document.body.appendChild(backdrop);
        activeBackdrop = backdrop;
        document.addEventListener('keydown', onKeydown, true);

        // 默认聚焦确认按钮，便于 Enter 直接确认
        try { confirmBtn.focus(); } catch (e) { /* 忽略 focus 异常 */ }

        return new Promise(function (r) { activeResolver = r; });
      }

      // 暴露到全局，供设置中心 / 聊天面板直接调用
      window.openDangerModal = openDangerModal;
      // 兼容侧边栏 __sb 命名空间（侧边栏注入顺序保证本脚本在 shared.ts 之后执行）
      if (window.__sb) {
        window.__sb.openDangerModal = openDangerModal;
      }
    })();
  `;
}
