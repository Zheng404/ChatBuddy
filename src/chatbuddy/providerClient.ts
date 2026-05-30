/**
 * OpenAI 兼容 Provider 客户端。
 *
 * 统一的 AI 服务调用入口，支持 chat_completions 和 responses 两种 API 类型，
 * 适配 OpenAI、Gemini、OpenRouter、Ollama 和自定义端点。
 *
 * 提供流式和非流式两种调用模式，内置指数退避重试、HTTP 状态码错误处理、
 * 以及模型列表自动获取能力。
 */
import { getStrings, resolveLocale } from './i18n';
import { createModelRef, getModelDisplayLabel, parseModelRef } from './modelCatalog';
import { PROVIDER_LIMITS, TIMEOUT } from './constants';
import { MAX_CONTEXT_COUNT } from './stateSanitizers';
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
  extractGeminiStreamDelta,
  extractResponsesResult,
  extractResponsesStreamEvent,
  parseGeminiChatResult
} from './providerClientParsers';
import { fetchProviderModels, isOllamaProvider } from './providerClientModelFetchers';
import {
  createHeaders,
  normalizeBaseUrl,
  toChatCompletionBody,
  toGeminiBody,
  toResponsesBody
} from './providerClientRequestBuilders';
import {
  ProviderChatResult,
  ProviderConnectionInput,
  ProviderRequestOptions,
  ProviderResolveMeta,
  StreamHandlers
} from './providerClientTypes';
import { clamp, resolveLocaleString, retryWithBackoff, warn } from './utils';

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
      ? `请求失败（${response.status}）：${text.slice(0, PROVIDER_LIMITS.ERROR_RESPONSE_TRUNCATE_LENGTH)}`
      : `Request failed (${response.status}): ${text.slice(0, PROVIDER_LIMITS.ERROR_RESPONSE_TRUNCATE_LENGTH)}`;
  throw new HttpError(response.status, toErrorMessage(response.status, fallback, locale));
}

/**
 * 根据助手配置解析提供商配置（含参数 clamp 和 override 处理）。
 * @param settings - 全局设置
 * @param assistant - 助手配置
 * @returns 解析后的 ProviderConfig 和元信息
 */
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
    maxTokens: clamp(assistant.maxTokens ?? settings.maxTokens, 0, PROVIDER_LIMITS.MAX_TOKENS, settings.maxTokens),
    contextCount: clamp(assistant.contextCount ?? PROVIDER_LIMITS.DEFAULT_CONTEXT_COUNT, 0, MAX_CONTEXT_COUNT, PROVIDER_LIMITS.DEFAULT_CONTEXT_COUNT),
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
    timeoutMs: settings.timeoutMs === 0 ? 0 : clamp(settings.timeoutMs, TIMEOUT.MIN_MS, TIMEOUT.MAX_MS, TIMEOUT.DEFAULT_MS),
    topK: assistant.topK,
    stopSequences: assistant.stopSequences?.length ? assistant.stopSequences : undefined,
    seed: assistant.seed,
    responseFormat: assistant.responseFormat,
    toolChoice: assistant.toolChoice,
    geminiSafetyLevel: assistant.geminiSafetyLevel
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

/**
 * 根据模型绑定解析提供商配置（用于故障转移链等场景）。
 * @param settings - 全局设置
 * @param binding - 模型绑定信息
 * @param overrides - 可选的参数覆盖
 * @returns 解析后的 ProviderConfig 和元信息
 */
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
    maxTokens: clamp(overrides?.maxTokens ?? settings.maxTokens, 0, PROVIDER_LIMITS.MAX_TOKENS, settings.maxTokens),
    contextCount: clamp(overrides?.contextCount ?? PROVIDER_LIMITS.DEFAULT_CONTEXT_COUNT, 0, Number.MAX_SAFE_INTEGER, PROVIDER_LIMITS.DEFAULT_CONTEXT_COUNT),
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
    timeoutMs: (overrides?.timeoutMs ?? settings.timeoutMs) === 0 ? 0 : clamp(overrides?.timeoutMs ?? settings.timeoutMs, TIMEOUT.MIN_MS, TIMEOUT.MAX_MS, TIMEOUT.DEFAULT_MS)
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

/**
 * OpenAI 兼容 AI Provider 客户端。
 *
 * 统一的 AI 服务调用入口，支持 chat_completions、responses 和 gemini 三种 API 类型，
 * 提供非流式和流式两种调用模式，内置指数退避重试和 HTTP 错误处理。
 */
export class OpenAICompatibleClient {
  /**
   * 发送非流式聊天请求。
   * @param messages - 消息列表
   * @param providerConfig - 解析后的提供商配置
   * @param locale - 运行时语言
   * @param signal - 可选的 AbortSignal 用于取消请求
   * @param options - 可选的请求选项（如工具配置）
   * @returns 聊天结果
   * @throws {HttpError} 当 HTTP 请求失败时抛出
   */
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
    if (providerConfig.apiType === 'gemini') {
      return this.gemini(messages, providerConfig, locale, signal, options);
    }
    return this.chatCompletions(messages, providerConfig, locale, signal, options);
  }

  /**
   * 发送流式聊天请求。
   * @param messages - 消息列表
   * @param providerConfig - 解析后的提供商配置
   * @param handlers - 流式处理回调（onDelta, onReasoningDelta, onDone）
   * @param locale - 运行时语言
   * @param signal - 可选的 AbortSignal 用于取消请求
   * @param options - 可选的请求选项（如工具配置）
   * @returns Promise，流结束后 resolve
   * @throws {HttpError} 当 HTTP 请求失败时抛出
   */
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
    if (providerConfig.apiType === 'gemini') {
      await this.geminiStream(messages, providerConfig, handlers, locale, signal, options);
      return;
    }
    await this.chatCompletionsStream(messages, providerConfig, handlers, locale, signal, options);
  }

  /**
   * 测试与提供商的连接是否可用。
   * @param provider - 提供商连接输入信息
   * @param locale - 运行时语言
   * @param signal - 可选的 AbortSignal 用于取消请求
   * @returns Promise，连接测试完成后 resolve
   * @throws {HttpError} 当连接失败时抛出
   */
  public async testConnection(
    provider: ProviderConnectionInput,
    locale: RuntimeLocale,
    signal?: AbortSignal
  ): Promise<void> {
    const resolvedModelId = provider.modelId?.trim()
      || PROVIDER_LIMITS.DEFAULT_TEST_MODELS_BY_KIND[provider.kind]
      || PROVIDER_LIMITS.DEFAULT_TEST_MODEL;
    const config: ProviderConfig = {
      providerId: provider.id,
      providerKind: provider.kind,
      providerName: provider.name,
      apiType: provider.apiType,
      apiKey: provider.apiKey.trim(),
      baseUrl: provider.baseUrl.trim(),
      modelId: resolvedModelId,
      modelRef: createModelRef(provider.id, resolvedModelId),
      modelLabel: resolvedModelId,
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

  /**
   * 获取提供商支持的模型列表。
   * @param provider - 提供商连接输入信息
   * @param locale - 运行时语言
   * @param signal - 可选的 AbortSignal 用于取消请求
   * @returns 模型配置列表
   * @throws {Error} 当获取失败时抛出
   */
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
    }, { signal });
  }

  private async consumeSseResponse(
    response: Response,
    locale: RuntimeLocale,
    onPayload: (payload: unknown) => boolean | void,
    onDone: () => void,
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<void> {
    if (!response.body) {
      throw new Error(resolveLocaleString(locale, '服务端未返回可读流。', 'The server did not return a readable stream.'));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    // SSE per-read timeout: independent from overall request timeout.
    // Use the larger of the caller-supplied timeout or 120s to avoid killing
    // long-running streams (e.g. reasoning models with thinking pauses).
    const SSE_READ_TIMEOUT_MS = 120_000;
    const readTimeout = Math.max(
      (timeoutMs && timeoutMs > 0 ? timeoutMs : 0),
      SSE_READ_TIMEOUT_MS
    );
    const readWithTimeout = () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(resolveLocaleString(locale, 'SSE 读取超时。', 'SSE read timeout.'))),
          readTimeout
        );
      });
      const promises: Array<Promise<unknown>> = [reader.read(), timeoutPromise];
      // 将 abort signal 纳入竞态，确保用户取消时立即中断读取
      if (signal) {
        const abortPromise = new Promise<never>((_, reject) => {
          if (signal.aborted) { reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); return; }
          signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')), { once: true });
        });
        promises.push(abortPromise);
      }
      return Promise.race(promises).finally(() => {
        if (timer) clearTimeout(timer);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as Promise<any>;
    };
    try {
      let readResult = await readWithTimeout();
      while (!readResult.done) {
        buffer += decoder.decode(readResult.value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        if (buffer.length > 10 * 1024 * 1024) {
          throw new Error('SSE response buffer exceeded maximum size');
        }
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
            console.warn('[ChatBuddy] Invalid SSE chunk:', payload.substring(0, 100));
          }
        }
        readResult = await readWithTimeout();
      }
      onDone();
    } finally {
      try {
        await reader.cancel();
      } catch (err) {
        warn('Error cancelling reader:', err);
      }
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
    return extractChatCompletionResult(
      response.status === 204 || response.headers.get('content-length') === '0'
        ? {}
        : await response.json()
    );
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
    return extractResponsesResult(
      response.status === 204 || response.headers.get('content-length') === '0'
        ? {}
        : await response.json()
    );
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
      handlers.onDone,
      providerConfig.timeoutMs,
      signal
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
      handlers.onDone,
      providerConfig.timeoutMs,
      signal
    );
  }

  private async postGeminiJson(
    providerConfig: ProviderConfig,
    endpoint: 'generateContent' | 'streamGenerateContent',
    body: Record<string, unknown>,
    locale: RuntimeLocale,
    signal?: AbortSignal
  ): Promise<Response> {
    const provider = this.toProviderConnectionInput(providerConfig);
    const base = normalizeBaseUrl(providerConfig.baseUrl);
    const url = endpoint === 'streamGenerateContent'
      ? `${base}/models/${encodeURIComponent(providerConfig.modelId)}:streamGenerateContent?alt=sse`
      : `${base}/models/${encodeURIComponent(providerConfig.modelId)}:generateContent`;
    return retryWithBackoff(async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: createHeaders(provider),
        body: JSON.stringify(body),
        signal
      });
      await ensureSuccess(response, locale);
      return response;
    }, { signal });
  }

  private async gemini(
    messages: ProviderMessage[],
    providerConfig: ProviderConfig,
    locale: RuntimeLocale,
    signal?: AbortSignal,
    options: ProviderRequestOptions = {}
  ): Promise<ProviderChatResult> {
    const response = await this.postGeminiJson(
      providerConfig,
      'generateContent',
      toGeminiBody(messages, providerConfig, false, options.tools ?? [], options.toolRounds ?? []),
      locale,
      signal
    );
    return parseGeminiChatResult(
      response.status === 204 || response.headers.get('content-length') === '0'
        ? {}
        : await response.json()
    );
  }

  private async geminiStream(
    messages: ProviderMessage[],
    providerConfig: ProviderConfig,
    handlers: StreamHandlers,
    locale: RuntimeLocale,
    signal?: AbortSignal,
    options: ProviderRequestOptions = {}
  ): Promise<void> {
    const response = await this.postGeminiJson(
      providerConfig,
      'streamGenerateContent',
      toGeminiBody(messages, providerConfig, true, options.tools ?? [], options.toolRounds ?? []),
      locale,
      signal
    );
    await this.consumeSseResponse(
      response,
      locale,
      (payload) => {
        const delta = extractGeminiStreamDelta(payload);
        if (delta.textDelta) {
          handlers.onDelta(delta.textDelta);
        }
        if (delta.reasoningDelta) {
          handlers.onReasoningDelta?.(delta.reasoningDelta);
        }
        return false;
      },
      handlers.onDone,
      providerConfig.timeoutMs,
      signal
    );
  }
}

/**
 * 解析助手的故障转移链配置。
 * @param settings - 全局设置
 * @param assistant - 助手配置
 * @returns 按优先级排序的 ProviderConfig 和元信息数组
 */
export function resolveFailoverChain(
  settings: ChatBuddySettings,
  assistant: AssistantProfile
): { config: ProviderConfig; meta: ProviderResolveMeta }[] {
  const chain: { config: ProviderConfig; meta: ProviderResolveMeta }[] = [];
  const seenRefs = new Set<string>();

  const primary = resolveProviderConfig(settings, assistant);
  if (!seenRefs.has(primary.config.modelRef)) {
    chain.push(primary);
    seenRefs.add(primary.config.modelRef);
  }

  if (!assistant.failoverModelRefs || assistant.failoverModelRefs.length === 0) {
    return chain;
  }

  for (const modelRef of assistant.failoverModelRefs) {
    const ref = modelRef.trim();
    if (!ref || seenRefs.has(ref)) {
      continue;
    }
    const parsed = parseModelRef(ref);
    if (!parsed) {
      continue;
    }
    const provider = settings.providers.find((p) => p.id === parsed.providerId);
    const model = provider?.models.find((m) => m.id === parsed.modelId);
    const config: ProviderConfig = {
      providerId: parsed.providerId,
      providerKind: provider?.kind ?? 'custom',
      providerName: provider?.name ?? parsed.providerId,
      apiType: provider?.apiType ?? 'chat_completions',
      apiKey: (provider?.apiKey ?? '').trim(),
      baseUrl: (provider?.baseUrl ?? '').trim(),
      modelId: parsed.modelId,
      modelRef: ref,
      modelLabel: model ? getModelDisplayLabel(model.id, provider?.name ?? parsed.providerId) : ref,
      temperature: clamp(
        assistant.overrides?.temperature ?? assistant.temperature ?? settings.temperature,
        0,
        2,
        settings.temperature
      ),
      topP: clamp(assistant.topP ?? settings.topP, 0, 1, settings.topP),
      maxTokens: clamp(assistant.maxTokens ?? settings.maxTokens, 0, PROVIDER_LIMITS.MAX_TOKENS, settings.maxTokens),
      contextCount: clamp(assistant.contextCount ?? PROVIDER_LIMITS.DEFAULT_CONTEXT_COUNT, 0, MAX_CONTEXT_COUNT, PROVIDER_LIMITS.DEFAULT_CONTEXT_COUNT),
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
      timeoutMs: settings.timeoutMs === 0 ? 0 : clamp(settings.timeoutMs, TIMEOUT.MIN_MS, TIMEOUT.MAX_MS, TIMEOUT.DEFAULT_MS),
      topK: assistant.topK,
      stopSequences: assistant.stopSequences?.length ? assistant.stopSequences : undefined,
      seed: assistant.seed,
      responseFormat: assistant.responseFormat,
      toolChoice: assistant.toolChoice,
      geminiSafetyLevel: assistant.geminiSafetyLevel
    };
    const meta: ProviderResolveMeta = {
      providerExists: !!provider,
      providerEnabled: provider?.enabled === true,
      modelExists: !!model
    };
    const locale = resolveLocale(settings.locale, 'en');
    if (!validateProviderConfig(config, locale, meta)) {
      chain.push({ config, meta });
      seenRefs.add(ref);
    }
  }

  return chain;
}

/**
 * 验证提供商配置是否完整可用。
 * @param config - 提供商配置
 * @param locale - 运行时语言
 * @param meta - 解析元信息
 * @returns 错误信息字符串，配置有效时返回 undefined
 */
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
