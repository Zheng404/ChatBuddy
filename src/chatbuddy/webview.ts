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
  const mermaidEsmUri = nodeModulesUri('mermaid/dist/mermaid.esm.min.mjs');

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
    <script nonce="${nonce}">
      // Polyfill for DOMMatrix / WebKitCSSMatrix (required by Mermaid in some VS Code/Electron versions)
      if (typeof DOMMatrix === 'undefined' && typeof WebKitCSSMatrix === 'undefined') {
        window.DOMMatrix = function DOMMatrix(init) {
          this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
          this.m11 = 1; this.m12 = 0; this.m13 = 0; this.m14 = 0;
          this.m21 = 0; this.m22 = 1; this.m23 = 0; this.m24 = 0;
          this.m31 = 0; this.m32 = 0; this.m33 = 1; this.m34 = 0;
          this.m41 = 0; this.m42 = 0; this.m43 = 0; this.m44 = 1;
        };
      }
    </script>
    <script type="module" nonce="${nonce}">
      import mermaid from '${mermaidEsmUri}';
      mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
      window.mermaid = mermaid;
    </script>
    ${getChatScript({ nonce })}
  </body>
</html>`;
}
