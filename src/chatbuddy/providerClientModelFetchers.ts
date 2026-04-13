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

function toErrorMessage(status: number, fallback: string, locale: RuntimeLocale): string {
  const strings = getStrings(locale);
  if (status === 401) {
    return strings.authFailed;
  }
  if (status === 429) {
    return strings.rateLimited;
  }
  if (status >= 500) {
    return strings.serviceUnavailable;
  }
  return fallback;
}

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
  const response = await fetch(`${normalizeBaseUrl(provider.baseUrl)}/models`, {
    method: 'GET',
    headers: createHeaders(provider, false),
    signal
  });
  await ensureSuccess(response, locale);
  return parseStandardModelList(await response.json());
}

async function fetchGeminiModels(
  provider: ProviderConnectionInput,
  locale: RuntimeLocale,
  signal?: AbortSignal
): Promise<ProviderModelProfile[]> {
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
  return parseGeminiModels(await response.json());
}

async function fetchOllamaModels(
  provider: ProviderConnectionInput,
  locale: RuntimeLocale,
  signal?: AbortSignal
): Promise<ProviderModelProfile[]> {
  const base = normalizeBaseUrl(provider.baseUrl).replace(/\/v1$/, '');
  const response = await fetch(`${base}/api/tags`, {
    method: 'GET',
    headers: createHeaders(provider, false),
    signal
  });
  await ensureSuccess(response, locale);
  return parseOllamaModels(await response.json());
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
