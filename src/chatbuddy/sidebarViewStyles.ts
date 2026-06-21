/**
 * 侧边栏 Webview 共享 CSS。
 *
 * 全部使用 VS Code 主题 CSS 变量，确保 light / dark / high-contrast 三主题均正确。
 * 覆盖：基础重置、树列表容器、分组行、叶子行、内联图标按钮、搜索框、
 *      右键菜单、spacer 空行、滚动条、loading 占位。
 *
 * 导出函数 getSidebarStyles(): string，返回完整 CSS 文本（不含 <style> 标签）。
 */
import { SHARED_WEBVIEW_BASE } from './webviewBaseTheme';
import { SHARED_TOAST_STYLE } from './toastTheme';

export function getSidebarStyles(): string {
  return `/* ─── 侧边栏 Webview 共享样式 ─────────────────────────────── */

${SHARED_WEBVIEW_BASE}

/* 侧边栏专用变量覆盖 */
/* --bg 保持 --vscode-sideBar-background，确保与 VS Code 原生侧边栏融为一体。
   卡片/面板通过 --panel-bg 的 color-mix 提亮，避免破坏原生感。 */
:root {
  --bg: var(--vscode-sideBar-background);
  --panel-bg: color-mix(in srgb, var(--bg) 92%, white 8%);
  --panel-bg-strong: color-mix(in srgb, var(--bg) 86%, white 14%);
  --accent: var(--vscode-focusBorder, var(--vscode-button-background));
}

body {
  -webkit-user-select: none;
  user-select: none;
  overflow: hidden;
}

${SHARED_TOAST_STYLE}

/* 根容器 */
.sidebar-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  overflow: hidden;
}

/* ─── 搜索框 ───────────────────────────────────────────────── */
.search-box {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px 4px;
  background-color: var(--bg);
}

.search-box input {
  flex: 1 1 auto;
  min-width: 0;
  height: 26px;
  padding: 0 6px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--input-fg);
  background-color: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-md);
  outline: none;
  transition: border-color var(--duration-normal) ease;
}

.search-box input:focus {
  border-color: var(--accent);
}

.search-box input::placeholder {
  color: var(--vscode-input-placeholderForeground);
}

/* 搜索状态小标签（命中数 / 清除） */
.search-status {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  cursor: default;
}

/* ─── 树列表容器 ───────────────────────────────────────────── */
.tree-list {
  flex: 1 1 auto;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 2px 0 8px;
}

/* ─── 分组行 ───────────────────────────────────────────────── */
.tree-group {
  display: flex;
  align-items: center;
  height: 22px;
  padding: 0 8px 0 4px;
  cursor: default;
  color: var(--fg);
  font-weight: 600;
  white-space: nowrap;
  transition: background var(--duration-normal) ease;
}

.tree-group:hover {
  background-color: var(--vscode-list-hoverBackground);
}

.tree-group-arrow {
  flex: 0 0 auto;
  width: 16px;
  font-size: 14px;
  color: var(--muted);
  text-align: center;
}

.tree-group-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 分组右侧操作区域 */
.tree-group-actions {
  flex: 0 0 auto;
  display: none;
  gap: 2px;
}

.tree-group:hover .tree-group-actions {
  display: inline-flex;
}

/* ─── 叶子行 ───────────────────────────────────────────────── */
.tree-item {
  display: flex;
  align-items: center;
  height: 22px;
  padding-right: 8px;
  cursor: default;
  color: var(--fg);
  white-space: nowrap;
  transition: background var(--duration-normal) ease;
}

.tree-item:hover {
  background-color: var(--vscode-list-hoverBackground);
}

/* 非激活选中态（焦点不在列表时的选中色） */
.tree-item.selected {
  background-color: var(--vscode-list-inactiveSelectionBackground);
  color: var(--vscode-list-inactiveSelectionForeground, var(--vscode-foreground));
}

/* 列表拥有焦点时的选中色由 .tree-list:focus-within .tree-item.selected 控制 */
.tree-list:focus-within .tree-item.selected {
  background-color: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
}

.tree-item-icon {
  flex: 0 0 auto;
  width: 16px;
  margin-right: 4px;
  font-size: 14px;
  text-align: center;
  color: var(--fg);
}

.tree-item-label {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-item-description {
  flex: 1 1 auto;
  min-width: 0;
  margin-left: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted);
  font-size: 11px;
}

/* 叶子行右侧操作图标区 */
.tree-item-actions {
  flex: 0 0 auto;
  display: none;
  gap: 2px;
}

.tree-item:hover .tree-item-actions {
  display: inline-flex;
}

/* ─── 内联图标按钮 ─────────────────────────────────────────── */
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--fg);
  font-family: codicon, var(--vscode-font-family);
  font-size: 14px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--duration-normal) ease;
}

.icon-button:hover {
  background-color: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}

.icon-button:active {
  background-color: var(--vscode-toolbar-activeBackground, var(--vscode-list-hoverBackground));
}

/* ─── spacer 空行（占位填充） ──────────────────────────────── */
.tree-spacer {
  height: 22px;
}

/* ─── 右键菜单 ─────────────────────────────────────────────── */
.context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 180px;
  padding: 4px 0;
  background-color: var(--vscode-menu-background, var(--bg));
  color: var(--vscode-menu-foreground, var(--fg));
  border: 1px solid var(--vscode-menu-border, var(--border));
  border-radius: var(--radius-md);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
}

.context-menu-item {
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 14px 0 28px;
  cursor: default;
  white-space: nowrap;
  transition: background var(--duration-normal) ease;
}

.context-menu-item:hover {
  background-color: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
  color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)));
}

.context-menu-item.context-menu-item-disabled {
  color: var(--vscode-disabledForeground, var(--muted));
  cursor: default;
}

.context-menu-item.context-menu-item-disabled:hover {
  background-color: transparent;
  color: var(--vscode-disabledForeground, var(--muted));
}

/* 菜单分隔符 */
.context-menu-separator {
  height: 1px;
  margin: 4px 0;
  background-color: var(--vscode-menu-separatorBackground, var(--border));
}

/* ─── loading 占位 ─────────────────────────────────────────── */
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: var(--muted);
  font-size: 12px;
}

/* ─── 空状态 ───────────────────────────────────────────────── */
.sidebar-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  color: var(--muted);
  text-align: center;
  gap: 8px;
}

.sidebar-empty .codicon {
  font-size: 24px;
  opacity: 0.4;
}

.sidebar-empty-text {
  font-size: 12px;
  line-height: 1.5;
}

/* ─── scrollTo 临时高亮（flash 动画） ──────────────────────── */
/* 主机端 scrollToAssistant 推送后，前端给目标行临时加上此 class */
@keyframes sidebar-flash {
  0% { background-color: var(--vscode-list-focusBackground, transparent); }
  100% { background-color: transparent; }
}

.flash-highlight {
  animation: sidebar-flash 0.8s ease-out;
}

/* ─── Settings 侧边栏条目 ──────────────────────────────────── */
/* 复用 .tree-item 布局，但设置项是可点击的导航入口 */
.settings-item {
  cursor: pointer;
}`;
}
