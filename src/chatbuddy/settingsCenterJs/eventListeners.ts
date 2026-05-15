/**
 * DOM event listener bindings for the settings center webview.
 * Splits responsibilities into focused sub-modules.
 */
import { getNavJs } from './eventListeners/nav';
import { getLayoutJs } from './eventListeners/layout';
import { getGeneralJs } from './eventListeners/general';
import { getDataManagementJs } from './eventListeners/dataManagement';
import { getTemplatesListenersJs } from './eventListeners/templates';
import { getDataSyncListenersJs } from './eventListeners/dataSync';
import { getMcpJs } from './eventListeners/mcp';
import { getProviderEditorJs } from './eventListeners/providerEditor';
import { getModelManagerJs } from './eventListeners/modelManager';
import { getModalsJs } from './eventListeners/modals';

export function getEventListenersJs(defaultTitleSummaryPrompt: string): string {
  return [
    getNavJs(),
    getLayoutJs(),
    getGeneralJs(),
    getDataManagementJs(),
    getTemplatesListenersJs(),
    getDataSyncListenersJs(),
    getMcpJs(),
    getProviderEditorJs(),
    getModelManagerJs(),
    getModalsJs(defaultTitleSummaryPrompt),
    `vscode.postMessage({ type: 'ready' });`
  ].join('\n');
}
