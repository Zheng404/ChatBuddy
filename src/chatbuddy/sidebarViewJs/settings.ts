/**
 * Settings 侧边栏 Webview 前端脚本生成器。
 *
 * 导出 getSettingsScript(): string，返回前端 IIFE JS 字符串，最终内联到 webview。
 * 依赖 shared.ts 暴露的 window.__sb 命名空间。
 *
 * 渲染逻辑：收到 {type:'state'} 后清空容器，逐条 createElement 构建 settings-item。
 *
 * 安全约束：
 * - 清空容器用 textContent = ''（比 innerHTML 安全）
 * - 子元素全部 createElement + textContent，无任何 HTML 字符串拼接
 * - label / tooltip 均为 i18n 文案（非用户输入），但仍用 textContent / title 写入以防万一
 */
export function getSettingsScript(): string {
  return `// ─── Settings 侧边栏前端脚本 ─────────────────────────────────
(function () {
  'use strict';

  var sb = window.__sb;

  /** 渲染设置条目列表 */
  function render(state) {
    var root = sb.dom('settingsRoot');
    var loading = sb.dom('settingsLoading');
    if (!root) { return; }
    if (loading) { loading.style.display = 'none'; }
    // 清空容器：textContent 比 innerHTML 更安全且更快
    root.textContent = '';
    root.className = (root.className || '') + ' tree-list';

    var items = state.items || [];
    for (var i = 0; i < items.length; i++) {
      root.appendChild(buildSettingsItem(items[i]));
    }
  }

  /** 构建单个设置条目 */
  function buildSettingsItem(item) {
    var icon = sb.createElement('span', {
      className: 'tree-item-icon codicon codicon-' + (item.icon || '')
    }, null);
    var label = sb.createElement('span', {
      className: 'tree-item-label',
      textContent: item.label
    }, null);
    return sb.createElement('div', {
      className: 'tree-item settings-item',
      title: item.tooltip || '',
      dataset: { itemId: item.id, nodeKind: 'item' },
      onClick: function () {
        sb.post({ type: 'invokeCommand', command: item.command });
      }
    }, [
      icon,
      label,
      sb.createElement('span', { className: 'tree-item-actions' }, null)
    ]);
  }

  sb.onMessage(function (msg) {
    if (msg && msg.type === 'state') { render(msg.payload); }
  });
})();`;
}
