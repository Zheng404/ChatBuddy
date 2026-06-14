/**
 * Sessions 侧边栏 Webview 前端脚本生成器。
 *
 * 导出 getSessionsScript(): string，返回前端 IIFE JS 字符串，最终内联到 webview。
 * 依赖 shared.ts / treeList.ts / contextMenu.ts / searchBox.ts 暴露的 window.__sb 命名空间。
 *
 * 渲染逻辑：
 * - 顶部搜索框（一次性创建，跨渲染保留）
 * - 会话平铺列表（无分组，groups=[]）
 * - 不足 minRows 时由 treeList 补 spacer 占位
 * - 叶子行图标：comment-discussion（选中）/ comment（未选中）
 *
 * 右键菜单项（与原 TreeView package.json 的 view/item/context 1:1 对齐）：
 * - renameSession [assistantId, sessionId]
 * - deleteSession [assistantId, sessionId]
 * - exportSession [assistantId, sessionId]
 *
 * 安全约束（符合 AGENTS.md WebView 规范）：
 * - 禁止 innerHTML / eval，DOM 全部用 createElement，文本用 textContent
 * - 命令参数通过闭包 capture，不在 DOM 上以 JSON 存储敏感数据
 */
export function getSessionsScript(): string {
  return `// ─── Sessions 侧边栏前端脚本 ──────────────────────────────────
(function () {
  'use strict';

  var sb = window.__sb;
  if (!sb) { return; }

  var root = sb.dom('sessionsRoot');
  var loading = sb.dom('sessionsLoading');
  // 搜索框控件（创建一次，跨渲染保留）
  var searchControls = null;
  // 列表容器（创建一次，renderTreeList 每次清空并重填）
  var listEl = null;
  // 最近一次 state，供右键菜单查找节点详情
  var lastState = null;

  /** 从 lastState 中按 id 查找会话 */
  function findSession(id) {
    if (!lastState) { return null; }
    for (var i = 0; i < lastState.sessions.length; i++) {
      if (lastState.sessions[i].id === id) { return lastState.sessions[i]; }
    }
    return null;
  }

  /** 构造会话命令参数（[assistantId, sessionId]） */
  function buildSessionArgs(s) {
    var aid = lastState && lastState.selectedAssistant ? lastState.selectedAssistant.id : '';
    return [aid, s.id];
  }

  /** 根据节点 contextValue 构造右键菜单项 */
  function getMenuItems(node) {
    var items = [];
    var s = (lastState && lastState.strings) || {};
    if (node.kind !== 'item') { return items; }
    var session = findSession(node.id);
    if (!session) { return items; }

    items.push({ label: s.rename || 'Rename', icon: 'edit', command: 'chatbuddy.renameSession', args: buildSessionArgs(session) });
    items.push({ separator: true });
    items.push({ label: s.delete || 'Delete', icon: 'trash', command: 'chatbuddy.deleteSession', args: buildSessionArgs(session) });
    items.push({ label: s.exportSessionAction || 'Export Session', icon: 'export', command: 'chatbuddy.exportSession', args: buildSessionArgs(session) });
    return items;
  }

  /** 首次渲染时创建布局骨架（搜索框 + 列表容器） */
  function ensureLayout(state) {
    if (loading) { loading.style.display = 'none'; }
    if (!searchControls && root) {
      searchControls = sb.createSearchBox(root, {
        placeholder: (state.strings && state.strings.sessionSearchPlaceholder) || 'Search sessions...',
        // 过滤由 host 端 buildState 完成，本地 onSearch 无需额外操作
        onSearch: function () { /* no-op */ }
      });
    }
    if (!listEl && root) {
      listEl = sb.createElement('div', { className: 'tree-list', id: 'sessionsList' }, null);
      root.appendChild(listEl);
    }
  }

  /** 全量渲染 */
  function render(state) {
    lastState = state;
    ensureLayout(state);
    if (!listEl) { return; }

    // sessions 视图无分组（groups=[]），由 treeList 平铺渲染
    var groups = [];
    var items = (state.sessions || []).map(function (s) {
      return {
        id: s.id,
        groupId: '',
        label: s.title,
        description: s.formattedUpdatedAt,
        // 选中态用 comment-discussion 图标，其余用 comment
        icon: s.isSelected ? 'comment-discussion' : 'comment',
        selected: !!s.isSelected,
        contextValue: s.contextValue,
        tooltip: s.tooltip || s.title
      };
    });

    sb.renderTreeList(listEl, groups, items, {
      minRows: state.minRows || 0,
      onLeafClick: function (id) {
        // openSessionChat 接受 (assistantId, sessionId)
        var aid = state.selectedAssistant ? state.selectedAssistant.id : '';
        sb.post({ type: 'invokeCommand', command: 'chatbuddy.openSessionChat', args: [aid, id] });
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
