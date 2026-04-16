/**
 * Provider/model config section functions for the settings center webview.
 * Includes clone, dirty-tracking, rendering, CRUD, and modal logic.
 */
export function getModelConfigJs(): string {
  return `
      let editorTab = 'config';

      function switchEditorTab(tab) {
        editorTab = tab;
        renderEditorTabs();
        renderEditorTabVisibility();
      }

      function resetEditorTab() {
        editorTab = 'config';
      }

      function renderEditorTabs() {
        const strings = runtimeState.strings || {};
        dom.editorTabConfig.textContent = strings.providerConfigSectionTitle || 'Config';
        dom.editorTabModels.textContent = strings.providerModelsSectionTitle || 'Models';
        dom.editorTabConfig.classList.toggle('active', editorTab === 'config');
        dom.editorTabModels.classList.toggle('active', editorTab === 'models');
      }

      function renderEditorTabVisibility() {
        const panes = document.querySelectorAll('.editor-pane');
        for (const pane of panes) {
          pane.classList.toggle('active', pane.getAttribute('data-tab') === editorTab);
        }
      }

      function normalizeModelSource(source, fallback) {
        return source === 'fetched' ? 'fetched' : fallback || 'manual';
      }

      function cloneCapabilities(capabilities) {
        if (!capabilities || typeof capabilities !== 'object') {
          return undefined;
        }
        const next = {};
        if (capabilities.vision) {
          next.vision = true;
        }
        if (capabilities.reasoning) {
          next.reasoning = true;
        }
        if (capabilities.audio) {
          next.audio = true;
        }
        if (capabilities.video) {
          next.video = true;
        }
        if (capabilities.tools) {
          next.tools = true;
        }
        return Object.keys(next).length ? next : undefined;
      }

      function cloneModel(model, fallbackSource) {
        if (!model) {
          return undefined;
        }
        const id = String(model.id || '').trim();
        if (!id) {
          return undefined;
        }
        const name = String(model.name || id).trim() || id;
        return {
          id: id,
          name: name,
          capabilities: cloneCapabilities(model.capabilities),
          source: normalizeModelSource(model.source, fallbackSource || 'manual')
        };
      }

      function mergeModels(models, fallbackSource) {
        const map = new Map();
        for (const raw of Array.isArray(models) ? models : []) {
          const model = cloneModel(raw, fallbackSource || 'manual');
          if (!model) {
            continue;
          }
          map.set(model.id, model);
        }
        return Array.from(map.values()).sort((left, right) => left.id.localeCompare(right.id, 'en'));
      }

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
          models: mergeModels(provider.models, 'manual'),
          modelLastSyncedAt: typeof provider.modelLastSyncedAt === 'number' ? provider.modelLastSyncedAt : undefined
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

      function providerModelsSignature(models) {
        return mergeModels(models, 'manual')
          .map((model) => {
            return (
              model.id +
              '|' +
              model.name +
              '|' +
              model.source +
              '|' +
              JSON.stringify(model.capabilities || {})
            );
          })
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

      function cancelProviderAutosave(providerId) {
        if (!providerAutosaveTimer) {
          return;
        }
        if (providerId && providerAutosaveTargetId && providerAutosaveTargetId !== providerId) {
          return;
        }
        clearTimeout(providerAutosaveTimer);
        providerAutosaveTimer = 0;
        providerAutosaveTargetId = '';
      }

      function persistProviderDraft(providerId, silent, skipStatus) {
        const provider = getProviderById(providerId || providerEditorId);
        if (!provider) {
          return false;
        }
        const validationMessage = validateProvider(provider);
        if (validationMessage) {
          if (!skipStatus) {
            setProviderSaveStatus(
              provider.id,
              'invalid',
              (runtimeState.strings && runtimeState.strings.providerAutosaveInvalid) || validationMessage
            );
          }
          return false;
        }
        const snapshot = cloneProvider(provider);
        if (!skipStatus) {
          setProviderSaveStatus(
            snapshot.id,
            'saved',
            (runtimeState.strings && runtimeState.strings.providerAutosaveSaved) || ''
          );
        }
        persistedProvidersById[snapshot.id] = cloneProvider(snapshot);
        dirtyProviderIds.delete(snapshot.id);
        vscode.postMessage({
          type: 'saveProvider',
          payload: {
            provider: snapshot,
            silent: !!silent
          }
        });
        return true;
      }

      function scheduleProviderAutosave(providerId, delay, skipStatus) {
        const targetId = String(providerId || providerEditorId || '');
        if (!targetId) {
          return;
        }
        cancelProviderAutosave();
        if (!isProviderDirty(targetId)) {
          return;
        }
        const provider = getProviderById(targetId);
        if (!provider) {
          return;
        }
        if (!skipStatus) {
          const validationMessage = validateProvider(provider);
          if (validationMessage) {
            setProviderSaveStatus(
              targetId,
              'invalid',
              (runtimeState.strings && runtimeState.strings.providerAutosaveInvalid) || validationMessage
            );
            return;
          }
          setProviderSaveStatus(
            targetId,
            'saving',
            (runtimeState.strings && runtimeState.strings.providerAutosaveSaving) || ''
          );
        }
        providerAutosaveTargetId = targetId;
        providerAutosaveTimer = setTimeout(() => {
          const autosaveProviderId = providerAutosaveTargetId;
          providerAutosaveTimer = 0;
          providerAutosaveTargetId = '';
          persistProviderDraft(autosaveProviderId, true, skipStatus);
          renderAll();
        }, Math.max(0, typeof delay === 'number' ? delay : 400));
      }

      function flushProviderAutosave(providerId) {
        const targetId = String(providerId || providerEditorId || '');
        if (!targetId) {
          return true;
        }
        cancelProviderAutosave(targetId);
        if (!isProviderDirty(targetId)) {
          return true;
        }
        return persistProviderDraft(targetId, true);
      }

      function setProviderSaveStatus(providerId, tone, message) {
        if (!providerId) {
          return;
        }
        if (!message) {
          delete providerSaveStatusById[providerId];
          return;
        }
        providerSaveStatusById[providerId] = {
          tone: tone || 'saved',
          message: String(message || '')
        };
      }

      function pruneProviderSaveStatuses() {
        const validIds = new Set(providers.map((provider) => provider.id));
        Object.keys(providerSaveStatusById).forEach((providerId) => {
          if (!validIds.has(providerId)) {
            delete providerSaveStatusById[providerId];
          }
        });
      }

      function getProviderSaveStatus(provider) {
        const strings = runtimeState.strings || {};
        if (!provider) {
          return { tone: '', message: '' };
        }
        if (isProviderDirty(provider.id)) {
          const validationMessage = validateProvider(provider);
          if (validationMessage) {
            return {
              tone: 'invalid',
              message: strings.providerAutosaveInvalid || validationMessage
            };
          }
          return {
            tone: 'saving',
            message: strings.providerAutosaveSaving || ''
          };
        }
        return providerSaveStatusById[provider.id] || { tone: '', message: '' };
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

      function getProviderById(providerId) {
        if (!providerId) {
          return null;
        }
        return providers.find((provider) => provider.id === providerId) || null;
      }

      function getCapabilityDescriptors() {
        return [
          { key: 'vision', cls: 'cap-vision', label: runtimeState.strings.capabilityVision || '' },
          { key: 'reasoning', cls: 'cap-reasoning', label: runtimeState.strings.capabilityReasoning || '' },
          { key: 'audio', cls: 'cap-audio', label: runtimeState.strings.capabilityAudio || '' },
          { key: 'video', cls: 'cap-video', label: runtimeState.strings.capabilityVideo || '' },
          { key: 'tools', cls: 'cap-tools', label: runtimeState.strings.capabilityTools || '' }
        ];
      }

      function renderCapabilityPills(capabilities, interactivePrefix) {
        const caps = capabilities || {};
        return getCapabilityDescriptors()
          .map((cap) => {
            const active = caps[cap.key] ? ' active' : '';
            const attrs = interactivePrefix
              ? ' data-' + interactivePrefix + '-cap="' + escapeHtml(cap.key) + '"'
              : '';
            return (
              '<button class="cap-pill ' +
              cap.cls +
              active +
              '" type="button"' +
              attrs +
              ' title="' +
              escapeHtml(cap.label) +
              '">' +
              escapeHtml(cap.label) +
              '</button>'
            );
          })
          .join('');
      }

      function renderCapabilitySummary(capabilities) {
        const caps = capabilities || {};
        const activeCaps = getCapabilityDescriptors().filter((cap) => caps[cap.key]);
        if (!activeCaps.length) {
          return '<span class="help">' + escapeHtml(runtimeState.strings.noneOption || '') + '</span>';
        }
        return activeCaps
          .map((cap) => {
            return (
              '<span class="cap-pill ' +
              cap.cls +
              ' active" title="' +
              escapeHtml(cap.label) +
              '">' +
              escapeHtml(cap.label) +
              '</span>'
            );
          })
          .join('');
      }

      function getSelectedModelIds(provider) {
        return (provider && provider.models ? provider.models : []).map((model) => model.id).filter(Boolean);
      }

      function getManualModels(provider) {
        return mergeModels(provider && provider.models, 'manual').filter((model) => model.source !== 'fetched');
      }

      function getFetchedSelectedModels(provider) {
        return mergeModels(provider && provider.models, 'manual').filter((model) => model.source === 'fetched');
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

      function renderModelConfigText() {
        const strings = runtimeState.strings || {};
        dom.addProviderBtn.textContent = strings.addProviderAction || '';
        dom.providerSearch.placeholder = strings.providerSearchPlaceholder || '';
        dom.saveProviderBtn.textContent = strings.saveProviderAction || '';
        dom.testConnectionBtn.textContent = strings.testConnectionAction || '';
        dom.fetchModelsBtn.textContent = strings.fetchModelsAction || '';
        dom.deleteProviderBtn.textContent = strings.deleteProviderAction || '';
        dom.providerNameLabel.textContent = strings.providerNameLabel || '';
        dom.apiTypeLabel.textContent = strings.providerApiTypeLabel || '';
        dom.apiKeyLabel.textContent = strings.apiKeyLabel || '';
        dom.baseUrlLabel.textContent = strings.baseUrlLabel || '';
        dom.providerEnabledSwitchLabel.textContent = strings.providerEnabledSwitchLabel || '';
        dom.addManualModelBtn.textContent = strings.addManualModelAction || '';
        dom.manualModelsTitle.textContent = strings.providerManualModelsSectionTitle || '';
        dom.fetchedModelsTitle.textContent = strings.providerFetchedModelsSectionTitle || '';
        dom.fetchModelsModalTitle.textContent = strings.providerFetchModalTitle || '';
        dom.fetchModelsModalDescription.textContent = strings.providerFetchModalDescription || '';
        dom.fetchModelsModalSearch.placeholder = strings.providerFetchModalSearchPlaceholder || '';
        dom.closeFetchModelsModalBtn.textContent = strings.providerFetchModalCloseAction || strings.cancelAction || '';
        dom.manualModelIdLabel.textContent = strings.manualModelIdLabel || '';
        dom.manualModelNameLabel.textContent = strings.manualModelNameLabel || '';
        dom.manualModelCapabilitiesLabel.textContent = strings.manualModelCapabilitiesLabel || '';
        dom.cancelManualModelBtn.textContent = strings.cancelAction || '';
        dom.saveManualModelBtn.textContent = strings.saveAction || '';
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
            const statusClass = provider.enabled ? 'enabled' : 'disabled';
            const providerName = provider.name || runtimeState.strings.providerDraftName || '';
            const selectProviderTitle = (runtimeState.strings.selectProviderToEdit || '') + ': ' + providerName;
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
              '<span class="pill ' + statusClass + '">' +
              escapeHtml(provider.enabled ? runtimeState.strings.providerEnabledStatus || '' : runtimeState.strings.providerDisabledStatus || '') +
              '</span>' +
              '</div>' +
              '<div class="provider-item-meta">' +
              '<span class="pill">' +
              escapeHtml(provider.apiType) +
              '</span>' +
              '</div>' +
              '</button>' +
              '</div>'
            );
          })
          .join('');
      }

      function renderProviderFields() {
        const provider = getEditingProvider();
        const strings = runtimeState.strings || {};
        const disabled = !provider;
        const editorEl = document.querySelector('.editor');
        const isEmpty = !providers.length;
        if (editorEl) editorEl.style.display = isEmpty ? 'none' : '';
        dom.providerEmptyState.classList.toggle('visible', isEmpty);
        dom.providerEmptyText.textContent = isEmpty ? (strings.providerEmptyState || '') : '';
        if (disabled) {
          const saveStatus = getProviderSaveStatus(provider);
          dom.providerSaveStatus.textContent = saveStatus.message || '';
          dom.providerSaveStatus.className = 'provider-save-status' + (saveStatus.message ? ' visible ' + saveStatus.tone : '');
          dom.providerPanelTitle.textContent = '';
          dom.providerEnabledCheckbox.checked = false;
          return;
        }
        const saveStatus = getProviderSaveStatus(provider);
        dom.providerSaveStatus.textContent = saveStatus.message || '';
        dom.providerSaveStatus.className = 'provider-save-status' + (saveStatus.message ? ' visible ' + saveStatus.tone : '');
        dom.providerName.disabled = disabled;
        dom.apiType.disabled = disabled;
        dom.apiKey.disabled = disabled;
        dom.baseUrl.disabled = disabled;
        dom.saveProviderBtn.hidden = true;
        dom.saveProviderBtn.disabled = true;
        dom.addManualModelBtn.disabled = disabled;
        dom.fetchModelsBtn.disabled = disabled || isFetchingProviderModels;
        dom.fetchModelsBtn.textContent = isFetchingProviderModels
          ? strings.fetchModelsLoadingAction || strings.fetchModelsAction || ''
          : strings.fetchModelsAction || '';
        dom.deleteProviderBtn.disabled = disabled;
        dom.testConnectionBtn.disabled = disabled || getSelectedModelIds(provider).length === 0;
        dom.providerName.value = provider ? provider.name : '';
        dom.apiType.value = provider ? provider.apiType : 'chat_completions';
        dom.apiKey.value = provider ? provider.apiKey : '';
        dom.baseUrl.value = provider ? provider.baseUrl : '';
        dom.providerPanelTitle.textContent = provider ? (provider.name || strings.providerDraftName || '') : '';
        dom.providerEnabledCheckbox.checked = provider ? provider.enabled : false;
      }

      function renderSelectedModelRow(model, sourceClass, sourceLabel, actionsHtml) {
        return (
          '<div class="selected-model-row">' +
          '<div class="selected-model-main">' +
          '<div class="selected-model-title">' +
          '<span class="model-name">' +
          escapeHtml(model.name || model.id) +
          '</span>' +
          '</div>' +
          '<div class="model-desc">' +
          escapeHtml(model.id) +
          '</div>' +
          '<div class="model-caps">' +
          renderCapabilitySummary(model.capabilities) +
          '</div>' +
          '</div>' +
          '<div class="selected-model-actions">' +
          actionsHtml +
          '</div>' +
          '</div>'
        );
      }

      function renderManualModelsList(provider) {
        if (!provider) {
          dom.manualModelsList.innerHTML = '<div class="model-empty">' + escapeHtml(runtimeState.strings.selectProviderToEdit || '') + '</div>';
          return;
        }
        const models = getManualModels(provider);
        if (!models.length) {
          dom.manualModelsList.innerHTML = '<div class="model-empty">' + escapeHtml(runtimeState.strings.providerManualModelsEmpty || '') + '</div>';
          return;
        }
        dom.manualModelsList.innerHTML = models
          .map((model) => {
            const actions =
              '<button class="btn-secondary" type="button" data-model-action="edit" data-model-id="' +
              escapeHtml(model.id) +
              '">' +
              escapeHtml(runtimeState.strings.editManualModelAction || '') +
              '</button>' +
              '<button class="btn-danger" type="button" data-model-action="delete" data-model-id="' +
              escapeHtml(model.id) +
              '">' +
              escapeHtml(runtimeState.strings.deleteAction || '') +
              '</button>';
            return renderSelectedModelRow(
              model,
              'manual',
              runtimeState.strings.modelSourceManual || '',
              actions
            );
          })
          .join('');
      }

      function renderFetchedModelsList(provider) {
        if (!provider) {
          dom.fetchedModelsList.innerHTML = '<div class="model-empty">' + escapeHtml(runtimeState.strings.selectProviderToEdit || '') + '</div>';
          return;
        }
        const models = getFetchedSelectedModels(provider);
        if (!models.length) {
          dom.fetchedModelsList.innerHTML = '<div class="model-empty">' + escapeHtml(runtimeState.strings.providerFetchedModelsEmpty || '') + '</div>';
          return;
        }
        dom.fetchedModelsList.innerHTML = models
          .map((model) => {
            const actions =
              '<button class="btn-danger" type="button" data-model-action="delete" data-model-id="' +
              escapeHtml(model.id) +
              '">' +
              escapeHtml(runtimeState.strings.deleteAction || '') +
              '</button>';
            return renderSelectedModelRow(
              model,
              'fetched',
              runtimeState.strings.modelSourceFetched || '',
              actions
            );
          })
          .join('');
      }

      function renderFetchModelsModal() {
        const strings = runtimeState.strings || {};
        const provider = getProviderById(fetchModelsModalProviderId);
        if (!provider || !fetchModelsModalProviderId) {
          dom.fetchModelsModal.classList.remove('visible');
          dom.fetchModelsModal.setAttribute('aria-hidden', 'true');
          dom.fetchModelsModalDescription.textContent = strings.providerFetchModalDescription || '';
          dom.fetchModelsModalSearch.disabled = false;
          dom.fetchModelsModalSearch.placeholder = strings.providerFetchModalSearchPlaceholder || '';
          dom.fetchModelsModalList.innerHTML = '';
          return;
        }

        dom.fetchModelsModal.classList.add('visible');
        dom.fetchModelsModal.setAttribute('aria-hidden', 'false');
        dom.fetchModelsModalSearch.value = fetchModelsSearchKeyword;
        const isLoading = isFetchingProviderModels && fetchModelsModalProviderId === provider.id;
        dom.fetchModelsModalDescription.textContent = isLoading
          ? strings.providerFetchModalLoading || strings.providerFetchModalDescription || ''
          : strings.providerFetchModalDescription || '';
        dom.fetchModelsModalSearch.disabled = isLoading;
        dom.fetchModelsModalSearch.placeholder = isLoading
          ? strings.providerFetchModalLoading || strings.providerFetchModalSearchPlaceholder || ''
          : strings.providerFetchModalSearchPlaceholder || '';

        if (isLoading) {
          dom.fetchModelsModalList.innerHTML =
            '<div class="fetch-models-loading">' +
            '<div class="fetch-models-spinner" aria-hidden="true"></div>' +
            '<div class="fetch-models-loading-copy">' +
            escapeHtml(strings.providerFetchModalLoading || '') +
            '</div>' +
            '</div>';
          return;
        }

        const allModels = mergeModels(fetchedModelsByProvider[provider.id] || [], 'fetched');
        if (!allModels.length) {
          dom.fetchModelsModalList.innerHTML = '<div class="model-empty">' + escapeHtml(strings.providerFetchModalEmpty || '') + '</div>';
          return;
        }

        const keyword = fetchModelsSearchKeyword.trim().toLowerCase();
        const filtered = !keyword
          ? allModels
          : allModels.filter((model) => {
              const haystack = (model.id + ' ' + model.name).toLowerCase();
              return haystack.includes(keyword);
            });
        if (!filtered.length) {
          dom.fetchModelsModalList.innerHTML = '<div class="model-empty">' + escapeHtml(strings.providerFetchModalSearchEmpty || '') + '</div>';
          return;
        }

        const selectedIds = new Set(getSelectedModelIds(provider));
        dom.fetchModelsModalList.innerHTML = filtered
          .map((model) => {
            const added = selectedIds.has(model.id);
            const buttonClass = added ? 'btn-secondary' : 'btn-primary';
            const buttonLabel = added
              ? strings.providerFetchModelAddedAction || ''
              : strings.providerFetchModelAddAction || '';
            return (
              '<div class="fetch-model-row' +
              (added ? ' is-added' : '') +
              '">' +
              '<div class="selected-model-main">' +
              '<div class="selected-model-title">' +
              '<span class="model-name">' +
              escapeHtml(model.name || model.id) +
              '</span>' +
              '<span class="source-pill fetched">' +
              escapeHtml(strings.modelSourceFetched || '') +
              '</span>' +
              '</div>' +
              '<div class="model-desc">' +
              escapeHtml(model.id) +
              '</div>' +
              '<div class="model-caps">' +
              renderCapabilitySummary(model.capabilities) +
              '</div>' +
              '</div>' +
              '<button class="' +
              buttonClass +
              '" type="button" data-fetch-model-id="' +
              escapeHtml(model.id) +
              '"' +
              (added ? ' disabled' : '') +
              '>' +
              escapeHtml(buttonLabel) +
              '</button>' +
              '</div>'
            );
          })
          .join('');
      }

      function renderManualModelModal() {
        const strings = runtimeState.strings || {};
        if (!manualModelModalState) {
          dom.manualModelModal.classList.remove('visible');
          dom.manualModelModal.setAttribute('aria-hidden', 'true');
          dom.manualModelCapabilities.innerHTML = '';
          dom.manualModelId.value = '';
          dom.manualModelName.value = '';
          return;
        }

        dom.manualModelModalTitle.textContent =
          manualModelModalState.mode === 'edit'
            ? strings.manualModelDialogEditTitle || ''
            : strings.manualModelDialogCreateTitle || '';
        dom.manualModelId.value = manualModelModalState.draft.id || '';
        dom.manualModelName.value = manualModelModalState.draft.name || '';
        dom.manualModelCapabilities.innerHTML = renderCapabilityPills(
          manualModelModalState.draft.capabilities,
          'manual-model'
        );
        dom.manualModelModal.classList.add('visible');
        dom.manualModelModal.setAttribute('aria-hidden', 'false');
      }

      function renderModels() {
        const provider = getEditingProvider();
        renderManualModelsList(provider);
        renderFetchedModelsList(provider);
        renderFetchModelsModal();
        renderManualModelModal();
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
        resetEditorTab();
        if (fetchModelsModalProviderId === providerId) {
          closeFetchModelsModal();
        }
        if (manualModelModalState && manualModelModalState.providerId === providerId) {
          closeManualModelModal();
        }
        renderAll();
      }

      function rememberFetchedModels(providerId, models) {
        if (!providerId) {
          return;
        }
        fetchedModelsByProvider[providerId] = mergeModels(models, 'fetched');
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
          .map((model) => {
            return '<option value="' + escapeHtml(model.id) + '">' + escapeHtml(model.name || model.id) + '</option>';
          })
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
        dom.fetchModelsModal.classList.remove('visible');
        dom.fetchModelsModal.setAttribute('aria-hidden', 'true');
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

      function openManualModelModal(mode, modelId) {
        const provider = getEditingProvider();
        if (!provider) {
          return;
        }
        if (mode === 'edit') {
          const model = getManualModels(provider).find((item) => item.id === modelId);
          if (!model) {
            return;
          }
          manualModelModalState = {
            mode: 'edit',
            providerId: provider.id,
            originalModelId: model.id,
            draft: {
              id: model.id,
              name: model.name || model.id,
              capabilities: cloneCapabilities(model.capabilities),
              source: 'manual'
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
        dom.manualModelModal.classList.remove('visible');
        dom.manualModelModal.setAttribute('aria-hidden', 'true');
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
        const nextId = String(dom.manualModelId.value || '').trim();
        const nextName = String(dom.manualModelName.value || '').trim();
        if (!nextId) {
          showToast(runtimeState.strings.manualModelIdRequired || '', 'error');
          dom.manualModelId.focus();
          return;
        }
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

        const nextModel = {
          id: nextId,
          name: nextName || nextId,
          capabilities: cloneCapabilities(manualModelModalState.draft.capabilities),
          source: 'manual'
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
        closeDiscardChangesModal(false);
      }
`;
}
