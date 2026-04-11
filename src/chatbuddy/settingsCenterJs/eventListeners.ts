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
        }
        renderAll();
      });

      dom.addProviderBtn.addEventListener('click', () => {
        void addProvider();
      });

      dom.deleteProviderBtn.addEventListener('click', () => {
        void deleteProvider();
      });

      dom.providerName.addEventListener('input', () => {
        updateEditingProvider((provider) => {
          provider.name = dom.providerName.value;
        });
        renderAll();
      });

      dom.apiType.addEventListener('change', () => {
        updateEditingProvider((provider) => {
          provider.apiType = dom.apiType.value === 'responses' ? 'responses' : 'chat_completions';
        });
        renderAll();
      });

      dom.apiKey.addEventListener('input', () => {
        updateEditingProvider((provider) => {
          provider.apiKey = dom.apiKey.value;
        });
        renderAll();
      });

      dom.baseUrl.addEventListener('input', () => {
        updateEditingProvider((provider) => {
          provider.baseUrl = dom.baseUrl.value;
        });
        renderAll();
      });

      dom.testConnectionBtn.addEventListener('click', () => {
        openTestModelModal();
      });

      dom.fetchModelsBtn.addEventListener('click', () => {
        const provider = getEditingProvider();
        if (!provider) {
          return;
        }
        vscode.postMessage({
          type: 'fetchModels',
          payload: provider
        });
      });

      dom.modelsList.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
          return;
        }
        const modelId = target.getAttribute('data-model-id');
        if (!modelId) {
          return;
        }
        updateEditingProvider((provider) => {
          const bucket = ensureFetchedModels(provider);
          if (target.checked) {
            provider.models = mergeModels([...(provider.models || []), ...bucket.filter((model) => model.id === modelId)]);
          } else {
            provider.models = (provider.models || []).filter((model) => model.id !== modelId);
          }
          normalizeTestModelForProvider(provider);
        });
        renderAll();
      });

      dom.modelsList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.classList.contains('cap-pill')) {
          return;
        }
        const modelId = target.getAttribute('data-model-id');
        const capKey = target.getAttribute('data-cap');
        if (!modelId || !capKey) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        updateEditingProvider((provider) => {
          const bucket = ensureFetchedModels(provider);
          const model = bucket.find((item) => item.id === modelId);
          if (!model) {
            return;
          }
          if (!model.capabilities) {
            model.capabilities = {};
          }
          model.capabilities[capKey] = !model.capabilities[capKey];
          const selected = (provider.models || []).find((item) => item.id === modelId);
          if (selected) {
            if (!selected.capabilities) {
              selected.capabilities = {};
            }
            selected.capabilities[capKey] = model.capabilities[capKey];
          }
        });
        renderAll();
      });

      dom.saveProviderBtn.addEventListener('click', () => {
        const provider = getEditingProvider();
        const validationMessage = validateProvider(provider);
        if (validationMessage) {
          showToast(validationMessage, 'error');
          renderAll();
          return;
        }
        vscode.postMessage({
          type: 'saveProvider',
          payload: {
            provider
          }
        });
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
