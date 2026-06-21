/**
 * 侧边栏 Webview 树列表渲染组件脚本生成器。
 *
 * 导出 getTreeListScript(): string，返回前端 renderTreeList 组件的 JS 字符串。
 * 依赖 shared.ts 暴露的 window.__sb 命名空间（createElement / dom 等）。
 *
 * 节点数据形状（由各 view provider 构造后通过 state 推送）：
 *   group: { id, name, collapsed, contextValue }
 *   item:  { id, groupId, label, description, icon, selected, contextValue, tooltip }
 *
   * opts: { indentPx, onLeafClick, onGroupToggle, onContextMenu, selectedId, minRows, emptyText, emptyIcon }
 *
 * 安全约束：所有用户可控文本（name/label/description/tooltip）用 textContent 写入，
 *          禁止 innerHTML。tooltip 用 element.title 写入。
 */
export function getTreeListScript(): string {
  return `// ─── 侧边栏树列表渲染组件 ───────────────────────────────────
(function () {
  'use strict';

  var sb = window.__sb;

  /**
   * 渲染分组 + 叶子结构。
   * 折叠的分组不渲染其叶子；未匹配任何分组的叶子按无分组处理（缩进为 0）。
   */
  function renderTreeList(container, groups, items, opts) {
    opts = opts || {};
    var indentPx = typeof opts.indentPx === 'number' ? opts.indentPx : 12;
    var selectedId = opts.selectedId || '';
    var minRows = opts.minRows || 0;
    if (!container) { return; }

    // 清空容器（textContent 比 innerHTML 更安全且更快）
    container.textContent = '';
    if (container.className.indexOf('tree-list') < 0) {
      container.className = (container.className || '') + ' tree-list';
    }

    var knownGroupIds = {};
    var renderedCount = 0;

    // 渲染分组及其叶子
    for (var gi = 0; groups && gi < groups.length; gi++) {
      var group = groups[gi];
      knownGroupIds[group.id] = true;
      container.appendChild(buildGroupRow(group, opts));
      renderedCount++;
      if (group.collapsed) { continue; } // 折叠时不渲染叶子
      for (var ii = 0; items && ii < items.length; ii++) {
        var item = items[ii];
        if (item.groupId !== group.id) { continue; }
        container.appendChild(buildLeafRow(item, indentPx, selectedId, opts));
        renderedCount++;
      }
    }

    // 渲染未匹配任何分组的叶子（groupId 不在已知分组中）
    for (var ui = 0; items && ui < items.length; ui++) {
      var uitem = items[ui];
      if (knownGroupIds[uitem.groupId]) { continue; }
      container.appendChild(buildLeafRow(uitem, 0, selectedId, opts));
      renderedCount++;
    }

    // 不足 minRows 时补空行占位
    while (renderedCount < minRows) {
      container.appendChild(sb.createElement('div', { className: 'tree-spacer' }, null));
      renderedCount++;
    }

    // 无任何内容且提供了 emptyText 时，显示空状态提示
    if (renderedCount === 0 && opts.emptyText) {
      var emptyIcon = opts.emptyIcon || 'inbox';
      var emptyEl = sb.createElement('div', { className: 'sidebar-empty' }, [
        sb.createElement('span', { className: 'codicon codicon-' + emptyIcon }, null),
        sb.createElement('span', { className: 'sidebar-empty-text', textContent: opts.emptyText }, null)
      ]);
      container.appendChild(emptyEl);
    }
  }

  /** 构建分组行 */
  function buildGroupRow(group, opts) {
    var toggleHandler = function (e) {
      // 点击内联图标按钮时不触发展开/折叠
      if (e.target && e.target.classList && e.target.classList.contains('icon-button')) { return; }
      if (typeof opts.onGroupToggle === 'function') { opts.onGroupToggle(group.id); }
    };
    var ctxHandler = function (e) {
      if (!group.contextValue || typeof opts.onContextMenu !== 'function') { return; }
      e.preventDefault();
      e.stopPropagation();
      opts.onContextMenu({ kind: 'group', id: group.id, contextValue: group.contextValue }, e.clientX, e.clientY);
    };
    var arrowIcon = group.collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down';
    return sb.createElement('div', {
      className: 'tree-group' + (group.collapsed ? ' collapsed' : ''),
      dataset: { groupId: group.id, nodeKind: 'group' },
      onClick: toggleHandler,
      onContextmenu: ctxHandler
    }, [
      sb.createElement('span', { className: 'tree-group-arrow codicon ' + arrowIcon }, null),
      sb.createElement('span', { className: 'tree-group-label', textContent: group.name }, null),
      sb.createElement('span', { className: 'tree-group-actions' }, null)
    ]);
  }

  /** 构建叶子行 */
  function buildLeafRow(item, indentPx, selectedId, opts) {
    var clickHandler = function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('icon-button')) { return; }
      if (typeof opts.onLeafClick === 'function') { opts.onLeafClick(item.id); }
    };
    var ctxHandler = function (e) {
      if (!item.contextValue || typeof opts.onContextMenu !== 'function') { return; }
      e.preventDefault();
      e.stopPropagation();
      opts.onContextMenu({ kind: 'item', id: item.id, contextValue: item.contextValue }, e.clientX, e.clientY);
    };
    var children = [];
    if (item.icon) {
      children.push(sb.createElement('span', { className: 'tree-item-icon codicon codicon-' + item.icon }, null));
    }
    children.push(sb.createElement('span', { className: 'tree-item-label', textContent: item.label }, null));
    if (item.description) {
      children.push(sb.createElement('span', { className: 'tree-item-description', textContent: item.description }, null));
    }
    children.push(sb.createElement('span', { className: 'tree-item-actions' }, null));
    return sb.createElement('div', {
      className: 'tree-item' + (item.id === selectedId || item.selected ? ' selected' : ''),
      title: item.tooltip || '',
      dataset: { itemId: item.id, nodeKind: 'item' },
      style: { paddingLeft: indentPx + 'px' },
      onClick: clickHandler,
      onContextmenu: ctxHandler
    }, children);
  }

  // 暴露 renderTreeList 到 __sb 命名空间
  if (window.__sb) {
    window.__sb.renderTreeList = renderTreeList;
  }
})();`;
}
