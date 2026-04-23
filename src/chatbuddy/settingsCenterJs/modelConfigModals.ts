/**
 * Provider/model config modal management for the settings center webview.
 * Handles open/close/save for all modelConfig-related modals.
 */
export function getModelConfigModalsJs(): string {
  return `
      function closeDiscardChangesModal(confirmed) {
        closeModal(dom.discardChangesModal);
        if (discardModalResolver) {
          const resolve = discardModalResolver;
          discardModalResolver = null;
          resolve(!!confirmed);
        }
      }

      function openDiscardChangesModal() {
        if (discardModalResolver) {
          return Promise.resolve(false);
        }
        openModal(dom.discardChangesModal, dom.discardChangesConfirmBtn);
        return new Promise((resolve) => {
          discardModalResolver = resolve;
        });
      }

      async function confirmDiscardCurrentProviderChanges() {
        const providerId = providerEditorId;
        if (!isProviderDirty(providerId)) {
          return true;
        }
        if (flushProviderAutosave(providerId)) {
          return true;
        }
        const confirmed = await openDiscardChangesModal();
        if (!confirmed) {
          return false;
        }
        discardProviderChanges(providerId);
        return true;
      }

      function closeTestModelModal() {
        testModelModalProviderId = '';
        closeModal(dom.testModelModal);
      }

      function openTestModelModal() {
        const provider = getEditingProvider();
        if (!provider) {
          return;
        }
        const selectedModels = provider.models || [];
        if (!selectedModels.length) {
          showToast(runtimeState.strings.providerTestModelRequired || '', 'error');
          renderAll();
          return;
        }
        const current = normalizeTestModelForProvider(provider);
        dom.testModelModalSelect.innerHTML = selectedModels
          .map((model) => {
            return '<option value="' + escapeHtml(model.id) + '">' + escapeHtml(model.name || model.id) + '</option>';
          })
          .join('');
        dom.testModelModalSelect.value = current;
        testModelModalProviderId = provider.id;
        openModal(dom.testModelModal, dom.testModelModalSelect);
      }

      function confirmTestModelSelection() {
        const provider = providers.find((item) => item.id === testModelModalProviderId);
        if (!provider) {
          closeTestModelModal();
          return;
        }
        const modelId = String(dom.testModelModalSelect.value || '').trim();
        if (!modelId) {
          closeTestModelModal();
          showToast(runtimeState.strings.providerTestModelRequired || '', 'error');
          renderAll();
          return;
        }
        testModelByProviderId[provider.id] = modelId;
        closeTestModelModal();
        vscode.postMessage({
          type: 'testConnection',
          payload: {
            provider,
            modelId
          }
        });
      }

      function openFetchModelsModal(providerId) {
        const provider = getProviderById(providerId);
        if (!provider) {
          return;
        }
        fetchModelsModalProviderId = provider.id;
        fetchModelsSearchKeyword = '';
        renderFetchModelsModal();
        if (isFetchingProviderModels) {
          dom.closeFetchModelsModalBtn.focus();
          return;
        }
        dom.fetchModelsModalSearch.focus();
      }

      function closeFetchModelsModal() {
        fetchModelsModalProviderId = '';
        fetchModelsSearchKeyword = '';
        closeModal(dom.fetchModelsModal);
      }

      function openManualModelModal(mode, modelId) {
        const provider = getEditingProvider();
        if (!provider) {
          return;
        }
        if (mode === 'edit') {
          const allModels = mergeModels(provider && provider.models, 'manual');
          const model = allModels.find((item) => item.id === modelId);
          if (!model) {
            return;
          }
          manualModelModalState = {
            mode: 'edit',
            providerId: provider.id,
            originalModelId: model.id,
            originalSource: model.source,
            draft: {
              id: model.id,
              name: model.name || model.id,
              kind: model.kind || model.userKindOverride || 'chat',
              capabilities: cloneCapabilities(model.capabilities),
              source: model.source
            }
          };
        } else {
          manualModelModalState = {
            mode: 'create',
            providerId: provider.id,
            originalModelId: '',
            draft: {
              id: '',
              name: '',
              kind: undefined,
              capabilities: undefined,
              source: 'manual'
            }
          };
        }
        renderManualModelModal();
        dom.manualModelId.focus();
      }

      function closeManualModelModal() {
        manualModelModalState = null;
        closeModal(dom.manualModelModal);
        dom.manualModelId.readOnly = false;
        dom.manualModelId.classList.remove('readonly');
      }

      function saveManualModel() {
        if (!manualModelModalState) {
          return;
        }
        const provider = getProviderById(manualModelModalState.providerId);
        if (!provider) {
          closeManualModelModal();
          return;
        }
        const isFetched = manualModelModalState.originalSource === 'fetched';
        const nextId = isFetched
          ? manualModelModalState.originalModelId
          : String(dom.manualModelId.value || '').trim();
        const nextName = String(dom.manualModelName.value || '').trim();
        if (!nextId) {
          showToast(runtimeState.strings.manualModelIdRequired || '', 'error');
          dom.manualModelId.focus();
          return;
        }
        if (!isFetched) {
          const duplicated = (provider.models || []).some((model) => {
            if (!model || model.id === manualModelModalState.originalModelId) {
              return false;
            }
            return model.id === nextId;
          });
          if (duplicated) {
            showToast(runtimeState.strings.manualModelIdDuplicated || '', 'error');
            dom.manualModelId.focus();
            return;
          }
        }

        const draftKind = manualModelModalState.draft.kind || undefined;
        const draftCaps = cloneCapabilities(manualModelModalState.draft.capabilities);
        const originalSource = manualModelModalState.originalSource || manualModelModalState.draft.source || 'manual';
        const nextModel = {
          id: nextId,
          name: nextName || nextId,
          kind: draftKind,
          capabilities: draftCaps,
          userKindOverride: draftKind,
          userCapabilitiesOverride: draftCaps,
          source: originalSource
        };

        const previousSelectedTestModel = testModelByProviderId[provider.id];
        provider.models = mergeModels(
          (provider.models || []).filter((model) => model.id !== manualModelModalState.originalModelId).concat([nextModel]),
          'manual'
        );
        if (previousSelectedTestModel && previousSelectedTestModel === manualModelModalState.originalModelId) {
          testModelByProviderId[provider.id] = nextModel.id;
        }
        normalizeTestModelForProvider(provider);
        reconcileProviderDirty(provider.id);
        scheduleProviderAutosave(provider.id, 0, true);
        closeManualModelModal();
        renderAll();
      }
  `;
}
