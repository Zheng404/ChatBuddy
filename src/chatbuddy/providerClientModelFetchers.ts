/**
 * Provider 模型列表获取模块。
 *
 * 支持从 OpenAI、Gemini、OpenRouter、Ollama 等 Provider 自动获取可用模型列表，
 * 包含各 Provider 特有的模型解析逻辑。
 */
import { ProviderModelProfile, RuntimeLocale } from './types';
import {
  parseGeminiModels,
  parseOllamaModels,
  parseStandardModelList
} from './providerClientParsers';
import { ProviderConnectionInput } from './providerClientTypes';
import {
  createHeaders,
  isGeminiProvider,
  isOllamaProvider,
  normalizeBaseUrl
} from './providerClientRequestBuilders';
import { ensureSuccess } from './providerClientErrors';
import { retryWithBackoff } from './utils';

async function fetchStandardModels(
  provider: ProviderConnectionInput,
  locale: RuntimeLocale,
  signal?: AbortSignal
): Promise<ProviderModelProfile[]> {
  return retryWithBackoff(async () => {
    const response = await fetch(`${normalizeBaseUrl(provider.baseUrl)}/models`, {
      method: 'GET',
      headers: createHeaders(provider, false),
      signal
    });
    await ensureSuccess(response, locale);
    return parseStandardModelList(
      response.status === 204 || response.headers.get('content-length') === '0'
        ? {}
        : await response.json()
    );
  }, { signal });
}

async function fetchGeminiModels(
  provider: ProviderConnectionInput,
  locale: RuntimeLocale,
  signal?: AbortSignal
): Promise<ProviderModelProfile[]> {
  return retryWithBackoff(async () => {
    const base = normalizeBaseUrl(provider.baseUrl).replace(/\/openai$/, '');
    const url = provider.apiKey.trim()
      ? `${base}/models?key=${encodeURIComponent(provider.apiKey.trim())}`
      : `${base}/models`;
    const response = await fetch(url, {
      method: 'GET',
      headers: createHeaders(provider, false),
      signal
    });
    await ensureSuccess(response, locale);
    return parseGeminiModels(
      response.status === 204 || response.headers.get('content-length') === '0'
        ? {}
        : await response.json()
    );
  }, { signal });
}

async function fetchOllamaModels(
  provider: ProviderConnectionInput,
  locale: RuntimeLocale,
  signal?: AbortSignal
): Promise<ProviderModelProfile[]> {
  return retryWithBackoff(async () => {
    // Bug 3: 先规范化 baseUrl，再判断是否已含 /api/tags，避免重复拼接
    let base = normalizeBaseUrl(provider.baseUrl).replace(/\/v1$/, '');
    if (!base.endsWith('/api/tags')) {
      base = `${base}/api/tags`;
    }
    const response = await fetch(base, {
      method: 'GET',
      headers: createHeaders(provider, false),
      signal
    });
    await ensureSuccess(response, locale);
    return parseOllamaModels(
      response.status === 204 || response.headers.get('content-length') === '0'
        ? {}
        : await response.json()
    );
  }, { signal });
}

export async function fetchProviderModels(
  provider: ProviderConnectionInput,
  locale: RuntimeLocale,
  signal?: AbortSignal
): Promise<ProviderModelProfile[]> {
  if (isOllamaProvider(provider)) {
    return fetchOllamaModels(provider, locale, signal);
  }
  if (isGeminiProvider(provider)) {
    return fetchGeminiModels(provider, locale, signal);
  }
  return fetchStandardModels(provider, locale, signal);
}

export { isGeminiProvider, isOllamaProvider };
