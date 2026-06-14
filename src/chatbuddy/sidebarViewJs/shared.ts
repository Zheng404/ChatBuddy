/**
 * 侧边栏 Webview 前端公共脚本生成器。
 *
 * 本文件导出 getSharedScript(): string，返回前端公共 JS 代码字符串，
 * 最终内联到 webview 的 <script nonce="..."> 中。
 *
 * 安全约束（符合 AGENTS.md WebView 规范）：
 * - 所有 DOM 操作使用 createElement/textContent/setAttribute，禁止 innerHTML/eval
 * - 用户可控文本（name/note/title）一律用 textContent 写入，天然防 XSS
 * - escapeHtml/escapeAttr 仅在必须构造属性字符串时使用
 *
 * 提供的前端 API：
 * - post(msg)            封装 acquireVsCodeApi().postMessage（缓存 api）
 * - onMessage(handler)   监听 window message
 * - escapeHtml(s)/escapeAttr(s) 字符串转义
 * - dom(id)              document.getElementById 封装
 * - createElement(tag, props, children) 简易 DOM 构建器（避免 innerHTML）
 * - render(container, renderFn) 渲染框架（保存/恢复 scrollTop 与焦点）
 * - debounce(fn, ms)     防抖工具
 * - 文档加载完成后 post({type:'ready'}) 握手
 */
export function getSharedScript(): string {
  // 注意：以下字符串内的反斜杠需双写（\\n → 输出 \n），避免被 TS 模板字面量转义
  return `// ─── 侧边栏前端公共脚本 ─────────────────────────────────────
(function () {
  'use strict';

  // acquireVsCodeApi 全局唯一缓存，避免重复获取
  var __sidebarVscodeApi = null;

  function getVscodeApi() {
    if (!__sidebarVscodeApi) {
      __sidebarVscodeApi = acquireVsCodeApi();
    }
    return __sidebarVscodeApi;
  }

  /** 向 Host 发送消息 */
  function post(msg) {
    getVscodeApi().postMessage(msg);
  }

  /** 监听 Host 推送的消息 */
  function onMessage(handler) {
    window.addEventListener('message', function (event) {
      var data = event.data;
      if (data && typeof data === 'object') {
        handler(data);
      }
    });
  }

  /** 获取元素 by id */
  function dom(id) {
    return document.getElementById(id);
  }

  /** HTML 转义（仅在构造属性字符串时使用，普通文本请用 textContent） */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /** 属性值转义（额外转义换行） */
  function escapeAttr(s) {
    return escapeHtml(s)
      .replace(/\\n/g, '&#10;')
      .replace(/\\r/g, '&#13;');
  }

  /**
   * 简易 DOM 构建器，避免 innerHTML。
   * props 支持键：
   *   className / textContent / title / style(对象) / dataset(对象)
   *   on*(function) → addEventListener（如 onClick）
   *   其它 → setAttribute
   * children: string | Node | Array<string|Node>
   */
  function createElement(tag, props, children) {
    var el = document.createElement(tag);
    if (props) {
      for (var key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) { continue; }
        var value = props[key];
        if (value == null) { continue; }
        if (key === 'className') {
          el.className = value;
        } else if (key === 'textContent') {
          el.textContent = value;
        } else if (key === 'style' && typeof value === 'object') {
          for (var sk in value) {
            if (Object.prototype.hasOwnProperty.call(value, sk)) {
              el.style[sk] = value[sk];
            }
          }
        } else if (key === 'dataset' && typeof value === 'object') {
          for (var dk in value) {
            if (Object.prototype.hasOwnProperty.call(value, dk)) {
              el.dataset[dk] = value[dk];
            }
          }
        } else if (key.indexOf('on') === 0 && typeof value === 'function') {
          el.addEventListener(key.slice(2).toLowerCase(), value);
        } else {
          el.setAttribute(key, String(value));
        }
      }
    }
    if (children != null) {
      var arr = Array.isArray(children) ? children : [children];
      for (var i = 0; i < arr.length; i++) {
        var c = arr[i];
        if (c == null) { continue; }
        el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      }
    }
    return el;
  }

  /**
   * 渲染框架：渲染前保存 container.scrollTop 与 document.activeElement.id，
   * 渲染后恢复，避免全量重渲染时的滚动抖动与焦点丢失。
   */
  function render(container, renderFn) {
    var scrollTop = container ? container.scrollTop : 0;
    var activeId = (document.activeElement && document.activeElement.id) ? document.activeElement.id : '';
    if (typeof renderFn === 'function') { renderFn(); }
    if (container) { container.scrollTop = scrollTop; }
    if (activeId) {
      var el = document.getElementById(activeId);
      if (el) {
        try { el.focus(); } catch (e) { /* 忽略 focus 异常 */ }
      }
    }
  }

  /** 防抖工具 */
  function debounce(fn, ms) {
    var timer = null;
    return function () {
      var args = arguments;
      var ctx = this;
      if (timer) { clearTimeout(timer); }
      timer = setTimeout(function () { fn.apply(ctx, args); }, ms || 0);
    };
  }

  // 暴露到全局，供 treeList / 各 view 脚本使用
  window.__sb = {
    post: post,
    onMessage: onMessage,
    dom: dom,
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    createElement: createElement,
    render: render,
    debounce: debounce,
    getVscodeApi: getVscodeApi
  };

  // ready 握手：文档加载完成后通知 Host
  function notifyReady() { post({ type: 'ready' }); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', notifyReady);
  } else {
    notifyReady();
  }
})();`;
}
