/**
 * 侧边栏 Webview HTML 文档组装。
 *
 * 参考 webview.ts / settingsHtmlGenerator.ts 的组装模式：
 * - nonce + CSP meta
 * - codicon CSS 内联（<style>）
 * - 共享侧边栏 CSS 内联（<style>）
 * - body 上挂 data-view="kind" 属性，前端据此初始化
 * - 前端脚本用 nonce 内联
 *
 * 注意：本扩展所有资源（codicon 字体、CSS、JS）均内联，无需引用 extensionUri，
 *      故不接收 extensionUri 参数（遵循 settingsHtmlGenerator.ts 的先例）。
 */
import * as vscode from 'vscode';
import { buildCsp, getNonce } from './utils/csp';
import { getCodiconStyleText } from './codicon';
import { getSidebarStyles } from './sidebarViewStyles';
import { getSidebarBodyHtml, getSidebarScript } from './sidebarViewJs';
import type { SidebarViewKind } from './sidebarViewTypes';

/**
 * 组装并返回侧边栏 view 的完整 HTML 文档。
 * @param kind    view 种类标识（assistants/sessions/recycleBin/settings）
 * @param webview webview 实例（用于 cspSource）
 */
export function buildSidebarHtml(kind: SidebarViewKind, webview: vscode.Webview): string {
  const nonce = getNonce();
  const codiconStyleText = getCodiconStyleText();
  const csp = buildCsp(webview, nonce);
  const styles = getSidebarStyles();
  const body = getSidebarBodyHtml(kind);
  const script = getSidebarScript(kind);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${codiconStyleText}</style>
    <style>${styles}</style>
  </head>
  <body data-view="${kind}">
    ${body}
    <script nonce="${nonce}">
      ${script}
    </script>
  </body>
</html>`;
}
