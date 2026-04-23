/**
 * 聊天面板样式聚合入口。
 *
 * 按功能区域拆分为多个模块，通过此入口统一组合：
 * - webviewChatBaseCss.ts        — 基础布局、消息结构、空状态、action 按钮
 * - webviewChatMarkdownCss.ts    — 代码块、数学公式、Mermaid、表格、任务列表
 * - webviewChatComposerCss.ts    — Composer 输入区、动作按钮、图片预览栏
 * - webviewChatToolsCss.ts       — Reasoning-block、tool-rounds-block、MCP 条目
 * - webviewChatSearchModalCss.ts — 搜索栏、高亮、raw modal、confirm
 */
import { SHARED_WEBVIEW_BASE } from './webviewBaseTheme';
import { SHARED_TOAST_STYLE } from './toastTheme';
import { getWebviewChatBaseCss } from './webviewChatBaseCss';
import { getWebviewChatMarkdownCss } from './webviewChatMarkdownCss';
import { getWebviewChatComposerCss } from './webviewChatComposerCss';
import { getWebviewChatToolsCss } from './webviewChatToolsCss';
import { getWebviewChatSearchModalCss } from './webviewChatSearchModalCss';

/**
 * Returns the CSS for the chat webview panel.
 * Includes the shared base theme plus chat-specific styles.
 */
export function getChatPanelCss(): string {
  return `
${SHARED_WEBVIEW_BASE}
${getWebviewChatBaseCss()}
${getWebviewChatMarkdownCss()}
${getWebviewChatComposerCss()}
${getWebviewChatToolsCss()}
${getWebviewChatSearchModalCss()}
${SHARED_TOAST_STYLE}
  `;
}
