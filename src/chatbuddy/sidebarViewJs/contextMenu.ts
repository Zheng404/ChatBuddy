/**
 * 侧边栏 Webview 右键菜单组件脚本生成器。
 *
 * 导出 getContextMenuScript(): string，返回前端右键菜单组件的 JS 字符串，
 * 最终内联到 webview 的 <script nonce="..."> 中。
 *
 * 依赖 shared.ts 暴露的 window.__sb 命名空间（createElement / post）。
 *
 * 菜单项形状（由各 view 构造后传入）：
 *   { id?, label?, icon?, command?, args?, separator?, enabled? }
 *   - separator:true         表示分隔线（仅渲染分隔条，不渲染可点击项）
 *   - enabled:false          表示禁用（匹配 .context-menu-item-disabled 样式）
 *   - command + args         点击非禁用项时 post({type:'invokeCommand', command, args})
 *                            转发给 Host，由 Host 调用已注册的 VS Code 命令
 *
 * 设计要点：
 * - 使用闭包 capture 每个菜单项 item，避免在 DOM 上以 dataset 存储参数
 *   （虽然参数都是字符串 id，但闭包方式更简洁安全，无需 JSON 序列化）
 * - label 是 i18n 安全字符串，用 textContent 写入
 * - 全局 click / contextmenu / Esc 自动关闭菜单
 *
 * 安全约束（符合 AGENTS.md WebView 规范）：
 * - 禁止 innerHTML / eval，DOM 全部用 createElement，文本用 textContent
 * - 视口适配：菜单溢出右/下边界时自动回缩
 */
export function getContextMenuScript(): string {
  return `// ─── 侧边栏右键菜单组件 ─────────────────────────────────────
(function () {
  'use strict';

  var sb = window.__sb;
  if (!sb) { return; }

  // 当前展示中的菜单元素（同一时刻最多一个）
  var activeMenu = null;

  /**
   * 显示右键菜单。
   * items: Array<{ id?, label?, icon?, command?, args?, separator?, enabled?, confirm? }>
   *   - confirm: { message, actionLabel, cancelLabel? }  点击前先弹 Danger Modal 确认
   * x, y:  屏幕坐标（clientX / clientY）
   */
  function showContextMenu(items, x, y) {
    hideContextMenu();
    var menu = sb.createElement('div', { className: 'context-menu' }, null);

    (items || []).forEach(function (item) {
      // 分隔线项
      if (item.separator) {
        menu.appendChild(sb.createElement('div', { className: 'context-menu-separator' }, null));
        return;
      }

      var disabled = item.enabled === false;
      // 注意：禁用类名匹配 sidebarViewStyles.ts 中的
      // .context-menu-item.context-menu-item-disabled
      var el = sb.createElement('div', {
        className: 'context-menu-item' + (disabled ? ' context-menu-item-disabled' : '')
      }, null);

      // 可选图标（codicon）
      if (item.icon) {
        el.appendChild(sb.createElement('i', { className: 'codicon codicon-' + item.icon }, null));
      }

      // label 用 textContent 写入，天然防 XSS
      var label = sb.createElement('span', { textContent: item.label || '' }, null);
      el.appendChild(label);

      // 闭包 capture 当前 item，非禁用项才绑定点击
      if (!disabled) {
        (function (captured) {
          el.addEventListener('click', function () {
            // 危险操作先弹 Danger Modal 确认（A 类：webview 内触发）
            if (captured.confirm && sb.openDangerModal) {
              hideContextMenu();
              void sb.openDangerModal({
                message: captured.confirm.message || '',
                actionLabel: captured.confirm.actionLabel || (captured.label || 'OK'),
                cancelLabel: captured.confirm.cancelLabel || ''
              }).then(function (ok) {
                if (!ok) { return; }
                sb.post({
                  type: 'invokeCommand',
                  command: captured.command,
                  args: captured.args || []
                });
              });
              return;
            }
            sb.post({
              type: 'invokeCommand',
              command: captured.command,
              args: captured.args || []
            });
            hideContextMenu();
          });
        })(item);
      }

      menu.appendChild(el);
    });

    // 定位并挂载
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.appendChild(menu);
    activeMenu = menu;
    fitMenuToViewport(menu);
  }

  /** 隐藏并清理当前菜单 */
  function hideContextMenu() {
    if (activeMenu) {
      activeMenu.remove();
      activeMenu = null;
    }
  }

  /** 视口边界适配：菜单溢出右/下边界时回缩，避免被裁剪 */
  function fitMenuToViewport(menu) {
    var rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = Math.max(0, window.innerWidth - rect.width - 4) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = Math.max(0, window.innerHeight - rect.height - 4) + 'px';
    }
  }

  // 全局点击：点击菜单外部时关闭
  document.addEventListener('click', function (e) {
    if (activeMenu && !activeMenu.contains(e.target)) { hideContextMenu(); }
  });

  // 全局右键：在菜单外部再次右键时先关闭旧菜单（避免叠加）
  document.addEventListener('contextmenu', function (e) {
    if (activeMenu && !activeMenu.contains(e.target)) { hideContextMenu(); }
  });

  // Esc 键关闭
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && activeMenu) { hideContextMenu(); }
  });

  // 暴露到 __sb 命名空间
  window.__sb.showContextMenu = showContextMenu;
  window.__sb.hideContextMenu = hideContextMenu;
})();`;
}
