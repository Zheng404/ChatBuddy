/**
 * Provider/model config rendering functions for the settings center webview.
 * Pure rendering logic: no state mutations, only DOM updates.
 */
export function getModelConfigRenderersJs(): string {
  return `
      function renderKindPill(kind) {
        var effectiveKind = kind || 'chat';
        var label = getKindLabel(effectiveKind);
        if (!label) {
          return '';
        }
        return '<span class="kind-pill kind-' + effectiveKind + '">' + escapeHtml(label) + '</span>';
      }

      function renderCapabilityPills(capabilities, interactivePrefix) {
        const caps = capabilities || {};
        return getCapabilityDescriptors()
          .map((cap) => {
            const active = caps[cap.key] ? ' active' : '';
            const attrs = interactivePrefix
              ? ' data-' + interactivePrefix + '-cap="' + escapeHtml(cap.key) + '"'
              : '';
            const checkCls = interactivePrefix ? ' cap-check' : '';
            return (
              '<button class="cap-pill ' +
              cap.cls +
              active +
              checkCls +
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
        dom.manualModelKindLabel.textContent = strings.modelKindLabel || '';
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

      function renderSelectedModelRow(model, actionsHtml) {
        var kindPill = renderKindPill(model.kind);
        return (
          '<div class="selected-model-row">' +
          '<div class="selected-model-main">' +
          '<div class="selected-model-title">' +
          '<span class="model-name">' +
          escapeHtml(model.name || model.id) +
          '</span>' +
          kindPill +
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
              actions
            );
          })
          .join('');
      }

      function renderFetchModelsModal() {
        const strings = runtimeState.strings || {};
        const provider = getProviderById(fetchModelsModalProviderId);
        if (!provider || !fetchModelsModalProviderId) {
          closeModal(dom.fetchModelsModal);
          dom.fetchModelsModalDescription.textContent = strings.providerFetchModalDescription || '';
          dom.fetchModelsModalSearch.disabled = false;
          dom.fetchModelsModalSearch.placeholder = strings.providerFetchModalSearchPlaceholder || '';
          dom.fetchModelsModalList.innerHTML = '';
          return;
        }

        openModal(dom.fetchModelsModal);
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
            var fetchKindPill = renderKindPill(model.kind);
            return (
              '<div class="fetch-model-row' +
              (added ? ' is-added' : '') +
              '">' +
              '<div class="selected-model-main">' +
              '<div class="selected-model-title">' +
              '<span class="model-name">' +
              escapeHtml(model.name || model.id) +
              '</span>' +
              fetchKindPill +
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
          closeModal(dom.manualModelModal);
          dom.manualModelId.value = '';
          dom.manualModelId.readOnly = false;
          dom.manualModelId.classList.remove('readonly');
          dom.manualModelName.value = '';
          dom.manualModelKind.value = 'chat';
          for (const cb of dom.manualModelCapabilities.querySelectorAll('input[type="checkbox"]')) {
            cb.checked = false;
          }
          return;
        }

        dom.manualModelModalTitle.textContent =
          manualModelModalState.mode === 'edit'
            ? strings.manualModelDialogEditTitle || ''
            : strings.manualModelDialogCreateTitle || '';
        dom.manualModelId.value = manualModelModalState.draft.id || '';
        dom.manualModelName.value = manualModelModalState.draft.name || '';
        const isFetched = manualModelModalState.originalSource === 'fetched';
        dom.manualModelId.readOnly = isFetched;
        dom.manualModelId.classList.toggle('readonly', isFetched);
        const currentKind = manualModelModalState.draft.kind || 'chat';
        dom.manualModelKind.value = currentKind;
        for (const opt of dom.manualModelKind.options) {
          const kindKey = opt.value;
          switch (kindKey) {
            case 'chat': opt.textContent = strings.modelKindChat || 'Text'; break;
            case 'image': opt.textContent = strings.modelKindImage || 'Image'; break;
            case 'video': opt.textContent = strings.modelKindVideo || 'Video'; break;
            case 'audio': opt.textContent = strings.modelKindAudio || 'Audio'; break;
            case 'embedding': opt.textContent = strings.modelKindEmbedding || 'Embedding'; break;
            case 'rerank': opt.textContent = strings.modelKindRerank || 'Rerank'; break;
          }
        }
        const caps = manualModelModalState.draft.capabilities || {};
        for (const cb of dom.manualModelCapabilities.querySelectorAll('input[type="checkbox"]')) {
          const key = cb.getAttribute('data-cap');
          cb.checked = !!caps[key];
        }
        for (const desc of getCapabilityDescriptors()) {
          const cb = dom.manualModelCapabilities.querySelector('input[data-cap="' + desc.key + '"]');
          if (cb) {
            const span = cb.nextElementSibling;
            if (span) {
              span.textContent = desc.label;
            }
          }
        }
        openModal(dom.manualModelModal);
      }

      function renderModels() {
        const provider = getEditingProvider();
        renderManualModelsList(provider);
        renderFetchedModelsList(provider);
        renderFetchModelsModal();
        renderManualModelModal();
      }
  `;
}
