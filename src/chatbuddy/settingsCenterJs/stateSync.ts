/**
 * State synchronization and full re-render function for the settings center webview.
 */
export function getStateSyncJs(): string {
  return `
      function syncState(nextState) {
        const previousSignature = providersCollectionSignature(Object.values(persistedProvidersById));
        const nextSignature = providersCollectionSignature((nextState.settings && nextState.settings.providers) || []);
        var previousMcpSignature = mcpServersSignature(mcpServers);
        var nextMcpSignature = mcpServersSignature((nextState.settings && nextState.settings.mcp && nextState.settings.mcp.servers) || []);
        runtimeState = nextState;
        if (previousSignature !== nextSignature || Object.keys(persistedProvidersById).length === 0) {
          syncProvidersFromState(nextState);
        } else {
          persistedProvidersById = createPersistedProviderMap((nextState.settings && nextState.settings.providers) || []);
        }
        if (previousMcpSignature !== nextMcpSignature || !mcpServers.length) {
          syncMcpServersFromState(nextState);
        }
        activeSection = normalizeSectionValue(nextState.activeSection || activeSection);
        renderAll();
      }

      function renderAll() {
        renderNav();
        renderSectionVisibility();
        renderGeneralText();
        renderDataManagementText();
        renderGeneralValues();
        renderDefaultModels();
        renderModelConfigText();
        renderEditorTabs();
        renderEditorTabVisibility();
        renderDataTabs();
        renderDataTabVisibility();
        renderLocalBackupSettings();
        renderManualBackupSection();
        renderBackupList();
        ensureProviderEditorId();
        renderProviderList();
        renderProviderFields();
        renderModels();
        renderMcp();
        renderNotice();
        renderAbout();
        if (typeof refreshWorkspaceLayout === 'function') refreshWorkspaceLayout();
      }
`;
}
