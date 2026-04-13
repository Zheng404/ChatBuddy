import { getStrings } from './i18n';
import { createModelRef, getModelDisplayLabel, parseModelRef } from './modelCatalog';
import { TIMEOUT } from './constants';
import {
  AssistantProfile,
  ChatBuddySettings,
  ModelBinding,
  ProviderConfig,
  ProviderMessage,
  ProviderModelProfile,
  RuntimeLocale
} from './types';
import {
  extractChatCompletionResult,
  extractChatCompletionsStreamDelta,
  extractResponsesResult,
  extractResponsesStreamEvent
} from './providerClientParsers';
import { fetchProviderModels, isOllamaProvider } from './providerClientModelFetchers';
import {
  createHeaders,
  normalizeBaseUrl,
  toChatCompletionBody,
  toResponsesBody
} from './providerClientRequestBuilders';
import {
  ProviderChatResult,
  ProviderConnectionInput,
  ProviderRequestOptions,
  ProviderResolveMeta,
  StreamHandlers
} from './providerClientTypes';
import { clamp, resolveLocaleString, retryWithBackoff } from './utils';

export type {
  ProviderChatResult,
  ProviderConnectionInput,
  ProviderRequestOptions,
  ProviderResolveMeta,
  ProviderToolRound,
  StreamHandlers
} from './providerClientTypes';

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

/** Error carrying the HTTP status code for retry logic. */
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

export function resolveProviderConfig(
  settings: ChatBuddySettings,
  assistant: AssistantProfile
): { config: ProviderConfig; meta: ProviderResolveMeta } {
  const parsed = parseModelRef(assistant.modelRef);
  const provider = settings.providers.find((item) => item.id === parsed?.providerId);
  const model = provider?.models.find((item) => item.id === parsed?.modelId);
  const providerId = parsed?.providerId ?? '';
  const modelId = parsed?.modelId ?? '';
  const config: ProviderConfig = {
    providerId,
    providerKind: provider?.kind ?? 'custom',
    providerName: provider?.name ?? providerId,
    apiType: provider?.apiType ?? 'chat_completions',
    apiKey: (assistant.overrides?.apiKey ?? provider?.apiKey ?? '').trim(),
    baseUrl: (assistant.overrides?.baseUrl ?? provider?.baseUrl ?? '').trim(),
    modelId: assistant.overrides?.model?.trim() || modelId,
    modelRef: assistant.modelRef.trim(),
    modelLabel: model ? getModelDisplayLabel(model.id, provider?.name ?? providerId) : assistant.modelRef.trim(),
    temperature: clamp(
      assistant.overrides?.temperature ?? assistant.temperature ?? settings.temperature,
      0,
      2,
      settings.temperature
    ),
    topP: clamp(assistant.topP ?? settings.topP, 0, 1, settings.topP),
    maxTokens: clamp(assistant.maxTokens ?? settings.maxTokens, 0, 65535, settings.maxTokens),
    contextCount: clamp(assistant.contextCount ?? 16, 0, Number.MAX_SAFE_INTEGER, 16),
    presencePenalty: clamp(
      assistant.presencePenalty ?? settings.presencePenalty,
      -2,
      2,
      settings.presencePenalty
    ),
    frequencyPenalty: clamp(
      assistant.frequencyPenalty ?? settings.frequencyPenalty,
      -2,
      2,
      settings.frequencyPenalty
    ),
    timeoutMs: clamp(settings.timeoutMs, TIMEOUT.MIN_MS, TIMEOUT.MAX_MS, TIMEOUT.DEFAULT_MS)
  };
  return {
    config,
    meta: {
      providerExists: !!provider,
      providerEnabled: provider?.enabled === true,
      modelExists: !!model
    }
  };
}

export function resolveModelBindingConfig(
  settings: ChatBuddySettings,
  binding: ModelBinding | undefined,
  overrides?: Partial<
    Pick<
      ProviderConfig,
      'temperature' | 'topP' | 'maxTokens' | 'contextCount' | 'presencePenalty' | 'frequencyPenalty' | 'timeoutMs'
    >
  >
): { config: ProviderConfig; meta: ProviderResolveMeta } {
  const providerId = binding?.providerId?.trim() || '';
  const modelId = binding?.modelId?.trim() || '';
  const provider = settings.providers.find((item) => item.id === providerId);
  const model = provider?.models.find((item) => item.id === modelId);
  const modelRef = providerId && modelId ? createModelRef(providerId, modelId) : '';
  const config: ProviderConfig = {
    providerId,
    providerKind: provider?.kind ?? 'custom',
    providerName: provider?.name ?? providerId,
    apiType: provider?.apiType ?? 'chat_completions',
    apiKey: (provider?.apiKey ?? '').trim(),
    baseUrl: (provider?.baseUrl ?? '').trim(),
    modelId,
    modelRef,
    modelLabel: model ? getModelDisplayLabel(model.id, provider?.name ?? providerId) : modelRef,
    temperature: clamp(overrides?.temperature ?? settings.temperature, 0, 2, settings.temperature),
    topP: clamp(overrides?.topP ?? settings.topP, 0, 1, settings.topP),
    maxTokens: clamp(overrides?.maxTokens ?? settings.maxTokens, 0, 65535, settings.maxTokens),
    contextCount: clamp(overrides?.contextCount ?? 16, 0, Number.MAX_SAFE_INTEGER, 16),
    presencePenalty: clamp(
      overrides?.presencePenalty ?? settings.presencePenalty,
      -2,
      2,
      settings.presencePenalty
    ),
    frequencyPenalty: clamp(
      overrides?.frequencyPenalty ?? settings.frequencyPenalty,
      -2,
      2,
      settings.frequencyPenalty
    ),
    timeoutMs: clamp(overrides?.timeoutMs ?? settings.timeoutMs, TIMEOUT.MIN_MS, TIMEOUT.MAX_MS, TIMEOUT.DEFAULT_MS)
  };
  return {
    config,
    meta: {
      providerExists: !!provider,
      providerEnabled: provider?.enabled === true,
      modelExists: !!model
    }
  };
}

export class OpenAICompatibleClient {
  public async chat(
    messages: ProviderMessage[],
    providerConfig: ProviderConfig,
    locale: RuntimeLocale,
    signal?: AbortSignal,
    options: ProviderRequestOptions = {}
  ): Promise<ProviderChatResult> {
    if (providerConfig.apiType === 'responses') {
      return this.responses(messages, providerConfig, locale, signal, options);
    }
    return this.chatCompletions(messages, providerConfig, locale, signal, options);
  }

  public async chatStream(
    messages: ProviderMessage[],
    providerConfig: ProviderConfig,
    handlers: StreamHandlers,
    locale: RuntimeLocale,
    signal?: AbortSignal,
    options: ProviderRequestOptions = {}
  ): Promise<void> {
    if (providerConfig.apiType === 'responses') {
      await this.responsesStream(messages, providerConfig, handlers, locale, signal, options);
      return;
    }
    await this.chatCompletionsStream(messages, providerConfig, handlers, locale, signal, options);
  }

  public async testConnection(
    provider: ProviderConnectionInput,
    locale: RuntimeLocale,
    signal?: AbortSignal
  ): Promise<void> {
    const config: ProviderConfig = {
      providerId: provider.id,
      providerKind: provider.kind,
      providerName: provider.name,
      apiType: provider.apiType,
      apiKey: provider.apiKey.trim(),
      baseUrl: provider.baseUrl.trim(),
      modelId: provider.modelId?.trim() || 'gpt-4o-mini',
      modelRef: createModelRef(provider.id, provider.modelId?.trim() || 'gpt-4o-mini'),
      modelLabel: provider.modelId?.trim() || 'gpt-4o-mini',
      temperature: 0,
      topP: 1,
      maxTokens: 1,
      contextCount: 1,
      presencePenalty: 0,
      frequencyPenalty: 0,
      timeoutMs: TIMEOUT.CONNECTION_TEST_MS
    };
    await this.chat(
      [
        {
          role: 'user',
          content: 'ping'
        }
      ],
      config,
      locale,
      signal
    );
  }

  public async fetchModels(
    provider: ProviderConnectionInput,
    locale: RuntimeLocale,
    signal?: AbortSignal
  ): Promise<ProviderModelProfile[]> {
    try {
      return await fetchProviderModels(provider, locale, signal);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(getStrings(locale).unknownError);
    }
  }

  private toProviderConnectionInput(providerConfig: ProviderConfig): ProviderConnectionInput {
    return {
      id: providerConfig.providerId,
      kind: providerConfig.providerKind,
      name: providerConfig.providerName,
      apiType: providerConfig.apiType,
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl
    };
  }

  private async postProviderJson(
    providerConfig: ProviderConfig,
    endpoint: '/chat/completions' | '/responses',
    body: Record<string, unknown>,
    locale: RuntimeLocale,
    signal?: AbortSignal
  ): Promise<Response> {
    const provider = this.toProviderConnectionInput(providerConfig);
    return retryWithBackoff(async () => {
      const response = await fetch(`${normalizeBaseUrl(providerConfig.baseUrl)}${endpoint}`, {
        method: 'POST',
        headers: createHeaders(provider),
        body: JSON.stringify(body),
        signal
      });
      await ensureSuccess(response, locale);
      return response;
    });
  }

  private async consumeSseResponse(
    response: Response,
    locale: RuntimeLocale,
    onPayload: (payload: unknown) => boolean | void,
    onDone: () => void
  ): Promise<void> {
    if (!response.body) {
      throw new Error(resolveLocaleString(locale, '服务端未返回可读流。', 'The server did not return a readable stream.'));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
      let readResult = await reader.read();
      while (!readResult.done) {
        buffer += decoder.decode(readResult.value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) {
            continue;
          }
          const payload = trimmed.slice('data:'.length).trim();
          if (payload === '[DONE]') {
            onDone();
            return;
          }
          if (!payload) {
            continue;
          }
          try {
            if (onPayload(JSON.parse(payload))) {
              onDone();
              return;
            }
          } catch {
            // Ignore invalid chunks from compatibility providers.
          }
        }
        readResult = await reader.read();
      }
      onDone();
    } finally {
      reader.releaseLock();
    }
  }

  private async chatCompletions(
    messages: ProviderMessage[],
    providerConfig: ProviderConfig,
    locale: RuntimeLocale,
    signal?: AbortSignal,
    options: ProviderRequestOptions = {}
  ): Promise<ProviderChatResult> {
    const response = await this.postProviderJson(
      providerConfig,
      '/chat/completions',
      toChatCompletionBody(messages, providerConfig, false, options.tools ?? [], options.toolRounds ?? []),
      locale,
      signal
    );
    return extractChatCompletionResult(await response.json());
  }

  private async responses(
    messages: ProviderMessage[],
    providerConfig: ProviderConfig,
    locale: RuntimeLocale,
    signal?: AbortSignal,
    options: ProviderRequestOptions = {}
  ): Promise<ProviderChatResult> {
    const response = await this.postProviderJson(
      providerConfig,
      '/responses',
      toResponsesBody(messages, providerConfig, false, options.tools ?? [], options.toolRounds ?? []),
      locale,
      signal
    );
    return extractResponsesResult(await response.json());
  }

  private async chatCompletionsStream(
    messages: ProviderMessage[],
    providerConfig: ProviderConfig,
    handlers: StreamHandlers,
    locale: RuntimeLocale,
    signal?: AbortSignal,
    options: ProviderRequestOptions = {}
  ): Promise<void> {
    const response = await this.postProviderJson(
      providerConfig,
      '/chat/completions',
      toChatCompletionBody(messages, providerConfig, true, options.tools ?? [], options.toolRounds ?? []),
      locale,
      signal
    );
    await this.consumeSseResponse(
      response,
      locale,
      (payload) => {
        const delta = extractChatCompletionsStreamDelta(payload);
        if (delta.textDelta) {
          handlers.onDelta(delta.textDelta);
        }
        if (delta.reasoningDelta) {
          handlers.onReasoningDelta?.(delta.reasoningDelta);
        }
        return false;
      },
      handlers.onDone
    );
  }

  private async responsesStream(
    messages: ProviderMessage[],
    providerConfig: ProviderConfig,
    handlers: StreamHandlers,
    locale: RuntimeLocale,
    signal?: AbortSignal,
    options: ProviderRequestOptions = {}
  ): Promise<void> {
    const response = await this.postProviderJson(
      providerConfig,
      '/responses',
      toResponsesBody(messages, providerConfig, true, options.tools ?? [], options.toolRounds ?? []),
      locale,
      signal
    );
    await this.consumeSseResponse(
      response,
      locale,
      (payload) => {
        const event = extractResponsesStreamEvent(payload);
        if (event.textDelta) {
          handlers.onDelta(event.textDelta);
        }
        if (event.reasoningDelta) {
          handlers.onReasoningDelta?.(event.reasoningDelta);
        }
        return event.done;
      },
      handlers.onDone
    );
  }
}

export function validateProviderConfig(
  config: ProviderConfig,
  locale: RuntimeLocale,
  meta: ProviderResolveMeta
): string | undefined {
  const strings = getStrings(locale);
  if (!meta.providerExists) {
    return strings.providerUnavailable;
  }
  if (!meta.providerEnabled) {
    return strings.providerDisabled;
  }
  if (!config.apiKey && !isOllamaProvider({ kind: config.providerKind, baseUrl: config.baseUrl })) {
    return strings.missingApiKey;
  }
  if (!config.baseUrl) {
    return strings.missingBaseUrl;
  }
  if (!config.modelId) {
    return strings.missingModel;
  }
  if (!meta.modelExists) {
    return strings.modelUnavailable;
  }
  return undefined;
}
