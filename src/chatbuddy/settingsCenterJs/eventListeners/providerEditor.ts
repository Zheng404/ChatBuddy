/**
 * Provider editor event listeners (search, fields, CRUD).
 */
export function getProviderEditorJs(): string {
  return `
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
        void handleProviderEnabledToggle(provider, target).catch((err) => {
          showToast((err && err.message) || String(err), 'error');
        });
      });

      dom.addProviderBtn.addEventListener('click', () => {
        openAddProviderModal();
      });

      dom.deleteProviderBtn.addEventListener('click', () => {
        void deleteProvider().catch((err) => {
          showToast((err && err.message) || String(err), 'error');
        });
      });

      dom.providerEnabledCheckbox.addEventListener('change', () => {
        const provider = getEditingProvider();
        if (!provider) return;
        void handleProviderEnabledToggle(provider, dom.providerEnabledCheckbox).catch((err) => {
          showToast((err && err.message) || String(err), 'error');
        });
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
          provider.apiType = dom.apiType.value === 'gemini' ? 'gemini' : dom.apiType.value === 'responses' ? 'responses' : 'chat_completions';
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

`;
}
