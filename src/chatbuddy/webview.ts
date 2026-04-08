import * as vscode from 'vscode';
import { getCodiconStyleText } from './codicon';
import { buildCsp, getNonce } from './utils';
import { getChatPanelCss } from './webviewChatStyles';
import { getChatBodyHtml } from './webviewChatHtml';
import { getChatScript } from './webviewChatScript';

/**
 * Assembles and returns the full HTML document for the chat webview panel.
 * Delegates CSS, HTML body, and script to dedicated modules.
 */
export function getChatWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const codiconStyleText = getCodiconStyleText();
  const csp = buildCsp(webview, nonce);

  // Resolve rendering library URIs via webview
  const nodeModulesUri = (subpath: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', subpath));
  const katexCssUri = nodeModulesUri('katex/dist/katex.min.css');
  const katexJsUri = nodeModulesUri('katex/dist/katex.min.js');
  const mermaidJsUri = nodeModulesUri('mermaid/dist/mermaid.min.js');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ChatBuddy</title>
    <link rel="stylesheet" href="${katexCssUri}" />
    <style>${codiconStyleText}</style>
    <style>${getChatPanelCss()}</style>
  </head>
  <body>
    ${getChatBodyHtml()}
    <script nonce="${nonce}" src="${katexJsUri}"></script>
    <script nonce="${nonce}" src="${mermaidJsUri}"></script>
    ${getChatScript(nonce)}
  </body>
</html>`;
}
