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
export function getChatWebviewHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  const codiconStyleText = getCodiconStyleText();
  const csp = buildCsp(webview, nonce);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ChatBuddy</title>
    <style>${codiconStyleText}</style>
    <style>${getChatPanelCss()}</style>
  </head>
  <body>
    ${getChatBodyHtml()}
    ${getChatScript(nonce)}
  </body>
</html>`;
}
