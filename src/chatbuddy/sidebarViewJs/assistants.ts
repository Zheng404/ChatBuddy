/**
 * Assistants / RecycleBin 侧边栏 Webview 前端脚本生成器。
 *
 * 导出 getAssistantsScript(): string，返回前端 IIFE JS 字符串，最终内联到 webview。
 * 依赖 shared.ts / treeList.ts / contextMenu.ts / searchBox.ts 暴露的 window.__sb 命名空间。
 *
 * 渲染逻辑：
 * - main 模式：顶部搜索框（一次性创建，跨渲染保留）+ 分组树列表
 * - recycle 模式：无搜索框，平铺已删除助手，不足 minRecycleRows 时补 spacer
 *
 * 右键菜单项与原 TreeView package.json 的 when 子句 1:1 对齐：
 * - active 助手：pin / edit / delete(soft)
 * - pinned 助手：unpin / edit / delete(soft)
 * - deleted 助手：restore / hardDelete
 * - default 分组：rename（系统分组不可删除）
 * - custom 分组：rename / delete
 *
 * 安全约束（符合 AGENTS.md WebView 规范）：
 * - 禁止 innerHTML / eval，DOM 全部用 createElement，文本用 textContent
 * - 命令参数通过闭包 capture，不在 DOM 上以 JSON 存储敏感数据
 */
export function getAssistantsScript(): string {
  return `// ─── Assistants / RecycleBin 侧边栏前端脚本 ─────────────────
(function () {
  'use strict';

  var sb = window.__sb;
  if (!sb) { return; }

  var root = sb.dom('assistantsRoot');
  var loading = sb.dom('assistantsLoading');
  // 搜索框控件（仅 main 模式创建一次，跨渲染保留）
  var searchControls = null;
  // 列表容器（创建一次，renderTreeList 每次清空并重填）
  var listEl = null;
  // 最近一次 state，供右键菜单查找节点详情
  var lastState = null;

  /** 从 lastState 中按 id 查找助手 */
  function findAssistant(id) {
    if (!lastState) { return null; }
    for (var i = 0; i < lastState.assistants.length; i++) {
      if (lastState.assistants[i].id === id) { return lastState.assistants[i]; }
    }
    return null;
  }

  /** 从 lastState 中按 id 查找分组 */
  function findGroup(id) {
    if (!lastState || !lastState.groups) { return null; }
    for (var i = 0; i < lastState.groups.length; i++) {
      if (lastState.groups[i].id === id) { return lastState.groups[i]; }
    }
    return null;
  }

  /**
   * 根据节点 contextValue 构造右键菜单项。
   * node: { kind:'item'|'group', id, contextValue }
   *
   * 危险操作（softDelete / hardDelete / deleteGroup）携带 confirm 字段，
   * 由 contextMenu 组件在点击前先弹 Danger Modal 确认（A 类：webview 内触发）。
   */
  function getMenuItems(node) {
    var items = [];
    var s = (lastState && lastState.strings) || {};

    if (node.kind === 'item') {
      var a = findAssistant(node.id);
      if (!a) { return items; }
      if (a.contextValue === 'chatbuddy.assistant.deleted') {
        items.push({ label: s.restoreAssistant || 'Restore', icon: 'history', command: 'chatbuddy.restoreAssistant', args: [a.id] });
        items.push({ separator: true });
        items.push({
          label: s.hardDeleteAssistant || 'Delete Permanently',
          icon: 'trash',
          command: 'chatbuddy.hardDeleteAssistant',
          args: [a.id],
          confirm: {
            message: (s.confirmHardDeleteAssistant || 'Delete "{name}" permanently?').replace('{name}', a.name || a.id),
            actionLabel: s.hardDeleteAction || 'Delete',
            cancelLabel: s.cancelAction || 'Cancel'
          }
        });
      } else if (a.contextValue === 'chatbuddy.assistant.pinned') {
        items.push({ label: s.unpinAssistant || 'Unpin', icon: 'pinned', command: 'chatbuddy.unpinAssistant', args: [a.id] });
        items.push({ label: s.editAssistant || 'Edit', icon: 'edit', command: 'chatbuddy.editAssistant', args: [a.id] });
        items.push({ separator: true });
        items.push({
          label: s.deleteAssistant || 'Delete',
          icon: 'trash',
          command: 'chatbuddy.softDeleteAssistant',
          args: [a.id],
          confirm: {
            message: (s.confirmDeleteAssistant || 'Delete "{name}"?').replace('{name}', a.name || a.id),
            actionLabel: s.deleteAction || 'Delete',
            cancelLabel: s.cancelAction || 'Cancel'
          }
        });
      } else {
        // active
        items.push({ label: s.pinAssistant || 'Pin', icon: 'pin', command: 'chatbuddy.pinAssistant', args: [a.id] });
        items.push({ label: s.editAssistant || 'Edit', icon: 'edit', command: 'chatbuddy.editAssistant', args: [a.id] });
        items.push({ separator: true });
        items.push({
          label: s.deleteAssistant || 'Delete',
          icon: 'trash',
          command: 'chatbuddy.softDeleteAssistant',
          args: [a.id],
          confirm: {
            message: (s.confirmDeleteAssistant || 'Delete "{name}"?').replace('{name}', a.name || a.id),
            actionLabel: s.deleteAction || 'Delete',
            cancelLabel: s.cancelAction || 'Cancel'
          }
        });
      }
    } else if (node.kind === 'group') {
      var g = findGroup(node.id);
      if (!g) { return items; }
      items.push({ label: s.rename || 'Rename', icon: 'edit', command: 'chatbuddy.renameGroup', args: [g.id] });
      // 默认分组（系统分组）不可删除
      if (g.contextValue === 'chatbuddy.group.custom') {
        items.push({ separator: true });
        items.push({
          label: s.delete || 'Delete',
          icon: 'trash',
          command: 'chatbuddy.deleteGroup',
          args: [g.id],
          confirm: {
            message: (s.confirmDeleteGroup || 'Delete group "{name}"?').replace('{name}', g.displayName || g.name || g.id),
            actionLabel: s.deleteAction || 'Delete',
            cancelLabel: s.cancelAction || 'Cancel'
          }
        });
      }
    }
    return items;
  }

  /** 首次渲染时创建布局骨架（搜索框 + 列表容器） */
  function ensureLayout(state) {
    if (loading) { loading.style.display = 'none'; }
    // 搜索框仅 main 模式创建一次
    if (!searchControls && state.mode === 'main' && root) {
      searchControls = sb.createSearchBox(root, {
        placeholder: (state.strings && state.strings.assistantSearchPlaceholder) || 'Search assistants...',
        // 过滤由 host 端 buildState 完成，本地 onSearch 无需额外操作
        onSearch: function () { /* no-op */ }
      });
    }
    // 列表容器创建一次，后续 renderTreeList 会清空重填
    if (!listEl && root) {
      listEl = sb.createElement('div', { className: 'tree-list', id: 'assistantsList' }, null);
      root.appendChild(listEl);
    }
  }

  /** 全量渲染 */
  function render(state) {
    lastState = state;
    ensureLayout(state);
    if (!listEl) { return; }

    // 构造 groups（recycle 模式为空数组，平铺展示）
    var groups = state.mode === 'main'
      ? (state.groups || []).map(function (g) {
          return { id: g.id, name: g.displayName, collapsed: g.collapsed, contextValue: g.contextValue };
        })
      : [];

    // 构造 items（平面列表，renderTreeList 会按 groupId 归入各分组）
    var items = (state.assistants || []).map(function (a) {
      return {
        id: a.id,
        groupId: a.groupId,
        label: a.name,
        description: a.note || '',
        icon: a.avatar || 'account',
        selected: state.selectedAssistantId === a.id,
        contextValue: a.contextValue,
        tooltip: a.note || a.name
      };
    });

    sb.renderTreeList(listEl, groups, items, {
      minRows: state.mode === 'recycle' ? (state.minRecycleRows || 4) : 0,
      emptyText: (state.strings && state.strings.sidebarEmpty) || 'No assistants in this group',
      emptyIcon: 'account',
      onLeafClick: function (id) {
        // openAssistantChat 接受 string id
        sb.post({ type: 'invokeCommand', command: 'chatbuddy.openAssistantChat', args: [id] });
      },
      onGroupToggle: function (groupId) {
        // treeList 仅传回 groupId，需自行查表计算新折叠态
        var grp = findGroup(groupId);
        var newCollapsed = grp ? !grp.collapsed : true;
        sb.post({ type: 'toggleGroupCollapse', groupId: groupId, collapsed: newCollapsed });
      },
      onContextMenu: function (node, x, y) {
        var menuItems = getMenuItems(node);
        if (menuItems.length > 0) {
          sb.showContextMenu(menuItems, x, y);
        }
      }
    });
  }

  // 监听 Host 消息
  sb.onMessage(function (msg) {
    if (!msg) { return; }
    if (msg.type === 'state') {
      render(msg.payload);
      return;
    }
    if (msg.type === 'clearSearch' && searchControls) {
      searchControls.input.value = '';
      return;
    }
    if (msg.type === 'focusSearch' && searchControls) {
      try { searchControls.input.focus(); } catch (e) { /* 忽略 focus 异常 */ }
      return;
    }
    if (msg.type === 'scrollTo' && msg.id) {
      // treeList 叶子行带 data-item-id 属性
      var el = document.querySelector('[data-item-id="' + sb.escapeAttr(msg.id) + '"]');
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
        el.classList.add('flash-highlight');
        setTimeout(function () { el.classList.remove('flash-highlight'); }, 800);
      }
    }
  });
})();`;
}
