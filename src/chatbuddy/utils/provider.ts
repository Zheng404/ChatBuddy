import { dedupeModels, normalizeApiType } from '../modelCatalog';
import { ProviderProfile } from '../types';

/**
 * 规范化 Provider 配置
 * @param provider Provider 配置
 */
export function normalizeProvider(provider: ProviderProfile): ProviderProfile {
  const normalizedKind =
    provider.kind === 'openai' ||
    provider.kind === 'gemini' ||
    provider.kind === 'openrouter' ||
    provider.kind === 'ollama'
      ? provider.kind
      : 'custom';
  return {
    id: provider.id.trim(),
    kind: normalizedKind,
    name: provider.name.trim(),
    apiKey: provider.apiKey.trim(),
    baseUrl: provider.baseUrl.trim(),
    apiType: normalizeApiType(provider.apiType),
    enabled: provider.enabled !== false,
    models: dedupeModels(provider.models ?? []),
    modelLastSyncedAt: typeof provider.modelLastSyncedAt === 'number' ? provider.modelLastSyncedAt : undefined
  };
}
