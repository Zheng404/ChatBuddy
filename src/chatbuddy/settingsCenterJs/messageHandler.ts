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
          var probeItems = message.payload || [];
          for (var pi = 0; pi < mcpServers.length; pi++) {
            var match = probeItems.find((r) => r.serverId === mcpServers[pi].id);
            if (match) {
              mcpProbeResults[pi] = match;
            }
          }
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
        if (message && message.type === 'backupOperationResult') {
          if (message.payload.message) {
            showToast(message.payload.message, message.payload.success ? 'success' : 'error');
          }
        }
      });
`;
}
