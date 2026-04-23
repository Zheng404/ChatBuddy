import { getSharedJs, getSharedUtilsJs } from './shared';
import { getGeneralJs } from './general';
import { getDataManagementJs } from './dataManagement';
import { getDefaultModelsJs } from './defaultModels';
import { getModelConfigJs } from './modelConfig';
import { getModelConfigRenderersJs } from './modelConfigRenderers';
import { getModelConfigModalsJs } from './modelConfigModals';
import { getMcpJs } from './mcp';
import { getNoticeJs } from './notice';
import { getAboutJs } from './about';
import { getStateSyncJs } from './stateSync';
import { getMessageHandlerJs } from './messageHandler';
import { getEventListenersJs } from './eventListeners';

/**
 * Composes all JS fragments into a single webview script block.
 * Order matters: shared vars → utils → sections → renderers → modals → state → handlers → events → ready signal.
 */
export function getSettingsCenterJs(toastScript: string, defaultTitleSummaryPrompt: string): string {
  return [
    getSharedJs(),
    getSharedUtilsJs(toastScript),
    getGeneralJs(),
    getDataManagementJs(),
    getDefaultModelsJs(defaultTitleSummaryPrompt),
    getModelConfigJs(),
    getModelConfigRenderersJs(),
    getModelConfigModalsJs(),
    getMcpJs(),
    getNoticeJs(),
    getAboutJs(),
    getStateSyncJs(),
    getMessageHandlerJs(),
    getEventListenersJs(defaultTitleSummaryPrompt)
  ].join('\n');
}
