/**
 * General settings event listeners.
 */
export function getGeneralJs(): string {
  return `
      // General settings
      dom.locale.addEventListener('change', () => {
        vscode.postMessage({ type: 'saveLocale', payload: { locale: dom.locale.value } });
      });
      dom.sendShortcut.addEventListener('change', () => {
        vscode.postMessage({ type: 'saveSendShortcut', payload: { sendShortcut: dom.sendShortcut.value } });
      });
      dom.chatTabMode.addEventListener('change', () => {
        vscode.postMessage({ type: 'saveChatTabMode', payload: { chatTabMode: dom.chatTabMode.value === 'multi' ? 'multi' : 'single' } });
      });
      dom.timeout.addEventListener('change', () => {
        const parsed = parseInt(dom.timeout.value, 10);
        vscode.postMessage({ type: 'saveTimeout', payload: { timeoutMs: Number.isNaN(parsed) ? 0 : parsed } });
      });
`;
}
