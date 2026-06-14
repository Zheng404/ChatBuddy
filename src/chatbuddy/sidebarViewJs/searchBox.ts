/**
 * 侧边栏 Webview 搜索框组件脚本生成器。
 *
 * 导出 getSearchBoxScript(): string，返回前端搜索框组件的 JS 字符串，
 * 最终内联到 webview 的 <script nonce="..."> 中。
 *
 * 依赖 shared.ts 暴露的 window.__sb 命名空间（createElement / dom / debounce / post）。
 *
 * 组件职责（严格单一）：
 * - 只负责搜索框 UI 与事件分发，不实现具体过滤逻辑
 * - 过滤逻辑由各 view 脚本通过 onSearch(keyword) 回调自行实现
 *   （assistants 按 name+note 过滤，sessions 按 title+content 过滤，策略不同）
 *
 * 通信约定：
 * - 每次 input 以 150ms 防抖 post {type:'search', keyword} 给 Host
 *   （Host 可据此更新 UI 状态，但搜索关键词以 webview 本地持有为主）
 * - Host 发 clearSearch 消息时调用 clearSearch()，清空本地输入
 *   （用于切换 view / 状态重置等场景）
 *
 * 安全约束（符合 AGENTS.md WebView 规范）：
 * - 禁止 innerHTML / eval，DOM 全部用 createElement
 * - placeholder/title 由调用方传入的 i18n 字符串，用属性设置
 */
export function getSearchBoxScript(): string {
  return `// ─── 侧边栏搜索框组件 ───────────────────────────────────────
(function () {
  'use strict';

  var sb = window.__sb;
  if (!sb) { return; }

  // 搜索输入框固定 id，供 clearSearch 定位
  var INPUT_ID = 'sidebarSearchInput';

  /**
   * 创建搜索框并挂载到 container。
   * options: { placeholder?, clearTitle?, onSearch?(keyword), onClear?() }
   *   - placeholder:  输入框占位文本（i18n）
   *   - clearTitle:   清除按钮 title（i18n），默认 'Clear'
   *   - onSearch(kw): 输入变化回调（已防抖），供 view 做本地过滤
   *   - onClear():    点击清除按钮回调
   * 返回 { input, clearBtn } 供调用方进一步操作。
   */
  function createSearchBox(container, options) {
    options = options || {};
    if (!container) { return null; }

    var box = sb.createElement('div', { className: 'search-box' }, null);
    var input = sb.createElement('input', {
      type: 'text',
      className: 'search-input',
      placeholder: options.placeholder || '',
      id: INPUT_ID
    }, null);
    var clearBtn = sb.createElement('button', {
      className: 'search-clear icon-button',
      title: options.clearTitle || 'Clear'
    }, null);
    clearBtn.appendChild(sb.createElement('i', { className: 'codicon codicon-close' }, null));

    // 输入防抖：先调本地回调（view 过滤），再通知 Host
    var debouncedSearch = sb.debounce(function () {
      var kw = input.value.trim();
      if (typeof options.onSearch === 'function') { options.onSearch(kw); }
      sb.post({ type: 'search', keyword: kw });
    }, 150);

    input.addEventListener('input', debouncedSearch);

    // 清除按钮：清空输入、重新聚焦、回调 + 通知 Host 关键词已清空
    clearBtn.addEventListener('click', function () {
      input.value = '';
      input.focus();
      if (typeof options.onClear === 'function') { options.onClear(); }
      sb.post({ type: 'search', keyword: '' });
    });

    box.appendChild(input);
    box.appendChild(clearBtn);
    container.appendChild(box);
    return { input: input, clearBtn: clearBtn };
  }

  /**
   * 清空搜索输入框的值。
   * 由 Host 发 clearSearch 消息时调用（切换 view / 状态重置等场景）。
   * 注意：仅清空 UI，不触发 onSearch 回调与 search 消息（由 Host 主动驱动）。
   */
  function clearSearch() {
    var input = sb.dom(INPUT_ID);
    if (input) { input.value = ''; }
  }

  // 暴露到 __sb 命名空间
  window.__sb.createSearchBox = createSearchBox;
  window.__sb.clearSearch = clearSearch;
})();`;
}
