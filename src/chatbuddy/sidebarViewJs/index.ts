/**
 * 侧边栏前端脚本入口聚合。
 *
 * 导出：
 * - getSidebarBodyHtml(kind): 各 view 的 body 骨架 HTML
 * - getSidebarScript(kind):   按 kind 拼接 shared + treeList + contextMenu + searchBox
 *                              + 各 view 专用脚本（settings / assistants / sessions）
 */
import type { SidebarViewKind } from '../sidebarViewTypes';
import { getAssistantsScript } from './assistants';
import { getContextMenuScript } from './contextMenu';
import { getSearchBoxScript } from './searchBox';
import { getSessionsScript } from './sessions';
import { getSettingsScript } from './settings';
import { getSharedScript } from './shared';
import { getTreeListScript } from './treeList';

/**
 * 返回各 view 的 body HTML。
 *
 * - settings：独立的 settingsRoot + settingsLoading 容器（静态列表，无搜索框）
 * - assistants / recycleBin：统一的 assistantsRoot + assistantsLoading 骨架，
 *   前端脚本会按 mode 动态创建搜索框与列表容器
 * - sessions：独立的 sessionsRoot + sessionsLoading 骨架，
 *   前端脚本动态创建搜索框与列表容器
 */
export function getSidebarBodyHtml(kind: SidebarViewKind): string {
  if (kind === 'settings') {
    return (
      '<div class="sidebar-root" id="settingsRoot"></div>' +
      '<div class="loading" id="settingsLoading">Loading...</div>'
    );
  }
  if (kind === 'sessions') {
    return (
      '<div class="sidebar-root" id="sessionsRoot">' +
      '<div class="loading" id="sessionsLoading">Loading...</div>' +
      '</div>'
    );
  }
  // assistants / recycleBin
  return (
    '<div class="sidebar-root" id="assistantsRoot">' +
    '<div class="loading" id="assistantsLoading">Loading...</div>' +
    '</div>'
  );
}

/**
 * 返回完整前端脚本。
 *
 * 注入 SIDEBAR_VIEW_KIND 常量（供前端判断当前 view 种类），再依次拼接：
 * - shared + treeList + contextMenu + searchBox（所有 view 共用的基础组件）
 * - 各 view 专用脚本（settings / assistants / sessions，均以 IIFE 自执行）
 */
export function getSidebarScript(kind: SidebarViewKind): string {
  const header = 'var SIDEBAR_VIEW_KIND = ' + JSON.stringify(kind) + ';';
  const common =
    header + '\n' +
    getSharedScript() + '\n' +
    getTreeListScript() + '\n' +
    getContextMenuScript() + '\n' +
    getSearchBoxScript();

  if (kind === 'assistants' || kind === 'recycleBin') {
    return common + '\n' + getAssistantsScript();
  }
  if (kind === 'sessions') {
    return common + '\n' + getSessionsScript();
  }
  // settings
  return common + '\n' + getSettingsScript();
}
