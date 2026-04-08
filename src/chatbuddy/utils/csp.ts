import * as vscode from 'vscode';

/**
 * 生成32位随机 nonce 字符串，用于 CSP 安全策略
 */
export function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

/**
 * 构建 CSP (Content Security Policy) 字符串
 * @param webview webview 实例
 * @param nonce nonce 字符串
 * @returns CSP 字符串
 */
export function buildCsp(webview: vscode.Webview, nonce: string): string {
  return [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `img-src ${webview.cspSource} https: data:`,
    `media-src ${webview.cspSource} https: data:`,
    'connect-src https:'
  ].join('; ');
}
