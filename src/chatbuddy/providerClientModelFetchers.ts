/**
 * Provider 模型列表获取模块。
 *
 * 支持从 OpenAI、Gemini、OpenRouter、Ollama 等 Provider 自动获取可用模型列表，
 * 包含各 Provider 特有的模型解析逻辑。
 */
import { getStrings } from './i18n';
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
import { retryWithBackoff } from './utils';

function toErrorMessage(status: number, fallback: string, locale: RuntimeLocale): string {
  const strings = getStrings(locale);
  if (status === 401) {
    return strings.authFailed;
  }
  if (status === 403) {
    return strings.accessDenied;
  }
  if (status === 429) {
    return strings.rateLimited;
  }
  if (status >= 500) {
    return strings.serviceUnavailable;
  }
  return fallback;
}

// 注意：HttpError 与 providerClient.ts 中的定义重复，因循环依赖无法共享。
// 若将来提取到共享模块（如 utils/httpError.ts），可消除此重复。
export class HttpError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

async function ensureSuccess(response: Response, locale: RuntimeLocale): Promise<void> {
  if (response.ok) {
    return;
  }
  const text = await response.text();
  const fallback =
    locale === 'zh-CN'
      ? `请求失败（${response.status}）：${text.slice(0, 160)}`
      : `Request failed (${response.status}): ${text.slice(0, 160)}`;
  throw new HttpError(response.status, toErrorMessage(response.status, fallback, locale));
}

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
    const base = normalizeBaseUrl(provider.baseUrl).replace(/\/v1$/, '');
    const response = await fetch(`${base}/api/tags`, {
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
