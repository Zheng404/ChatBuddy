/**
 * State synchronization and full re-render function for the settings center webview.
 */
export function getStateSyncJs(): string {
  return `
      function syncState(nextState) {
        const previousSignature = providersCollectionSignature(Object.values(persistedProvidersById));
        const nextSignature = providersCollectionSignature((nextState.settings && nextState.settings.providers) || []);
        var previousMcpSignature = mcpServersSignature(mcpServers) + '|' + mcpGroupsSignature(mcpGroups);
        var nextMcpSignature = mcpServersSignature((nextState.settings && nextState.settings.mcp && nextState.settings.mcp.servers) || []) + '|' + mcpGroupsSignature((nextState.settings && nextState.settings.mcp && nextState.settings.mcp.groups) || []);
        runtimeState = nextState;
        // 从 settings.localBackup.password 推断密码状态（作为 backupPasswordStatus 的安全网）
        var backupPw = runtimeState.settings && runtimeState.settings.localBackup && runtimeState.settings.localBackup.password;
        if (backupPw) {
          runtimeState.hasBackupPassword = true;
        }
        if (previousSignature !== nextSignature || Object.keys(persistedProvidersById).length === 0) {
          syncProvidersFromState(nextState);
        } else {
          persistedProvidersById = createPersistedProviderMap((nextState.settings && nextState.settings.providers) || []);
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
        renderManualBackupSection();
        renderBackupEncryptionSection();
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
