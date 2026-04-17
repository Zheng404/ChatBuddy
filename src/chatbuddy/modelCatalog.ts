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
  const rawObj = raw as Partial<ProviderModelProfile>;
  // User overrides are the ONLY persisted kind/capabilities we trust.
  // Everything else is resolved fresh from registry/patterns at load time.
  const userKindOverride = rawObj.userKindOverride;
  const userCapabilitiesOverride = rawObj.userCapabilitiesOverride;
  const resolvedKind = userKindOverride || resolveKind(id);
  const resolvedCapabilities = resolveCapabilities(id, userCapabilitiesOverride);
  const result: ProviderModelProfile = {
    id,
    name,
    kind: resolvedKind,
    capabilities: resolvedCapabilities,
    source: normalizeModelSource(rawObj.source)
  };
  // Preserve user overrides for next save cycle
  if (userKindOverride) {
    result.userKindOverride = userKindOverride;
  }
  if (userCapabilitiesOverride) {
    result.userCapabilitiesOverride = userCapabilitiesOverride;
  }
  return result;
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

export function getProviderModelOptions(
  providers: ProviderProfile[],
  includeDisabled = false,
  strings?: Record<string, string>
): ProviderModelOption[] {
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
        label: getModelDisplayLabel(model.id, provider.name),
        kind: model.kind,
        capabilities: model.capabilities,
        metaLabel: buildMetaLabel(model.kind, model.capabilities, strings)
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

/**
 * Build a display suffix like "[Text | Vision, Tools]" for model dropdowns.
 * Format: [kind | cap1, cap2] — kind omitted when chat, caps omitted when none.
 */
function buildMetaLabel(
  kind: ModelKind | undefined,
  caps: ModelCapabilities | undefined,
  strings?: Record<string, string>
): string {
  let kindLabel = '';
  const effectiveKind = kind || 'chat';
  if (strings) {
    kindLabel = strings['modelKind' + effectiveKind.charAt(0).toUpperCase() + effectiveKind.slice(1)] || '';
  }
  const capParts: string[] = [];
  if (caps && strings) {
    if (caps.vision) { capParts.push(strings.capabilityVision || ''); }
    if (caps.reasoning) { capParts.push(strings.capabilityReasoning || ''); }
    if (caps.tools) { capParts.push(strings.capabilityTools || ''); }
    if (caps.webSearch) { capParts.push(strings.capabilityWebSearch || ''); }
  }
  const capStr = capParts.filter(Boolean).join(', ');
  const inner = [kindLabel, capStr].filter(Boolean).join(' | ');
  return inner ? ' [' + inner + ']' : '';
}
