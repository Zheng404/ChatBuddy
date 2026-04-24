/**
 * Provider/model config editor state, accessors, and UI helpers for the settings center webview.
 * Data utilities in modelConfigState.ts, CRUD operations in modelConfigActions.ts.
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

      var PROVIDER_TEMPLATES = {
        openai: { kind: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiType: 'responses', description: 'GPT-4o, o1, o3 等模型，支持结构化输出和内置工具' },
        gemini: { kind: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiType: 'gemini', description: 'Gemini Pro, Gemini Flash 等模型' },
        openrouter: { kind: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiType: 'chat_completions', description: '聚合多家提供商的统一 API 网关' },
        ollama: { kind: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', apiType: 'chat_completions', description: '本地运行开源模型，如 Llama、Mistral' }
      };
`;
}
