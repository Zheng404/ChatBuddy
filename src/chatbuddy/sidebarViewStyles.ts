/**
 * 侧边栏 Webview 共享 CSS。
 *
 * 全部使用 VS Code 主题 CSS 变量，确保 light / dark / high-contrast 三主题均正确。
 * 覆盖：基础重置、树列表容器、分组行、叶子行、内联图标按钮、搜索框、
 *      右键菜单、spacer 空行、滚动条、loading 占位。
 *
 * 导出函数 getSidebarStyles(): string，返回完整 CSS 文本（不含 <style> 标签）。
 */

export function getSidebarStyles(): string {
  return `/* ─── 侧边栏 Webview 共享样式 ─────────────────────────────── */

/* 基础重置 */
* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
}

body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
  background-color: var(--vscode-sideBar-background);
  -webkit-user-select: none;
  user-select: none;
  overflow: hidden;
}

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
  background-color: var(--vscode-sideBar-background);
}

.search-box input {
  flex: 1 1 auto;
  min-width: 0;
  height: 26px;
  padding: 0 6px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-input-foreground);
  background-color: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  outline: none;
}

.search-box input:focus {
  border-color: var(--vscode-focusBorder, var(--vscode-input-border, transparent));
}

.search-box input::placeholder {
  color: var(--vscode-input-placeholderForeground);
}

/* 搜索状态小标签（命中数 / 清除） */
.search-status {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
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
  color: var(--vscode-foreground);
  font-weight: 600;
  white-space: nowrap;
}

.tree-group:hover {
  background-color: var(--vscode-list-hoverBackground);
}

.tree-group-arrow {
  flex: 0 0 auto;
  width: 16px;
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
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
  color: var(--vscode-foreground);
  white-space: nowrap;
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
  color: var(--vscode-foreground);
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
  color: var(--vscode-descriptionForeground);
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
  color: var(--vscode-foreground);
  font-family: codicon, var(--vscode-font-family);
  font-size: 14px;
  cursor: pointer;
  border-radius: 2px;
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
  background-color: var(--vscode-menu-background, var(--vscode-editor-background));
  color: var(--vscode-menu-foreground, var(--vscode-foreground));
  border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));
  border-radius: 2px;
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
}

.context-menu-item:hover {
  background-color: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
  color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)));
}

.context-menu-item.context-menu-item-disabled {
  color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
  cursor: default;
}

.context-menu-item.context-menu-item-disabled:hover {
  background-color: transparent;
  color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
}

/* 菜单分隔符 */
.context-menu-separator {
  height: 1px;
  margin: 4px 0;
  background-color: var(--vscode-menu-separatorBackground, var(--vscode-editorWidget-border, rgba(128, 128, 128, 0.35)));
}

/* ─── loading 占位 ─────────────────────────────────────────── */
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
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
}

/* ─── 滚动条 ───────────────────────────────────────────────── */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background-color: var(--vscode-scrollbarSlider-background);
  border-radius: 5px;
}

::-webkit-scrollbar-thumb:hover {
  background-color: var(--vscode-scrollbarSlider-hoverBackground);
}

::-webkit-scrollbar-thumb:active {
  background-color: var(--vscode-scrollbarSlider-activeBackground);
}`;
}
