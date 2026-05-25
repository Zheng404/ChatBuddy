/**
 * State synchronization and full re-render function for the settings center webview.
 */
export function getStateSyncJs(): string {
  return `
      function syncState(nextState) {
        runtimeState = nextState;
        // 密码状态由 postBackupPasswordStatus 单独推送，不再从 settings 中读取明文密码
        // 在签名比较和所有下游处理之前，过滤掉本地已删除的供应商。
        // 这确保无论 syncState 走哪个分支（syncProvidersFromState 或 else），
        // 已删除供应商都不会被复活。集合在整个会话期间保留，不做清理。
        if (deletedProviderIds.size > 0 && runtimeState.settings && Array.isArray(runtimeState.settings.providers)) {
          runtimeState.settings.providers = runtimeState.settings.providers.filter(function (p) { return !deletedProviderIds.has(p.id); });
        }
        var filteredProviders = (runtimeState.settings && runtimeState.settings.providers) || [];
        const previousSignature = providersCollectionSignature(Object.values(persistedProvidersById));
        const nextSignature = providersCollectionSignature(filteredProviders);
        var previousMcpSignature = mcpServersSignature(mcpServers) + '|' + mcpGroupsSignature(mcpGroups);
        var nextMcpSignature = mcpServersSignature((nextState.settings && nextState.settings.mcp && nextState.settings.mcp.servers) || []) + '|' + mcpGroupsSignature((nextState.settings && nextState.settings.mcp && nextState.settings.mcp.groups) || []);
        if (previousSignature !== nextSignature || Object.keys(persistedProvidersById).length === 0) {
          syncProvidersFromState(runtimeState);
        } else {
          persistedProvidersById = createPersistedProviderMap(filteredProviders);
        }
        if (previousMcpSignature !== nextMcpSignature || !mcpServers.length) {
          syncMcpServersFromState(nextState);
        }
        activeSection = normalizeSectionValue(nextState.activeSection || activeSection);
        if (nextState.syncConfig) {
          currentStorageMode = nextState.syncConfig.storageMode || 'default';
          if (nextState.syncConfig.usingShared) {
            dataStorageStatus = nextState.strings && nextState.strings.dataStorageStatusShared ? nextState.strings.dataStorageStatusShared : 'Using shared storage';
          } else {
            dataStorageStatus = nextState.strings && nextState.strings.dataStorageStatusDefault ? nextState.strings.dataStorageStatusDefault : 'Using default storage';
          }
        }
        renderAll();
      }

      function renderAll() {
        renderNav();
        renderSectionVisibility();
        renderGeneralText();
        renderDataManagementText();
        renderTemplatesText();
        renderDataSyncText();
        renderDataSyncValues();
        renderGeneralValues();
        renderDefaultModels();
        renderModelConfigText();
        renderEditorTabs();
        renderEditorTabVisibility();
        renderDataTabs();
        renderDataTabVisibility();
        renderLocalBackupSettings();
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
