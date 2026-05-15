import { getSharedJs, getSharedUtilsJs } from './shared';
import { getGeneralJs } from './general';
import { getDataManagementJs } from './dataManagement';
import { getTemplatesJs } from './templates';
import { getDataSyncJs } from './dataSync';
import { getDefaultModelsJs } from './defaultModels';
import { getModelConfigJs } from './modelConfig';
import { getModelConfigStateJs } from './modelConfigState';
import { getModelConfigActionsJs } from './modelConfigActions';
import { getModelConfigRenderersJs } from './modelConfigRenderers';
import { getModelConfigProviderRendererJs } from './modelConfigProviderRenderer';
import { getModelConfigModelsRendererJs } from './modelConfigModelsRenderer';
import { getModelConfigModalsJs } from './modelConfigModals';
import { getMcpJs } from './mcp';
import { getMcpModalJs } from './mcpModal';
import { getNoticeJs } from './notice';
import { getAboutJs } from './about';
import { getStateSyncJs } from './stateSync';
import { getMessageHandlerJs } from './messageHandler';
import { getEventListenersJs } from './eventListeners';

/**
 * Composes all JS fragments into a single webview script block.
 * Order matters: shared vars → utils → modelConfig state/actions → sections → renderers → modals → state → handlers → events → ready signal.
 */
export function getSettingsCenterJs(toastScript: string, defaultTitleSummaryPrompt: string): string {
  return [
    getSharedJs(),
    getSharedUtilsJs(toastScript),
    getModelConfigStateJs(),
    getModelConfigActionsJs(),
    getGeneralJs(),
    getDataManagementJs(),
    getTemplatesJs(),
    getDataSyncJs(),
    getDefaultModelsJs(defaultTitleSummaryPrompt),
    getModelConfigJs(),
    getModelConfigRenderersJs(),
    getModelConfigProviderRendererJs(),
    getModelConfigModelsRendererJs(),
    getModelConfigModalsJs(),
    getMcpJs(),
    getMcpModalJs(),
    getNoticeJs(),
    getAboutJs(),
    getStateSyncJs(),
    getMessageHandlerJs(),
    getEventListenersJs(defaultTitleSummaryPrompt)
  ].join('\n');
}
