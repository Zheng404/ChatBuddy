import { getSharedJs, getSharedUtilsJs } from './shared';
import { getGeneralJs } from './general';
import { getDefaultModelsJs } from './defaultModels';
import { getModelConfigJs } from './modelConfig';
import { getMcpJs } from './mcp';
import { getStateSyncJs } from './stateSync';
import { getMessageHandlerJs } from './messageHandler';
import { getEventListenersJs } from './eventListeners';

/**
 * Composes all JS fragments into a single webview script block.
 * Order matters: shared vars → utils → sections → state → handlers → events → ready signal.
 */
export function getSettingsCenterJs(toastScript: string, defaultTitleSummaryPrompt: string): string {
  return [
    getSharedJs(),
    getSharedUtilsJs(toastScript),
    getGeneralJs(),
    getDefaultModelsJs(defaultTitleSummaryPrompt),
    getModelConfigJs(),
    getMcpJs(),
    getStateSyncJs(),
    getMessageHandlerJs(),
    getEventListenersJs(defaultTitleSummaryPrompt)
  ].join('\n');
}
