/**
 * Window message handler for the settings center webview.
 * Processes messages from the extension host.
 */
export function getMessageHandlerJs(): string {
  return `
      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message && message.type === 'activateSection') {
          activateSection(message.section, false);
          return;
        }
        if (message && message.type === 'state') {
          syncState(message.payload);
          if (message.payload.notice) {
            const tone = message.payload.noticeTone || 'info';
            if (message.payload.notice !== lastToastNotice) {
              showToast(message.payload.notice, tone);
            }
            lastToastNotice = message.payload.notice;
          } else {
            lastToastNotice = '';
          }
          return;
        }
        if (message && message.type === 'connectionResult') {
          showToast(message.payload.message || '', message.payload.success ? 'success' : 'error');
          renderAll();
          return;
        }
        if (message && message.type === 'modelsFetched') {
          const shouldFocusModalSearch = fetchModelsModalProviderId === message.payload.providerId;
          isFetchingProviderModels = false;
          if (message.payload.success) {
            fetchModelsLastError = '';
            rememberFetchedModels(message.payload.providerId, message.payload.models || []);
          } else {
            fetchModelsLastError = message.payload.message || '';
          }
          showToast(message.payload.message || '', message.payload.success ? 'success' : 'error');
          renderAll();
          if (shouldFocusModalSearch && dom.fetchModelsModal.classList.contains('visible')) {
            dom.fetchModelsModalSearch.focus();
          }
          return;
        }
        if (message && message.type === 'mcpProbeResult') {
          var payload = message.payload || {};
          var probeItems = (payload.results) || [];
          for (var pi = 0; pi < mcpServers.length; pi++) {
            var match = probeItems.find((r) => r.serverId === mcpServers[pi].id);
            if (match) {
              mcpProbeResults[pi] = match;
            }
          }
          if (typeof payload.lastProbeAt === 'number') {
            runtimeState.mcpLastProbeAt = payload.lastProbeAt;
          }
          renderMcpGroups();
          renderMcpServerList();
        }
        if (message && message.type === 'backupDirSelected') {
          dom.backupDirInput.value = message.payload.dir || '';
          autoSaveBackupSettings();
        }
        if (message && message.type === 'backupList') {
          runtimeState.backupFiles = message.payload.items || [];
          renderBackupList();
        }
        if (message && message.type === 'backupPasswordStatus') {
          runtimeState.hasBackupPassword = !!(message.payload && message.payload.hasPassword);
          renderBackupEncryptionSection();
        }
        if (message && message.type === 'backupOperationResult') {
          if (message.payload.message) {
            showToast(message.payload.message, message.payload.success ? 'success' : 'error');
          }
        }
        if (message && message.type === 'mcpGroupAdded') {
          if (message.payload && message.payload.name && message.payload.name.trim()) {
            var id = 'mcpg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
            mcpGroups.push({ id: id, name: message.payload.name.trim(), enabled: true });
            renderMcpGroups();
            renderMcpServerList();
            autoSaveMcpGroups();
          }
        }
        if (message && message.type === 'mcpGroupDeleted') {
          if (message.payload && message.payload.groupId) {
            doDeleteMcpGroup(message.payload.groupId);
          }
        }
        if (message && message.type === 'storageMigrationPrompt') {
          showStorageMigrationPrompt(message.payload.targetMode);
        }
        if (message && message.type === 'storageSwitchResult') {
          if (message.payload.success && message.payload.restartNeeded) {
            var strings = runtimeState.strings || {};
            showToast(strings.dataStorageStatusRestart || 'Configuration saved. Restart IDE to apply.', 'success');
            currentStorageMode = (document.querySelector('input[name="storageMode"]:checked') || {}).value || currentStorageMode;
          } else if (!message.payload.success) {
            showToast(message.payload.reason || runtimeState.strings.dataStorageMigrateFailed || 'Operation failed.', 'error');
            renderDataSyncValues();
          }
          pendingStorageMode = null;
          var section = document.getElementById('dataStorageMigrationSection');
          if (section) { section.style.display = 'none'; }
        }
      });
`;
}
