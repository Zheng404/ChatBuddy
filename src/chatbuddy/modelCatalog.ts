import {
  DefaultModelSettings,
  ModelBinding,
  ProviderApiType,
  ProviderModelOption,
  ProviderModelProfile,
  ProviderProfile
} from './types';

export function normalizeApiType(value: unknown, fallback: ProviderApiType = 'chat_completions'): ProviderApiType {
  return value === 'responses' || value === 'chat_completions' ? value : fallback;
}

export function createModelRef(providerId: string, modelId: string): string {
  return `${providerId.trim()}:${modelId.trim()}`;
}

export function parseModelRef(modelRef: string | undefined): ModelBinding | undefined {
  if (!modelRef) {
    return undefined;
  }
  const index = modelRef.indexOf(':');
  if (index <= 0 || index === modelRef.length - 1) {
    return undefined;
  }
  return {
    providerId: modelRef.slice(0, index).trim(),
    modelId: modelRef.slice(index + 1).trim()
  };
}

export function getModelDisplayLabel(modelId: string, providerName: string): string {
  return `${modelId} | ${providerName}`;
}

function normalizeModelProfile(raw: Partial<ProviderModelProfile> | string): ProviderModelProfile | undefined {
  if (typeof raw === 'string') {
    const normalized = raw.trim();
    if (!normalized) {
      return undefined;
    }
    return {
      id: normalized,
      name: normalized
    };
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) {
    return undefined;
  }
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
  return {
    id,
    name
  };
}

export function dedupeModels(models: Array<Partial<ProviderModelProfile> | string>): ProviderModelProfile[] {
  const byId = new Map<string, ProviderModelProfile>();
  for (const raw of models) {
    const normalized = normalizeModelProfile(raw);
    if (!normalized) {
      continue;
    }
    byId.set(normalized.id, normalized);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id, 'en'));
}

export function getProviderModelOptions(providers: ProviderProfile[], includeDisabled = false): ProviderModelOption[] {
  const options: ProviderModelOption[] = [];
  for (const provider of providers) {
    if (!includeDisabled && !provider.enabled) {
      continue;
    }
    for (const model of provider.models) {
      options.push({
        ref: createModelRef(provider.id, model.id),
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        label: getModelDisplayLabel(model.id, provider.name)
      });
    }
  }
  return options.sort((left, right) => left.label.localeCompare(right.label, 'en'));
}

function findProviderById(providers: ProviderProfile[], providerId: string | undefined): ProviderProfile | undefined {
  if (!providerId) {
    return undefined;
  }
  return providers.find((provider) => provider.id === providerId);
}

export function resolveModelOption(
  providers: ProviderProfile[],
  modelRef: string | undefined
): ProviderModelOption | undefined {
  const parsed = parseModelRef(modelRef);
  if (!parsed) {
    return undefined;
  }
  const provider = findProviderById(providers, parsed.providerId);
  if (!provider) {
    return undefined;
  }
  const model = provider.models.find((item) => item.id === parsed.modelId);
  if (!model) {
    return undefined;
  }
  return {
    ref: createModelRef(provider.id, model.id),
    providerId: provider.id,
    providerName: provider.name,
    modelId: model.id,
    label: getModelDisplayLabel(model.id, provider.name)
  };
}

export function createEmptyDefaultModels(): DefaultModelSettings {
  return {
    assistant: undefined
  };
}

export function cloneDefaultModels(defaultModels: DefaultModelSettings): DefaultModelSettings {
  return {
    assistant: defaultModels.assistant ? { ...defaultModels.assistant } : undefined
  };
}
