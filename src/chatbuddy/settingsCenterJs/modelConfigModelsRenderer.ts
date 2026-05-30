/**
 * Model list and modal rendering for the settings center webview.
 */
export function getModelConfigModelsRendererJs(): string {
  return `
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
          // Safe: renderModelEmptyState escapes its content via escapeHtml()
          dom.manualModelsList.innerHTML = renderModelEmptyState('selectProviderToEdit');
          return;
        }
        const models = getManualModels(provider);
        if (!models.length) {
          // Safe: renderModelEmptyState escapes its content via escapeHtml()
          dom.manualModelsList.innerHTML = renderModelEmptyState('providerManualModelsEmpty');
          return;
        }
        // Safe: all user content escaped via escapeHtml()
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
          // Safe: renderModelEmptyState escapes its content via escapeHtml()
          dom.fetchedModelsList.innerHTML = renderModelEmptyState('selectProviderToEdit');
          return;
        }
        const models = getFetchedSelectedModels(provider);
        if (!models.length) {
          // Safe: renderModelEmptyState escapes its content via escapeHtml()
          dom.fetchedModelsList.innerHTML = renderModelEmptyState('providerFetchedModelsEmpty');
          return;
        }
        // Safe: all user content escaped via escapeHtml()
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
          dom.fetchModelsModalList.textContent = '';
          if (dom.fetchModelsError) { dom.fetchModelsError.style.display = 'none'; }
          fetchModelsLastError = '';
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
          dom.fetchModelsModalList.textContent = '';
          var loadingDiv = document.createElement('div');
          loadingDiv.className = 'fetch-models-loading';
          var spinnerDiv = document.createElement('div');
          spinnerDiv.className = 'fetch-models-spinner';
          spinnerDiv.setAttribute('aria-hidden', 'true');
          loadingDiv.appendChild(spinnerDiv);
          var loadingCopy = document.createElement('div');
          loadingCopy.className = 'fetch-models-loading-copy';
          loadingCopy.textContent = strings.providerFetchModalLoading || '';
          loadingDiv.appendChild(loadingCopy);
          dom.fetchModelsModalList.appendChild(loadingDiv);
          if (dom.fetchModelsError) { dom.fetchModelsError.style.display = 'none'; }
          return;
        }

        if (fetchModelsLastError && dom.fetchModelsError && dom.retryFetchModelsBtn) {
          dom.fetchModelsError.style.display = '';
          dom.fetchModelsErrorText.textContent = fetchModelsLastError;
          dom.retryFetchModelsBtn.textContent = strings.providerFetchRetryAction || 'Retry';
        } else if (dom.fetchModelsError) {
          dom.fetchModelsError.style.display = 'none';
        }

        const allModels = mergeModels(fetchedModelsByProvider[provider.id] || [], 'fetched');
        if (!allModels.length) {
          // Safe: renderModelEmptyState escapes its content via escapeHtml()
          dom.fetchModelsModalList.innerHTML = renderModelEmptyState('providerFetchModalEmpty');
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
          // Safe: renderModelEmptyState escapes its content via escapeHtml()
          dom.fetchModelsModalList.innerHTML = renderModelEmptyState('providerFetchModalSearchEmpty');
          return;
        }

        const selectedIds = new Set(getSelectedModelIds(provider));
        // Safe: all user content escaped via escapeHtml()
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
