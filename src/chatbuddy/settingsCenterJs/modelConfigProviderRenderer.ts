/**
 * Provider list and field rendering for the settings center webview.
 */
export function getModelConfigProviderRendererJs(): string {
  return `
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
        dom.baseUrl.placeholder = (provider && provider.apiType === 'gemini') ? (strings.baseUrlPlaceholderGemini || 'https://generativelanguage.googleapis.com/v1beta') : (strings.baseUrlPlaceholder || 'https://api.openai.com/v1');
        dom.providerPanelTitle.textContent = provider ? (provider.name || strings.providerDraftName || '') : '';
        dom.providerEnabledCheckbox.checked = provider ? provider.enabled : false;
      }
`;
}
