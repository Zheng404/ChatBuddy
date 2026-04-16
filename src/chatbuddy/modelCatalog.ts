import { resolveCapabilities, resolveKind } from './modelCapabilities';
import {
  DefaultModelSettings,
  ModelBinding,
  ModelCapabilities,
  ModelKind,
  ProviderApiType,
  ProviderModelOption,
  ProviderModelProfile,
  ProviderProfile,
  ProviderModelSource,
  RuntimeStrings
} from './types';

export const DEFAULT_TITLE_SUMMARY_PROMPT =
  'Summarize the following conversation into a short title.\n' +
  '1. Use the same language as the user\n' +
  '2. No punctuation or special symbols\n' +
  '3. Maximum 10 characters\n' +
  '4. Reply with only the title text\n' +
  '5. Do not use reasoning or thinking process, output the title directly';

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

function normalizeModelSource(source: unknown, fallback: ProviderModelSource = 'manual'): ProviderModelSource {
  return source === 'fetched' ? 'fetched' : fallback;
}

function normalizeModelProfile(raw: Partial<ProviderModelProfile> | string): ProviderModelProfile | undefined {
  if (typeof raw === 'string') {
    const normalized = raw.trim();
    if (!normalized) {
      return undefined;
    }
    return {
      id: normalized,
      name: normalized,
      kind: resolveKind(normalized),
      capabilities: resolveCapabilities(normalized),
      source: 'manual'
    };
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) {
    return undefined;
  }
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
  const existingKind = typeof raw.kind === 'string' ? (raw.kind as ModelKind) : undefined;
  const rawCaps = typeof raw === 'object' ? (raw as Partial<ProviderModelProfile>).capabilities : undefined;
  const migratedCaps = stripLegacyCapabilityFields(rawCaps);
  return {
    id,
    name,
    kind: existingKind || resolveKind(id),
    capabilities: resolveCapabilities(id, migratedCaps),
    source: normalizeModelSource((raw as Partial<ProviderModelProfile>).source)
  };
}

function stripLegacyCapabilityFields(caps: ModelCapabilities | undefined): ModelCapabilities | undefined {
  if (!caps || typeof caps !== 'object') {
    return caps;
  }
  const cleaned: ModelCapabilities = {};
  if (caps.vision) { cleaned.vision = true; }
  if (caps.reasoning) { cleaned.reasoning = true; }
  if (caps.tools) { cleaned.tools = true; }
  if (caps.webSearch) { cleaned.webSearch = true; }
  return Object.keys(cleaned).length ? cleaned : undefined;
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
      // Skip non-chat models (embedding, rerank, image, video, audio) from chat model selectors
      if (model.kind && model.kind !== 'chat') {
        continue;
      }
      options.push({
        ref: createModelRef(provider.id, model.id),
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        label: getModelDisplayLabel(model.id, provider.name),
        kind: model.kind,
        capabilities: model.capabilities
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
    label: getModelDisplayLabel(model.id, provider.name),
    kind: model.kind,
    capabilities: model.capabilities
  };
}

export function createEmptyDefaultModels(): DefaultModelSettings {
  return {
    assistant: undefined,
    titleSummary: undefined,
    titleSummaryPrompt: undefined
  };
}

export function cloneDefaultModels(defaultModels: DefaultModelSettings): DefaultModelSettings {
  return {
    assistant: defaultModels.assistant ? { ...defaultModels.assistant } : undefined,
    titleSummary: defaultModels.titleSummary ? { ...defaultModels.titleSummary } : undefined,
    titleSummaryPrompt: defaultModels.titleSummaryPrompt
  };
}

export function capabilityLabelSuffix(caps: ModelCapabilities | undefined, strings: RuntimeStrings): string {
  if (!caps) {
    return '';
  }
  const tags: string[] = [];
  if (caps.vision) {
    tags.push(strings.capabilityVision);
  }
  if (caps.reasoning) {
    tags.push(strings.capabilityReasoning);
  }
  if (caps.tools) {
    tags.push(strings.capabilityTools);
  }
  if (caps.webSearch) {
    tags.push(strings.capabilityWebSearch);
  }
  return tags.length ? ' [' + tags.join(', ') + ']' : '';
}
