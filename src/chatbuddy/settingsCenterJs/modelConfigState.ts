/**
 * Provider/model data utilities, dirty tracking, and autosave for the settings center webview.
 * Pure data cloning, signature computation, change detection, and persist scheduling.
 */
export function getModelConfigStateJs(): string {
  return `
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
          apiType: provider.apiType === 'gemini' ? 'gemini' : provider.apiType === 'responses' ? 'responses' : 'chat_completions',
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
`;
}
