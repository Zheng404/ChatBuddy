/**
 * Provider/model config section functions for the settings center webview.
 * Includes clone, dirty-tracking, rendering, CRUD, and modal logic.
 */
export function getModelConfigJs(): string {
  return `
      function cloneProviders(items) {
        return (Array.isArray(items) ? items : []).map((provider) => ({
          id: String(provider.id || ''),
          kind:
            provider.kind === 'openai' ||
            provider.kind === 'gemini' ||
            provider.kind === 'openrouter' ||
            provider.kind === 'ollama'
              ? provider.kind
              : 'custom',
          name: String(provider.name || ''),
          apiKey: String(provider.apiKey || ''),
          baseUrl: String(provider.baseUrl || ''),
          apiType: provider.apiType === 'responses' ? 'responses' : 'chat_completions',
          enabled: provider.enabled !== false,
          models: Array.isArray(provider.models)
            ? provider.models
                .map((model) => ({
                  id: String(model.id || '').trim(),
                  name: String(model.name || model.id || '').trim(),
                  capabilities: model.capabilities || undefined
                }))
                .filter((model) => model.id)
            : []
        }));
      }

      function cloneProvider(provider) {
        return cloneProviders([provider])[0];
      }

      function createPersistedProviderMap(items) {
        const map = {};
        for (const provider of Array.isArray(items) ? items : []) {
          if (!provider || !provider.id) {
            continue;
          }
          map[String(provider.id)] = cloneProvider(provider);
        }
        return map;
      }

      function mergeModels(models) {
        const map = new Map();
        for (const model of Array.isArray(models) ? models : []) {
          const id = String(model.id || '').trim();
          if (!id) {
            continue;
          }
          map.set(id, {
            id,
            name: String(model.name || id).trim() || id,
            capabilities: model.capabilities || undefined
          });
        }
        return Array.from(map.values()).sort((left, right) => left.id.localeCompare(right.id, 'en'));
      }

      function providerModelsSignature(models) {
        return mergeModels(models)
          .map((model) => model.id + '|' + model.name + '|' + JSON.stringify(model.capabilities || {}))
          .join('||');
      }

      function providerSignature(provider) {
        return [
          provider.id,
          provider.kind,
          provider.name,
          provider.apiKey,
          provider.baseUrl,
          provider.apiType,
          provider.enabled ? '1' : '0',
          providerModelsSignature(provider.models)
        ].join('::');
      }

      function providersCollectionSignature(items) {
        return cloneProviders(items)
          .sort((left, right) => left.id.localeCompare(right.id, 'en'))
          .map((provider) => providerSignature(provider))
          .join('###');
      }

      function isSameProvider(left, right) {
        if (!left || !right) {
          return false;
        }
        return providerSignature(left) === providerSignature(right);
      }

      function reconcileProviderDirty(providerId) {
        if (!providerId) {
          return;
        }
        const draft = providers.find((provider) => provider.id === providerId);
        if (!draft) {
          dirtyProviderIds.delete(providerId);
          return;
        }
        const persisted = persistedProvidersById[providerId];
        if (!persisted || !isSameProvider(draft, persisted)) {
          dirtyProviderIds.add(providerId);
          return;
        }
        dirtyProviderIds.delete(providerId);
      }

      function isProviderDirty(providerId) {
        return !!providerId && dirtyProviderIds.has(providerId);
      }

      function discardProviderChanges(providerId) {
        if (!providerId) {
          return;
        }
        const persisted = persistedProvidersById[providerId];
        if (!persisted) {
          providers = providers.filter((provider) => provider.id !== providerId);
          delete fetchedModelsByProvider[providerId];
          delete testModelByProviderId[providerId];
          dirtyProviderIds.delete(providerId);
          if (providerEditorId === providerId) {
            providerEditorId = providers[0] ? providers[0].id : '';
          }
          return;
        }
        providers = providers.map((provider) => (provider.id === providerId ? cloneProvider(persisted) : provider));
        fetchedModelsByProvider[providerId] = mergeModels(persisted.models);
        testModelByProviderId[providerId] = persisted.models[0] ? persisted.models[0].id : '';
        dirtyProviderIds.delete(providerId);
      }

      function closeDiscardChangesModal(confirmed) {
        dom.discardChangesModal.classList.remove('visible');
        dom.discardChangesModal.setAttribute('aria-hidden', 'true');
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
        dom.discardChangesModal.classList.add('visible');
        dom.discardChangesModal.setAttribute('aria-hidden', 'false');
        dom.discardChangesConfirmBtn.focus();
        return new Promise((resolve) => {
          discardModalResolver = resolve;
        });
      }

      async function confirmDiscardCurrentProviderChanges() {
        const providerId = providerEditorId;
        if (!isProviderDirty(providerId)) {
          return true;
        }
        const confirmed = await openDiscardChangesModal();
        if (!confirmed) {
          return false;
        }
        discardProviderChanges(providerId);
        return true;
      }

      function ensureFetchedModels(provider) {
        if (!provider) {
          return [];
        }
        const key = provider.id || '__draft__';
        const merged = mergeModels([...(fetchedModelsByProvider[key] || []), ...(provider.models || [])]);
        fetchedModelsByProvider[key] = merged;
        return merged;
      }

      function getSelectedModelIds(provider) {
        return (provider && provider.models ? provider.models : []).map((model) => model.id).filter(Boolean);
      }

      function normalizeTestModelForProvider(provider) {
        if (!provider) {
          return '';
        }
        const modelIds = getSelectedModelIds(provider);
        const current = String(testModelByProviderId[provider.id] || '');
        if (current && modelIds.includes(current)) {
          return current;
        }
        const fallback = modelIds[0] || '';
        testModelByProviderId[provider.id] = fallback;
        return fallback;
      }

      function ensureProviderEditorId() {
        if (!providers.length) {
          providerEditorId = '';
          return;
        }
        const exists = providers.some((provider) => provider.id === providerEditorId);
        if (!exists) {
          providerEditorId = providers[0].id;
        }
      }

      function getEditingProvider() {
        ensureProviderEditorId();
        return providers.find((provider) => provider.id === providerEditorId) || null;
      }

      function renderModelConfigText() {
        const strings = runtimeState.strings || {};
        dom.addProviderBtn.textContent = strings.addProviderAction || '';
        dom.providerSearch.placeholder = strings.providerSearchPlaceholder || '';
        dom.providerPanelTitle.textContent = strings.providerConfigSectionTitle || '';
        dom.saveProviderBtn.textContent = strings.saveProviderAction || '';
        dom.testConnectionBtn.textContent = strings.testConnectionAction || '';
        dom.fetchModelsBtn.textContent = strings.fetchModelsAction || '';
        dom.deleteProviderBtn.textContent = strings.deleteProviderAction || '';
        dom.providerNameLabel.textContent = strings.providerNameLabel || '';
        dom.apiTypeLabel.textContent = strings.providerApiTypeLabel || '';
        dom.apiKeyLabel.textContent = strings.apiKeyLabel || '';
        dom.baseUrlLabel.textContent = strings.baseUrlLabel || '';
        dom.baseUrlHelp.textContent = strings.providerBaseUrlHelp || '';
        dom.modelsPanelTitle.textContent = strings.providerModelsSectionTitle || '';
        dom.modelsHelp.textContent = strings.providerModelsHelp || '';
        dom.testModelModalTitle.textContent = strings.providerTestModelDialogTitle || '';
        dom.testModelModalDescription.textContent = strings.providerTestModelDialogDescription || '';
        dom.testModelModalLabel.textContent = strings.providerTestModelLabel || '';
        dom.cancelTestModelBtn.textContent = strings.providerTestModelCancelAction || '';
        dom.confirmTestModelBtn.textContent = strings.providerTestModelConfirmAction || '';
        dom.discardChangesModalTitle.textContent = strings.providerUnsavedTitle || strings.providerUnsavedConfirm || '';
        dom.discardChangesModalDescription.textContent =
          strings.providerUnsavedDescription || strings.providerUnsavedConfirm || '';
        dom.discardChangesStayBtn.textContent = strings.providerUnsavedStayAction || strings.providerTestModelCancelAction || '';
        dom.discardChangesConfirmBtn.textContent =
          strings.providerUnsavedDiscardAction || strings.deleteProviderAction || '';
      }

      function renderProviderList() {
        const normalized = searchKeyword.trim().toLowerCase();
        const visibleProviders = !normalized
          ? providers
          : providers.filter((provider) => {
              const haystack = (provider.name + ' ' + provider.kind + ' ' + provider.apiType).toLowerCase();
              return haystack.includes(normalized);
            });

        if (!visibleProviders.length) {
          dom.providerList.innerHTML = '<div class="help">' + escapeHtml(runtimeState.strings.providerSearchEmpty || '') + '</div>';
          return;
        }

        dom.providerList.innerHTML = visibleProviders
          .map((provider) => {
            const active = provider.id === providerEditorId ? 'active' : '';
            const statusClass = provider.enabled ? '' : 'off';
            const providerName = provider.name || runtimeState.strings.providerDraftName || '';
            const selectProviderTitle = (runtimeState.strings.selectProviderToEdit || '') + ': ' + providerName;
            const providerEnabledTitle = (runtimeState.strings.providerEnabledSwitchLabel || '') + ': ' + providerName;
            return (
              '<div class="provider-item ' +
              active +
              '">' +
              '<button class="provider-item-main" type="button" data-id="' +
              escapeHtml(provider.id) +
              '" title="' +
              escapeHtml(selectProviderTitle) +
              '">' +
              '<div class="provider-item-name">' +
              escapeHtml(providerName) +
              '</div>' +
              '<div class="provider-item-meta">' +
              '<span class="pill">' +
              escapeHtml(provider.apiType) +
              '</span>' +
              '<span class="pill ' +
              statusClass +
              '">' +
              escapeHtml(provider.enabled ? runtimeState.strings.providerEnabledStatus || '' : runtimeState.strings.providerDisabledStatus || '') +
              '</span>' +
              '</div>' +
              '</button>' +
              '<label class="provider-item-toggle" title="' +
              escapeHtml(providerEnabledTitle) +
              '">' +
              '<input type="checkbox" data-toggle-id="' +
              escapeHtml(provider.id) +
              '" title="' +
              escapeHtml(providerEnabledTitle) +
              '" ' +
              (provider.enabled ? 'checked' : '') +
              ' />' +
              '<span>' +
              escapeHtml(runtimeState.strings.providerEnabledSwitchLabel || '') +
              '</span>' +
              '</label>' +
              '</div>'
            );
          })
          .join('');
      }

      function renderProviderFields() {
        const provider = getEditingProvider();
        const disabled = !provider;
        dom.providerName.disabled = disabled;
        dom.apiType.disabled = disabled;
        dom.apiKey.disabled = disabled;
        dom.baseUrl.disabled = disabled;
        dom.saveProviderBtn.disabled = disabled || !isProviderDirty(provider ? provider.id : '');
        dom.fetchModelsBtn.disabled = disabled;
        dom.deleteProviderBtn.disabled = disabled;
        dom.testConnectionBtn.disabled = disabled || getSelectedModelIds(provider).length === 0;
        dom.providerName.value = provider ? provider.name : '';
        dom.apiType.value = provider ? provider.apiType : 'chat_completions';
        dom.apiKey.value = provider ? provider.apiKey : '';
        dom.baseUrl.value = provider ? provider.baseUrl : '';
      }

      function closeTestModelModal() {
        testModelModalProviderId = '';
        dom.testModelModal.classList.remove('visible');
        dom.testModelModal.setAttribute('aria-hidden', 'true');
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
          .map((model) => '<option value="' + escapeHtml(model.id) + '">' + escapeHtml(model.id) + '</option>')
          .join('');
        dom.testModelModalSelect.value = current;
        testModelModalProviderId = provider.id;
        dom.testModelModal.classList.add('visible');
        dom.testModelModal.setAttribute('aria-hidden', 'false');
        dom.testModelModalSelect.focus();
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

      function renderModels() {
        const provider = getEditingProvider();
        if (!provider) {
          dom.modelsList.innerHTML = '<div class="help">' + escapeHtml(runtimeState.strings.selectProviderToEdit || '') + '</div>';
          return;
        }
        const models = ensureFetchedModels(provider);
        if (!models.length) {
          dom.modelsList.innerHTML = '<div class="help">' + escapeHtml(runtimeState.strings.providerModelsEmpty || '') + '</div>';
          return;
        }
        const selectedIds = new Set((provider.models || []).map((model) => model.id));
        dom.modelsList.innerHTML = models
          .map((model) => {
            const checked = selectedIds.has(model.id) ? 'checked' : '';
            const caps = model.capabilities || {};
            const capEntries = [];
            const capKeys = [
              { key: 'vision', cls: 'cap-vision', label: runtimeState.strings.capabilityVision || '' },
              { key: 'reasoning', cls: 'cap-reasoning', label: runtimeState.strings.capabilityReasoning || '' },
              { key: 'audio', cls: 'cap-audio', label: runtimeState.strings.capabilityAudio || '' },
              { key: 'video', cls: 'cap-video', label: runtimeState.strings.capabilityVideo || '' },
              { key: 'tools', cls: 'cap-tools', label: runtimeState.strings.capabilityTools || '' }
            ];
            for (const cap of capKeys) {
              const active = caps[cap.key] ? ' active' : '';
              capEntries.push(
                '<span class="cap-pill ' +
                  cap.cls +
                  active +
                  '" data-model-id="' +
                  escapeHtml(model.id) +
                  '" data-cap="' +
                  cap.key +
                  '" title="' +
                  escapeHtml(cap.label) +
                  '">' +
                  escapeHtml(cap.label) +
                  '</span>'
              );
            }
            return (
              '<label class="model-row">' +
              '<input type="checkbox" data-model-id="' +
              escapeHtml(model.id) +
              '" ' +
              checked +
              ' />' +
              '<div class="model-meta">' +
              '<div class="model-name">' +
              escapeHtml(model.id) +
              '</div>' +
              '<div class="model-desc">' +
              escapeHtml(model.name || model.id) +
              '</div>' +
              '<div class="model-caps">' +
              capEntries.join('') +
              '</div>' +
              '</div>' +
              '</label>'
            );
          })
          .join('');
      }

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

      async function addProvider() {
        if (!(await confirmDiscardCurrentProviderChanges())) {
          return;
        }
        let index = providers.length + 1;
        let nextId = createInternalProviderId();
        while (providers.some((provider) => provider.id === nextId)) {
          index += 1;
          nextId = createInternalProviderId();
        }
        providers.push({
          id: nextId,
          kind: 'custom',
          name: (runtimeState.strings.providerDraftName || 'Provider') + ' ' + index,
          apiKey: '',
          baseUrl: '',
          apiType: 'chat_completions',
          enabled: true,
          models: []
        });
        providerEditorId = nextId;
        fetchedModelsByProvider[nextId] = [];
        testModelByProviderId[nextId] = '';
        dirtyProviderIds.add(nextId);
        renderAll();
      }

      async function deleteProvider() {
        const provider = getEditingProvider();
        if (!provider) {
          return;
        }
        if (!(await confirmDiscardCurrentProviderChanges())) {
          return;
        }
        const providerId = provider.id;
        if (persistedProvidersById[providerId]) {
          vscode.postMessage({
            type: 'deleteProvider',
            payload: {
              providerId,
              providerName: provider.name || runtimeState.strings.providerDraftName || ''
            }
          });
          return;
        }
        providers = providers.filter((item) => item.id !== providerId);
        delete fetchedModelsByProvider[providerId];
        delete testModelByProviderId[providerId];
        dirtyProviderIds.delete(providerId);
        providerEditorId = providers[0] ? providers[0].id : '';
        renderAll();
      }

      function updateEditingProvider(mutator) {
        const provider = getEditingProvider();
        if (!provider) {
          return;
        }
        mutator(provider);
        reconcileProviderDirty(provider.id);
      }

      function syncProvidersFromState(nextState) {
        providers = cloneProviders((nextState.settings && nextState.settings.providers) || []);
        persistedProvidersById = createPersistedProviderMap((nextState.settings && nextState.settings.providers) || []);
        dirtyProviderIds = new Set();
        fetchedModelsByProvider = {};
        testModelByProviderId = {};
        for (const provider of providers) {
          fetchedModelsByProvider[provider.id] = mergeModels(provider.models);
          testModelByProviderId[provider.id] = provider.models[0] ? provider.models[0].id : '';
        }
        if (!providerEditorId && providers.length) {
          providerEditorId = providers[0].id;
        }
        closeTestModelModal();
        closeDiscardChangesModal(false);
      }
`;
}
