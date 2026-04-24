/**
 * Modal event listeners (fetch models, manual model, test model, discard changes, title summary).
 */
export function getModalsJs(defaultTitleSummaryPrompt: string): string {
  const escapedPrompt = JSON.stringify(defaultTitleSummaryPrompt);
  return `
      // Fetch models modal
      dom.fetchModelsModalSearch.addEventListener('input', () => {
        fetchModelsSearchKeyword = dom.fetchModelsModalSearch.value || '';
        renderFetchModelsModal();
      });

      if (dom.retryFetchModelsBtn) {
        dom.retryFetchModelsBtn.addEventListener('click', () => {
          var provider = getProviderById(fetchModelsModalProviderId);
          if (!provider) { return; }
          fetchModelsLastError = '';
          isFetchingProviderModels = true;
          renderFetchModelsModal();
          vscode.postMessage({ type: 'fetchModels', payload: provider });
        });
      }

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

      // Manual model modal
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

      // Test model modal
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

      // Discard changes modal
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

      // Default models and title summary prompt
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

      // Add provider template modal
      dom.providerTemplateGrid.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) { return; }
        const card = target.closest('.provider-template-card');
        if (!card) { return; }
        selectProviderTemplate(card.getAttribute('data-template-key') || '');
      });

      dom.providerTemplateGrid.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') { return; }
        const target = event.target;
        if (!(target instanceof HTMLElement)) { return; }
        const card = target.closest('.provider-template-card');
        if (!card) { return; }
        event.preventDefault();
        selectProviderTemplate(card.getAttribute('data-template-key') || '');
      });

      dom.cancelAddProviderBtn.addEventListener('click', () => {
        closeAddProviderModal();
      });

      dom.addProviderModal.addEventListener('click', (event) => {
        if (event.target === dom.addProviderModal) {
          closeAddProviderModal();
        }
      });

      // Global Escape key handler
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && dom.addProviderModal.classList.contains('visible')) {
          closeAddProviderModal();
          return;
        }
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

      // Unsaved changes warning
      window.addEventListener('beforeunload', (event) => {
        if (dirtyProviderIds.size === 0) {
          return;
        }
        const warning = (runtimeState.strings && runtimeState.strings.providerUnsavedConfirm) || '';
        event.preventDefault();
        event.returnValue = warning;
      });
`;
}
