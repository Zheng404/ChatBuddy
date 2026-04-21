/**
 * DOM event listener bindings for the settings center webview.
 */
export function getEventListenersJs(defaultTitleSummaryPrompt: string): string {
  const escapedPrompt = JSON.stringify(defaultTitleSummaryPrompt);
  return `
      dom.navModelConfig.addEventListener('click', () => {
        activateSection('modelConfig', true);
      });
      dom.navDefaultModels.addEventListener('click', () => {
        activateSection('defaultModels', true);
      });
      dom.navGeneral.addEventListener('click', () => {
        activateSection('general', true);
      });
      dom.navMcp.addEventListener('click', () => {
        activateSection('mcp', true);
      });
      dom.navNotice.addEventListener('click', () => {
        activateSection('notice', true);
      });

      // Editor sub-tabs (provider config / models)
      dom.editorTabConfig.addEventListener('click', () => {
        switchEditorTab('config');
      });
      dom.editorTabModels.addEventListener('click', () => {
        switchEditorTab('models');
      });

      // Tab scroll arrows
      (function() {
        var tabs = document.getElementById('settingsTabs');
        var arrowL = document.getElementById('tabArrowLeft');
        var arrowR = document.getElementById('tabArrowRight');
        if (!tabs || !arrowL || !arrowR) return;

        function update() {
          var hasOverflow = tabs.scrollWidth > tabs.clientWidth + 2;
          arrowL.classList.toggle('visible', hasOverflow && tabs.scrollLeft > 2);
          arrowR.classList.toggle('visible', hasOverflow && tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 2);
        }

        arrowL.addEventListener('click', function() {
          tabs.scrollBy({ left: -120 });
          setTimeout(update, 200);
        });
        arrowR.addEventListener('click', function() {
          tabs.scrollBy({ left: 120 });
          setTimeout(update, 200);
        });
        tabs.addEventListener('scroll', update);
        window.addEventListener('resize', update);
        setTimeout(update, 100);
        setTimeout(update, 500);
        if (typeof ResizeObserver !== 'undefined') {
          new ResizeObserver(update).observe(tabs);
        }
      })();

      // Provider workspace responsive layout
      var refreshWorkspaceLayout;
      (function() {
        refreshWorkspaceLayout = function() {
          var ws = document.querySelector('.provider-workspace');
          if (!ws) return;
          ws.classList.toggle('stacked', ws.clientWidth < 600);
        };
        window.addEventListener('resize', refreshWorkspaceLayout);
        setTimeout(refreshWorkspaceLayout, 100);
        if (typeof ResizeObserver !== 'undefined') {
          var ws = document.querySelector('.provider-workspace');
          if (ws) new ResizeObserver(refreshWorkspaceLayout).observe(ws);
        }
      })();

      dom.locale.addEventListener('change', () => {
        vscode.postMessage({ type: 'saveLocale', payload: { locale: dom.locale.value } });
      });
      dom.sendShortcut.addEventListener('change', () => {
        vscode.postMessage({ type: 'saveSendShortcut', payload: { sendShortcut: dom.sendShortcut.value } });
      });
      dom.chatTabMode.addEventListener('change', () => {
        vscode.postMessage({ type: 'saveChatTabMode', payload: { chatTabMode: dom.chatTabMode.value === 'multi' ? 'multi' : 'single' } });
      });

      dom.exportBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'exportData' });
      });

      dom.importBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'importData' });
      });

      dom.resetBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'reset' });
      });

      // MCP event bindings
      dom.mcpSaveToolRoundsBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'saveMcpToolRounds',
          payload: { maxToolRounds: parseInt(dom.mcpMaxToolRounds.value, 10) || 5 }
        });
      });

      dom.mcpAddServerBtn.addEventListener('click', () => {
        openMcpServerModal('add', -1);
      });

      dom.mcpServerList.addEventListener('click', (event) => {
        var target = event.target;
        if (!(target instanceof HTMLElement)) { return; }
        var card = target.closest('.mcp-server-card');
        if (!card) { return; }
        var idx = parseInt(card.getAttribute('data-idx'), 10);
        if (isNaN(idx) || idx < 0 || idx >= mcpServers.length) { return; }
        var action = target.getAttribute('data-mcp-action');
        if (action === 'test') {
          if (!mcpServers[idx].enabled) { return; }
          vscode.postMessage({
            type: 'testMcpServer',
            payload: { server: mcpServers[idx] }
          });
          return;
        }
        if (action === 'toggle-tools') {
          var probe = mcpProbeResults[idx];
          if (probe && probe.success) {
            expandedToolServerIdx = expandedToolServerIdx === idx ? -1 : idx;
            renderMcpServerList();
          }
          return;
        }
        if (action === 'edit') {
          openMcpServerModal('edit', idx);
          return;
        }
        if (action === 'delete') {
          var server = mcpServers[idx];
          if (!server) { return; }
          vscode.postMessage({
            type: 'deleteMcpServer',
            payload: {
              serverId: server.id,
              serverName: server.name
            }
          });
          return;
        }
      });

      dom.mcpServerList.addEventListener('change', (event) => {
        var target = event.target;
        if (!(target instanceof HTMLInputElement)) { return; }
        var toggleIdx = target.getAttribute('data-mcp-toggle-idx');
        if (toggleIdx === null || toggleIdx === undefined) { return; }
        var idx = parseInt(toggleIdx, 10);
        if (isNaN(idx) || idx < 0 || idx >= mcpServers.length) { return; }
        mcpServers[idx].enabled = target.checked;
        renderMcpServerList();
        autoSaveMcpServers();
      });

      dom.mcpModalTransport.addEventListener('change', () => {
        if (mcpModalDraft) {
          mcpModalDraft.transport = dom.mcpModalTransport.value || 'stdio';
          renderMcpModalFields();
        }
      });

      dom.mcpModalCancelBtn.addEventListener('click', () => {
        closeMcpServerModal();
      });

      dom.mcpModalSaveBtn.addEventListener('click', () => {
        confirmMcpServer();
      });

      dom.mcpServerModal.addEventListener('click', (event) => {
        if (event.target === dom.mcpServerModal) {
          closeMcpServerModal();
        }
      });

      dom.defaultAssistantModel.addEventListener('change', () => {
        vscode.postMessage({ type: 'saveDefaultAssistant', payload: { assistant: dom.defaultAssistantModel.value } });
      });

      dom.defaultTitleSummaryModel.addEventListener('change', () => {
        vscode.postMessage({ type: 'saveDefaultTitleSummary', payload: { titleSummary: dom.defaultTitleSummaryModel.value } });
      });

      dom.editTitleSummaryPromptBtn.addEventListener('click', () => {
        openTitleSummaryPromptModal();
      });

      dom.cancelTitleSummaryPromptBtn.addEventListener('click', () => {
        closeTitleSummaryPromptModal();
      });

      dom.resetTitleSummaryPromptBtn.addEventListener('click', () => {
        dom.titleSummaryPromptModalTextarea.value = ${escapedPrompt};
      });

      dom.saveTitleSummaryPromptBtn.addEventListener('click', () => {
        const value = dom.titleSummaryPromptModalTextarea.value;
        closeTitleSummaryPromptModal();
        vscode.postMessage({ type: 'saveTitleSummaryPrompt', payload: { titleSummaryPrompt: value } });
      });

      dom.titleSummaryPromptModal.addEventListener('click', (event) => {
        if (event.target === dom.titleSummaryPromptModal) {
          closeTitleSummaryPromptModal();
        }
      });

      var providerSearchTimer = undefined;
      dom.providerSearch.addEventListener('input', () => {
        searchKeyword = dom.providerSearch.value;
        if (providerSearchTimer) { clearTimeout(providerSearchTimer); }
        providerSearchTimer = setTimeout(function() {
          providerSearchTimer = undefined;
          renderProviderList();
        }, 200);
      });

      dom.providerList.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const trigger = target.closest('.provider-item-main');
        const nextId = trigger ? trigger.getAttribute('data-id') : '';
        if (!nextId || nextId === providerEditorId) {
          return;
        }
        if (!(await confirmDiscardCurrentProviderChanges())) {
          return;
        }
        providerEditorId = nextId;
        renderAll();
      });

      dom.providerList.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
          return;
        }
        const providerId = target.getAttribute('data-toggle-id');
        if (!providerId) {
          return;
        }
        const provider = providers.find((item) => item.id === providerId);
        if (!provider) {
          return;
        }
        provider.enabled = target.checked;
        if (persistedProvidersById[provider.id]) {
          persistedProvidersById[provider.id].enabled = provider.enabled;
          reconcileProviderDirty(provider.id);
          vscode.postMessage({
            type: 'toggleProviderEnabled',
            payload: {
              providerId: provider.id,
              enabled: provider.enabled
            }
          });
        } else {
          reconcileProviderDirty(provider.id);
          scheduleProviderAutosave(provider.id, 0);
        }
        renderAll();
      });

      dom.addProviderBtn.addEventListener('click', () => {
        void addProvider();
      });

      dom.deleteProviderBtn.addEventListener('click', () => {
        void deleteProvider();
      });

      dom.providerEnabledCheckbox.addEventListener('change', () => {
        const provider = getEditingProvider();
        if (!provider) return;
        provider.enabled = dom.providerEnabledCheckbox.checked;
        if (persistedProvidersById[provider.id]) {
          persistedProvidersById[provider.id].enabled = provider.enabled;
          reconcileProviderDirty(provider.id);
          vscode.postMessage({
            type: 'toggleProviderEnabled',
            payload: { providerId: provider.id, enabled: provider.enabled }
          });
        } else {
          reconcileProviderDirty(provider.id);
          scheduleProviderAutosave(provider.id, 0);
        }
        renderAll();
      });

      dom.providerName.addEventListener('input', () => {
        updateEditingProvider((provider) => {
          provider.name = dom.providerName.value;
        });
        dom.providerPanelTitle.textContent = dom.providerName.value || runtimeState.strings.providerDraftName || '';
        scheduleProviderAutosave(providerEditorId, 450);
        renderAll();
      });

      document.getElementById('toggleApiKeyVisibility').addEventListener('click', function() {
        var input = document.getElementById('apiKey');
        var icon = this.querySelector('.codicon');
        if (input.type === 'password') {
          input.type = 'text';
          icon.className = 'codicon codicon-eye-closed';
        } else {
          input.type = 'password';
          icon.className = 'codicon codicon-eye';
        }
      });

      dom.apiType.addEventListener('change', () => {
        updateEditingProvider((provider) => {
          provider.apiType = dom.apiType.value === 'responses' ? 'responses' : 'chat_completions';
        });
        scheduleProviderAutosave(providerEditorId, 250);
        renderAll();
      });

      dom.apiKey.addEventListener('input', () => {
        updateEditingProvider((provider) => {
          provider.apiKey = dom.apiKey.value;
        });
        scheduleProviderAutosave(providerEditorId, 450);
        renderAll();
      });

      dom.baseUrl.addEventListener('input', () => {
        updateEditingProvider((provider) => {
          provider.baseUrl = dom.baseUrl.value;
        });
        scheduleProviderAutosave(providerEditorId, 450);
        renderAll();
      });

      dom.testConnectionBtn.addEventListener('click', () => {
        openTestModelModal();
      });

      dom.addManualModelBtn.addEventListener('click', () => {
        openManualModelModal('create');
      });

      dom.fetchModelsBtn.addEventListener('click', () => {
        const provider = getEditingProvider();
        if (!provider) {
          return;
        }
        isFetchingProviderModels = true;
        openFetchModelsModal(provider.id);
        renderAll();
        vscode.postMessage({
          type: 'fetchModels',
          payload: provider
        });
      });

      dom.manualModelsList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const actionTarget = target.closest('[data-model-action]');
        if (!(actionTarget instanceof HTMLElement)) {
          return;
        }
        const action = actionTarget.getAttribute('data-model-action');
        const modelId = actionTarget.getAttribute('data-model-id');
        const provider = getEditingProvider();
        if (!provider || !action || !modelId) {
          return;
        }
        if (action === 'edit') {
          openManualModelModal('edit', modelId);
          return;
        }
        if (action === 'delete') {
          removeProviderModel(provider.id, modelId);
        }
        renderAll();
      });

      dom.fetchedModelsList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const actionTarget = target.closest('[data-model-action]');
        if (!(actionTarget instanceof HTMLElement)) {
          return;
        }
        const action = actionTarget.getAttribute('data-model-action');
        const modelId = actionTarget.getAttribute('data-model-id');
        const provider = getEditingProvider();
        if (!provider || !action || !modelId) {
          return;
        }
        if (action === 'edit') {
          openManualModelModal('edit', modelId);
          return;
        }
        if (action === 'delete') {
          removeProviderModel(provider.id, modelId);
        }
        renderAll();
      });

      dom.fetchModelsModalSearch.addEventListener('input', () => {
        fetchModelsSearchKeyword = dom.fetchModelsModalSearch.value || '';
        renderFetchModelsModal();
      });

      dom.fetchModelsModalList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const trigger = target.closest('[data-fetch-model-id]');
        if (!(trigger instanceof HTMLElement)) {
          return;
        }
        const modelId = trigger.getAttribute('data-fetch-model-id');
        if (!fetchModelsModalProviderId || !modelId) {
          return;
        }
        addFetchedModelToProvider(fetchModelsModalProviderId, modelId);
        renderAll();
      });

      dom.closeFetchModelsModalBtn.addEventListener('click', () => {
        closeFetchModelsModal();
      });

      dom.fetchModelsModal.addEventListener('click', (event) => {
        if (event.target === dom.fetchModelsModal) {
          closeFetchModelsModal();
        }
      });

      dom.manualModelId.addEventListener('input', () => {
        if (!manualModelModalState) {
          return;
        }
        manualModelModalState.draft.id = dom.manualModelId.value;
      });

      dom.manualModelName.addEventListener('input', () => {
        if (!manualModelModalState) {
          return;
        }
        manualModelModalState.draft.name = dom.manualModelName.value;
      });

      dom.manualModelKind.addEventListener('change', () => {
        if (!manualModelModalState) {
          return;
        }
        manualModelModalState.draft.kind = dom.manualModelKind.value || 'chat';
      });

      dom.manualModelCapabilities.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || !manualModelModalState) {
          return;
        }
        const capKey = target.getAttribute('data-cap');
        if (!capKey) {
          return;
        }
        if (!manualModelModalState.draft.capabilities) {
          manualModelModalState.draft.capabilities = {};
        }
        if (target.checked) {
          manualModelModalState.draft.capabilities[capKey] = true;
        } else {
          delete manualModelModalState.draft.capabilities[capKey];
        }
        if (Object.keys(manualModelModalState.draft.capabilities).length === 0) {
          manualModelModalState.draft.capabilities = undefined;
        }
      });

      dom.cancelManualModelBtn.addEventListener('click', () => {
        closeManualModelModal();
      });

      dom.saveManualModelBtn.addEventListener('click', () => {
        saveManualModel();
      });

      dom.manualModelModal.addEventListener('click', (event) => {
        if (event.target === dom.manualModelModal) {
          closeManualModelModal();
        }
      });

      dom.saveProviderBtn.addEventListener('click', () => {
        const provider = getEditingProvider();
        if (!provider) {
          return;
        }
        if (!persistProviderDraft(provider.id, false)) {
          showToast(validateProvider(provider), 'error');
          renderAll();
        }
      });

      dom.cancelTestModelBtn.addEventListener('click', () => {
        closeTestModelModal();
      });

      dom.confirmTestModelBtn.addEventListener('click', () => {
        confirmTestModelSelection();
      });

      dom.testModelModal.addEventListener('click', (event) => {
        if (event.target === dom.testModelModal) {
          closeTestModelModal();
        }
      });

      dom.discardChangesStayBtn.addEventListener('click', () => {
        closeDiscardChangesModal(false);
      });

      dom.discardChangesConfirmBtn.addEventListener('click', () => {
        closeDiscardChangesModal(true);
      });

      dom.discardChangesModal.addEventListener('click', (event) => {
        if (event.target === dom.discardChangesModal) {
          closeDiscardChangesModal(false);
        }
      });

      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && dom.titleSummaryPromptModal.classList.contains('visible')) {
          closeTitleSummaryPromptModal();
          return;
        }
        if (event.key === 'Escape' && dom.manualModelModal.classList.contains('visible')) {
          closeManualModelModal();
          return;
        }
        if (event.key === 'Escape' && dom.fetchModelsModal.classList.contains('visible')) {
          closeFetchModelsModal();
          return;
        }
        if (event.key === 'Escape' && dom.testModelModal.classList.contains('visible')) {
          closeTestModelModal();
          return;
        }
        if (event.key === 'Escape' && dom.discardChangesModal.classList.contains('visible')) {
          closeDiscardChangesModal(false);
        }
      });

      window.addEventListener('beforeunload', (event) => {
        if (dirtyProviderIds.size === 0) {
          return;
        }
        const warning = (runtimeState.strings && runtimeState.strings.providerUnsavedConfirm) || '';
        event.preventDefault();
        event.returnValue = warning;
      });

      vscode.postMessage({ type: 'ready' });
`;
}
