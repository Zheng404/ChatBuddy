/**
 * Provider CRUD operations, model management, and state synchronization
 * for the settings center webview.
 */
export function getModelConfigActionsJs(): string {
  return `
      function validateProvider(provider) {
        if (!provider) {
          return runtimeState.strings.selectProviderToEdit || '';
        }
        if (!provider.name.trim()) {
          return runtimeState.strings.providerNameRequired || '';
        }
        return '';
      }

      function createInternalProviderId() {
        return 'provider_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
      }

      async function addProvider(templateKey) {
        if (!(await confirmDiscardCurrentProviderChanges())) {
          return;
        }
        let index = providers.length + 1;
        let nextId = createInternalProviderId();
        while (providers.some((provider) => provider.id === nextId)) {
          index += 1;
          nextId = createInternalProviderId();
        }
        var template = (templateKey && PROVIDER_TEMPLATES[templateKey]) ? PROVIDER_TEMPLATES[templateKey] : null;
        var isCustom = !template;
        var customApiType = (templateKey === 'custom-responses') ? 'responses' : (templateKey === 'custom-gemini') ? 'gemini' : 'chat_completions';
        providers.push({
          id: nextId,
          kind: template ? template.kind : 'custom',
          name: template ? template.name : ((runtimeState.strings.providerDraftName || 'Provider') + ' ' + index),
          apiKey: '',
          baseUrl: template ? template.baseUrl : '',
          apiType: template ? template.apiType : customApiType,
          enabled: true,
          models: [],
          modelLastSyncedAt: undefined
        });
        providerEditorId = nextId;
        resetEditorTab();
        fetchedModelsByProvider[nextId] = [];
        testModelByProviderId[nextId] = '';
        dirtyProviderIds.add(nextId);
        closeFetchModelsModal();
        closeManualModelModal();
        scheduleProviderAutosave(nextId, 0);
        renderAll();
      }

      async function deleteProvider() {
        const provider = getEditingProvider();
        if (!provider) {
          return;
        }
        const providerId = provider.id;
        const providerName = provider.name || runtimeState.strings.providerDraftName || '';
        // 先在 webview 内弹确认框，避免 VS Code 原生弹窗被关闭面板取消
        const confirmed = await openDeleteProviderModal(providerName);
        if (!confirmed) {
          return;
        }
        cancelProviderAutosave(providerId);
        dirtyProviderIds.delete(providerId);
        delete providerSaveStatusById[providerId];
        delete persistedProvidersById[providerId];
        deletedProviderIds.add(providerId);
        providers = providers.filter((item) => item.id !== providerId);
        delete fetchedModelsByProvider[providerId];
        delete testModelByProviderId[providerId];
        providerEditorId = providers[0] ? providers[0].id : '';
        resetEditorTab();
        if (fetchModelsModalProviderId === providerId) {
          closeFetchModelsModal();
        }
        if (manualModelModalState && manualModelModalState.providerId === providerId) {
          closeManualModelModal();
        }
        renderAll();
        vscode.postMessage({
          type: 'deleteProvider',
          payload: {
            providerId,
            providerName,
            skipConfirm: true
          }
        });
      }

      /**
       * 统一处理 Provider 启用/禁用切换。
       * 禁用时先在 webview 内弹 Danger Modal 确认，避免 Host 端 VS Code 原生弹窗。
       * 确认后发送 toggleProviderEnabled 消息（带 skipConfirm=true）。
       * 用户取消时恢复 checkbox 状态。
       */
      async function handleProviderEnabledToggle(provider, checkboxEl) {
        if (!provider) { return; }
        var nextEnabled = !!checkboxEl.checked;
        if (!nextEnabled) {
          var strings = runtimeState.strings || {};
          var message = (strings.confirmDisableProvider || '').replace('{name}', provider.name || provider.id);
          var confirmed = await openDangerModal({
            message: message,
            actionLabel: strings.disableProviderAction || 'Disable',
            cancelLabel: strings.cancelAction || 'Cancel'
          });
          if (!confirmed) {
            checkboxEl.checked = true;
            return;
          }
        }
        provider.enabled = nextEnabled;
        if (persistedProvidersById[provider.id]) {
          persistedProvidersById[provider.id].enabled = provider.enabled;
          reconcileProviderDirty(provider.id);
          vscode.postMessage({
            type: 'toggleProviderEnabled',
            payload: {
              providerId: provider.id,
              enabled: provider.enabled,
              skipConfirm: true
            }
          });
        } else {
          reconcileProviderDirty(provider.id);
          scheduleProviderAutosave(provider.id, 0);
        }
        renderAll();
      }

      function discardProviderChanges(providerId) {
        if (!providerId) {
          return;
        }
        cancelProviderAutosave(providerId);
        delete providerSaveStatusById[providerId];
        const persisted = persistedProvidersById[providerId];
        if (!persisted) {
          providers = providers.filter((provider) => provider.id !== providerId);
          delete fetchedModelsByProvider[providerId];
          delete testModelByProviderId[providerId];
          dirtyProviderIds.delete(providerId);
          if (providerEditorId === providerId) {
            providerEditorId = providers[0] ? providers[0].id : '';
          }
        } else {
          providers = providers.map((provider) => (provider.id === providerId ? cloneProvider(persisted) : provider));
          dirtyProviderIds.delete(providerId);
          normalizeTestModelForProvider(getProviderById(providerId));
        }

        if (fetchModelsModalProviderId === providerId && !getProviderById(providerId)) {
          closeFetchModelsModal();
        }
        if (
          manualModelModalState &&
          manualModelModalState.providerId === providerId &&
          !getProviderById(providerId)
        ) {
          closeManualModelModal();
        }
      }

      function updateEditingProvider(mutator) {
        const provider = getEditingProvider();
        if (!provider) {
          return;
        }
        mutator(provider);
        provider.models = mergeModels(provider.models, 'manual');
        reconcileProviderDirty(provider.id);
      }

      function rememberFetchedModels(providerId, models) {
        if (!providerId) {
          return;
        }
        fetchedModelsByProvider[providerId] = mergeModels(models, 'fetched');
      }

      function removeProviderModel(providerId, modelId) {
        const provider = getProviderById(providerId);
        if (!provider || !modelId) {
          return;
        }
        provider.models = (provider.models || []).filter((model) => model.id !== modelId);
        if (testModelByProviderId[provider.id] === modelId) {
          delete testModelByProviderId[provider.id];
        }
        normalizeTestModelForProvider(provider);
        if (
          manualModelModalState &&
          manualModelModalState.providerId === provider.id &&
          manualModelModalState.originalModelId === modelId
        ) {
          closeManualModelModal();
        }
        reconcileProviderDirty(provider.id);
        scheduleProviderAutosave(provider.id, 0, true);
      }

      function addFetchedModelToProvider(providerId, modelId) {
        const provider = getProviderById(providerId);
        if (!provider || !modelId) {
          return;
        }
        const selectedIds = new Set(getSelectedModelIds(provider));
        if (selectedIds.has(modelId)) {
          return;
        }
        const candidates = mergeModels(fetchedModelsByProvider[provider.id] || [], 'fetched');
        const candidate = candidates.find((model) => model.id === modelId);
        if (!candidate) {
          return;
        }
        provider.models = mergeModels([...(provider.models || []), candidate], 'manual');
        normalizeTestModelForProvider(provider);
        reconcileProviderDirty(provider.id);
        scheduleProviderAutosave(provider.id, 0, true);
      }

      function syncProvidersFromState(nextState) {
        const previousFetchedCache = fetchedModelsByProvider || {};
        const previousTestModelByProviderId = testModelByProviderId || {};
        providers = cloneProviders((nextState.settings && nextState.settings.providers) || []);
        persistedProvidersById = createPersistedProviderMap((nextState.settings && nextState.settings.providers) || []);
        dirtyProviderIds = new Set();
        fetchedModelsByProvider = {};
        testModelByProviderId = {};

        for (const provider of providers) {
          fetchedModelsByProvider[provider.id] = mergeModels(previousFetchedCache[provider.id] || [], 'fetched');
          testModelByProviderId[provider.id] = previousTestModelByProviderId[provider.id] || '';
          normalizeTestModelForProvider(provider);
        }

        if (!providerEditorId && providers.length) {
          providerEditorId = providers[0].id;
        }
        ensureProviderEditorId();
        pruneProviderSaveStatuses();
        if (providerAutosaveTargetId && !getProviderById(providerAutosaveTargetId)) {
          cancelProviderAutosave();
        }

        if (testModelModalProviderId && !getProviderById(testModelModalProviderId)) {
          closeTestModelModal();
        }
        if (fetchModelsModalProviderId && !getProviderById(fetchModelsModalProviderId)) {
          closeFetchModelsModal();
        }
        if (manualModelModalState) {
          const modalProvider = getProviderById(manualModelModalState.providerId);
          const editingModel = modalProvider && manualModelModalState.originalModelId
            ? getManualModels(modalProvider).find((model) => model.id === manualModelModalState.originalModelId)
            : modalProvider;
          if (!modalProvider || (manualModelModalState.mode === 'edit' && !editingModel)) {
            closeManualModelModal();
          }
        }
        // 仅在"放弃更改"模式下自动关闭，避免干扰"删除确认"流程
        if (discardModalMode === 'discard') {
          closeDiscardChangesModal(false);
        }
      }
`;
}
