/**
 * Provider/model config core state management for the settings center webview.
 * Includes data utilities, dirty tracking, autosave, and provider CRUD.
 * Rendering and modal logic extracted to separate modules.
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
        if (capabilities.tools) {
          next.tools = true;
        }
        if (capabilities.webSearch) {
          next.webSearch = true;
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
        const result = {
          id: id,
          name: name,
          kind: model.kind || 'chat',
          capabilities: cloneCapabilities(model.capabilities),
          source: normalizeModelSource(model.source, fallbackSource || 'manual')
        };
        if (model.userKindOverride) {
          result.userKindOverride = model.userKindOverride;
        }
        if (model.userCapabilitiesOverride) {
          result.userCapabilitiesOverride = model.userCapabilitiesOverride;
        }
        return result;
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
              (model.kind || 'chat') +
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
          { key: 'tools', cls: 'cap-tools', label: runtimeState.strings.capabilityTools || '' },
          { key: 'webSearch', cls: 'cap-websearch', label: runtimeState.strings.capabilityWebSearch || '' }
        ];
      }

      function getKindLabel(kind) {
        var strings = runtimeState.strings || {};
        switch (kind) {
          case 'chat': return strings.modelKindChat || 'Text';
          case 'image': return strings.modelKindImage || 'Image';
          case 'video': return strings.modelKindVideo || 'Video';
          case 'audio': return strings.modelKindAudio || 'Audio';
          case 'embedding': return strings.modelKindEmbedding || 'Embedding';
          case 'rerank': return strings.modelKindRerank || 'Rerank';
          default: return '';
        }
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
        closeDiscardChangesModal(false);
      }

      function buildModelSelectOptions(includeInvalidRef) {
        const strings = runtimeState.strings || {};
        const options = [{ ref: '', label: strings.noneOption || '' }]
          .concat((runtimeState.modelOptions || []).map((option) => {
            return {
              ref: option.ref,
              label: option.label + (option.metaLabel || '')
            };
          }));
        if (includeInvalidRef) {
          options.push({ ref: includeInvalidRef, label: includeInvalidRef + ' (' + strings.modelUnavailableShort + ')' });
        }
        const seen = new Set();
        return options
          .filter((option) => {
            if (seen.has(option.ref)) {
              return false;
            }
            seen.add(option.ref);
            return true;
          })
          .map((option) => '<option value="' + escapeHtml(option.ref) + '">' + escapeHtml(option.label) + '</option>')
          .join('');
      }
`;
}
