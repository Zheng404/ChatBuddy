import { getStrings } from './i18n';
import { hasAnyCapability } from './modelCapabilities';
import { createModelRef, getModelDisplayLabel, parseModelRef } from './modelCatalog';
import {
  AssistantProfile,
  ChatBuddySettings,
  ModelBinding,
  ModelCapabilities,
  ProviderApiType,
  ProviderConfig,
  ProviderKind,
  ProviderMessage,
  ProviderModelProfile,
  RuntimeLocale
} from './types';

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
  onDone: () => void;
}

export interface ProviderChatResult {
  text: string;
  reasoning?: string;
}

export interface ProviderResolveMeta {
  providerExists: boolean;
  providerEnabled: boolean;
  modelExists: boolean;
}

export interface ProviderConnectionInput {
  id: string;
  kind: ProviderKind;
  name: string;
  apiType: ProviderApiType;
  apiKey: string;
  baseUrl: string;
  modelId?: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

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

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function normalizeBaseUrlForDetect(baseUrl: string | undefined): string {
  return String(baseUrl || '').trim().toLowerCase();
}

function isGeminiProvider(provider: Pick<ProviderConnectionInput, 'kind' | 'baseUrl'>): boolean {
  const baseUrl = normalizeBaseUrlForDetect(provider.baseUrl);
  if (baseUrl.includes('generativelanguage.googleapis.com')) {
    return true;
  }
  if (baseUrl.includes('/v1beta/openai')) {
    return true;
  }
  return provider.kind === 'gemini' && baseUrl.length === 0;
}

function isOllamaProvider(provider: Pick<ProviderConnectionInput, 'kind' | 'baseUrl'>): boolean {
  const baseUrl = normalizeBaseUrlForDetect(provider.baseUrl);
  if (!baseUrl) {
    return provider.kind === 'ollama';
  }
  if (
    baseUrl.includes(':11434') ||
    baseUrl.includes('/api/tags') ||
    baseUrl.includes('localhost:11434') ||
    baseUrl.includes('127.0.0.1:11434')
  ) {
    return true;
  }
  return false;
}

function createHeaders(provider: ProviderConnectionInput, json = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) {
    headers['Content-Type'] = 'application/json';
  }
  if (provider.apiKey.trim()) {
    if (isGeminiProvider(provider)) {
      headers.Authorization = `Bearer ${provider.apiKey.trim()}`;
      headers['x-goog-api-key'] = provider.apiKey.trim();
    } else {
      headers.Authorization = `Bearer ${provider.apiKey.trim()}`;
    }
  }
  return headers;
}

function toChatCompletionBody(messages: ProviderMessage[], providerConfig: ProviderConfig, stream: boolean) {
  const body: Record<string, unknown> = {
    model: providerConfig.modelId,
    temperature: providerConfig.temperature,
    top_p: providerConfig.topP,
    presence_penalty: providerConfig.presencePenalty,
    frequency_penalty: providerConfig.frequencyPenalty,
    stream,
    messages
  };
  if (providerConfig.maxTokens > 0) {
    body.max_tokens = providerConfig.maxTokens;
  }
  return body;
}

function toResponsesBody(messages: ProviderMessage[], providerConfig: ProviderConfig, stream: boolean) {
  const input = messages.map((message) => ({
    role: message.role,
    content: [
      {
        type: 'input_text',
        text: message.content
      }
    ]
  }));
  const body: Record<string, unknown> = {
    model: providerConfig.modelId,
    input,
    temperature: providerConfig.temperature,
    top_p: providerConfig.topP,
    presence_penalty: providerConfig.presencePenalty,
    frequency_penalty: providerConfig.frequencyPenalty,
    stream
  };
  if (providerConfig.maxTokens > 0) {
    body.max_output_tokens = providerConfig.maxTokens;
  }
  return body;
}

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value);
}

function isDataImageUrl(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(value);
}

function isDataVideoUrl(value: string): boolean {
  return /^data:video\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(value);
}

function looksLikeBase64(value: string): boolean {
  const normalized = value.replace(/\s+/g, '');
  if (normalized.length < 64 || normalized.length % 4 !== 0) {
    return false;
  }
  return /^[a-z0-9+/]+=*$/i.test(normalized);
}

function toImageSource(value: unknown, typeHint = '', depth = 0): string | undefined {
  if (depth > 4) {
    return undefined;
  }
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (!candidate) {
      return undefined;
    }
    if (isHttpUrl(candidate) || isDataImageUrl(candidate)) {
      return candidate;
    }
    if (typeHint.includes('image') && looksLikeBase64(candidate)) {
      return `data:image/png;base64,${candidate.replace(/\s+/g, '')}`;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const payload = value as {
    type?: string;
    kind?: string;
    url?: string;
    image_url?: string | { url?: string };
    imageUrl?: string | { url?: string };
    image?: unknown;
    b64_json?: string;
    base64?: string;
    data?: string;
    content?: unknown;
    output?: unknown;
    item?: unknown;
    items?: unknown;
    response?: unknown;
    images?: unknown;
    result?: string;
  };
  const nextHint = `${typeHint} ${toTrimmedString(payload.type).toLowerCase()} ${toTrimmedString(payload.kind).toLowerCase()}`.trim();

  const directUrl =
    toImageSource(payload.url, nextHint, depth + 1) ||
    toImageSource(payload.image_url, nextHint, depth + 1) ||
    toImageSource(payload.imageUrl, nextHint, depth + 1) ||
    toImageSource(payload.image, nextHint, depth + 1) ||
    toImageSource(
      (payload.image_url && typeof payload.image_url === 'object' ? payload.image_url.url : undefined) ??
        (payload.imageUrl && typeof payload.imageUrl === 'object' ? payload.imageUrl.url : undefined),
      nextHint,
      depth + 1
    );
  if (directUrl) {
    return directUrl;
  }

  const encodedSource =
    toImageSource(payload.b64_json, `${nextHint} image`, depth + 1) ||
    toImageSource(payload.base64, `${nextHint} image`, depth + 1) ||
    toImageSource(payload.data, `${nextHint} image`, depth + 1) ||
    toImageSource(payload.result, nextHint, depth + 1);
  if (encodedSource) {
    return encodedSource;
  }

  const nestedCandidates = [payload.content, payload.output, payload.item, payload.items, payload.response, payload.images];
  for (const candidate of nestedCandidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const source = toImageSource(item, nextHint, depth + 1);
        if (source) {
          return source;
        }
      }
      continue;
    }
    const source = toImageSource(candidate, nextHint, depth + 1);
    if (source) {
      return source;
    }
  }

  return undefined;
}

function toImageMarkdown(value: unknown, typeHint = ''): string | undefined {
  const source = toImageSource(value, typeHint.toLowerCase());
  if (!source) {
    return undefined;
  }
  return `![image](${source})`;
}

function toVideoSource(value: unknown, typeHint = '', depth = 0): string | undefined {
  if (depth > 4) {
    return undefined;
  }
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (!candidate) {
      return undefined;
    }
    if (isHttpUrl(candidate) || isDataVideoUrl(candidate)) {
      return candidate;
    }
    if (typeHint.includes('video') && looksLikeBase64(candidate)) {
      return `data:video/mp4;base64,${candidate.replace(/\s+/g, '')}`;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const payload = value as {
    type?: string;
    kind?: string;
    url?: string;
    video_url?: string | { url?: string };
    videoUrl?: string | { url?: string };
    video?: unknown;
    b64_json?: string;
    base64?: string;
    data?: string;
    content?: unknown;
    output?: unknown;
    item?: unknown;
    items?: unknown;
    response?: unknown;
    videos?: unknown;
    result?: string;
  };
  const nextHint = `${typeHint} ${toTrimmedString(payload.type).toLowerCase()} ${toTrimmedString(payload.kind).toLowerCase()}`.trim();

  const directUrl =
    toVideoSource(payload.url, nextHint, depth + 1) ||
    toVideoSource(payload.video_url, nextHint, depth + 1) ||
    toVideoSource(payload.videoUrl, nextHint, depth + 1) ||
    toVideoSource(payload.video, nextHint, depth + 1) ||
    toVideoSource(
      (payload.video_url && typeof payload.video_url === 'object' ? payload.video_url.url : undefined) ??
        (payload.videoUrl && typeof payload.videoUrl === 'object' ? payload.videoUrl.url : undefined),
      nextHint,
      depth + 1
    );
  if (directUrl) {
    return directUrl;
  }

  const encodedSource =
    toVideoSource(payload.b64_json, `${nextHint} video`, depth + 1) ||
    toVideoSource(payload.base64, `${nextHint} video`, depth + 1) ||
    toVideoSource(payload.data, `${nextHint} video`, depth + 1) ||
    toVideoSource(payload.result, nextHint, depth + 1);
  if (encodedSource) {
    return encodedSource;
  }

  const nestedCandidates = [payload.content, payload.output, payload.item, payload.items, payload.response, payload.videos];
  for (const candidate of nestedCandidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const source = toVideoSource(item, nextHint, depth + 1);
        if (source) {
          return source;
        }
      }
      continue;
    }
    const source = toVideoSource(candidate, nextHint, depth + 1);
    if (source) {
      return source;
    }
  }

  return undefined;
}

function toVideoMarkdown(value: unknown, typeHint = ''): string | undefined {
  const source = toVideoSource(value, typeHint.toLowerCase());
  if (!source) {
    return undefined;
  }
  return `![video](${source})`;
}

function appendChunk(chunks: string[], value: unknown): void {
  const text = toTrimmedString(value);
  if (text) {
    chunks.push(text);
  }
}

function joinChunks(chunks: string[]): string | undefined {
  const text = chunks.map((item) => item.trim()).filter(Boolean).join('\n').trim();
  return text || undefined;
}

function extractChatCompletionResult(data: unknown): ProviderChatResult {
  const payload = data as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string; value?: string; content?: string }>;
        reasoning?: string | Array<{ text?: string; value?: string }>;
        reasoning_content?: string | Array<{ text?: string; value?: string }>;
      };
    }>;
  };
  const message = payload.choices?.[0]?.message;
  if (!message) {
    return { text: '' };
  }

  const textChunks: string[] = [];
  const reasoningChunks: string[] = [];

  if (typeof message.content === 'string') {
    appendChunk(textChunks, message.content);
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (!part || typeof part !== 'object') {
        continue;
      }
      const partType = toTrimmedString(part.type).toLowerCase();
      const partText = toTrimmedString(part.text) || toTrimmedString(part.value) || toTrimmedString(part.content);
      if (!partText) {
        const imageMarkdown = toImageMarkdown(part, partType);
        if (imageMarkdown) {
          textChunks.push(imageMarkdown);
        }
        const videoMarkdown = toVideoMarkdown(part, partType);
        if (videoMarkdown) {
          textChunks.push(videoMarkdown);
        }
        continue;
      }
      if (partType.includes('reason')) {
        reasoningChunks.push(partText);
      } else {
        textChunks.push(partText);
      }
    }
  }

  if (typeof message.reasoning_content === 'string') {
    appendChunk(reasoningChunks, message.reasoning_content);
  } else if (Array.isArray(message.reasoning_content)) {
    for (const part of message.reasoning_content) {
      appendChunk(reasoningChunks, part?.text ?? part?.value);
    }
  }

  if (typeof message.reasoning === 'string') {
    appendChunk(reasoningChunks, message.reasoning);
  } else if (Array.isArray(message.reasoning)) {
    for (const part of message.reasoning) {
      appendChunk(reasoningChunks, part?.text ?? part?.value);
    }
  }

  return {
    text: joinChunks(textChunks) || '',
    reasoning: joinChunks(reasoningChunks)
  };
}

function extractResponsesResult(data: unknown): ProviderChatResult {
  if (!data || typeof data !== 'object') {
    return { text: '' };
  }
  const payload = data as {
    output_text?: string;
    output?: Array<{
      type?: string;
      text?: string;
      value?: string;
      summary?: Array<{ text?: string; value?: string }>;
      content?: Array<{ type?: string; text?: string; value?: string; content?: string }>;
    }>;
  };

  const textChunks: string[] = [];
  const reasoningChunks: string[] = [];

  if (typeof payload.output_text === 'string') {
    appendChunk(textChunks, payload.output_text);
  }

  for (const item of payload.output ?? []) {
    const itemType = toTrimmedString(item?.type).toLowerCase();
    const itemIsReasoning = itemType.includes('reason');
    const itemImage = toImageMarkdown(item, itemType);
    if (itemImage && !itemIsReasoning) {
      textChunks.push(itemImage);
    }
    const itemVideo = toVideoMarkdown(item, itemType);
    if (itemVideo && !itemIsReasoning) {
      textChunks.push(itemVideo);
    }

    for (const summary of item?.summary ?? []) {
      appendChunk(reasoningChunks, summary?.text ?? summary?.value);
    }

    if (Array.isArray(item?.content)) {
      for (const content of item.content) {
        const contentType = toTrimmedString(content?.type).toLowerCase();
        const contentIsReasoning = itemIsReasoning || contentType.includes('reason');
        const fragment =
          toTrimmedString(content?.text) || toTrimmedString(content?.value) || toTrimmedString(content?.content);
        if (!fragment) {
          const imageFragment = toImageMarkdown(content, contentType);
          if (imageFragment && !contentIsReasoning) {
            textChunks.push(imageFragment);
          }
          const videoFragment = toVideoMarkdown(content, contentType);
          if (videoFragment && !contentIsReasoning) {
            textChunks.push(videoFragment);
          }
          continue;
        }
        if (contentIsReasoning) {
          reasoningChunks.push(fragment);
        } else {
          textChunks.push(fragment);
        }
      }
    } else {
      const fragment = toTrimmedString(item?.text) || toTrimmedString(item?.value);
      if (!fragment) {
        continue;
      }
      if (itemIsReasoning) {
        reasoningChunks.push(fragment);
      } else {
        textChunks.push(fragment);
      }
    }
  }

  return {
    text: joinChunks(textChunks) || '',
    reasoning: joinChunks(reasoningChunks)
  };
}

type StreamDeltaResult = {
  textDelta: string;
  reasoningDelta: string;
};

function extractChatCompletionsStreamDelta(payload: unknown): StreamDeltaResult {
  const empty = { textDelta: '', reasoningDelta: '' };
  if (!payload || typeof payload !== 'object') {
    return empty;
  }

  const delta = (payload as { choices?: Array<{ delta?: unknown }> }).choices?.[0]?.delta as
    | {
        content?: string | Array<{ type?: string; text?: string; value?: string; content?: string }>;
        reasoning?: string;
        reasoning_content?: string;
      }
    | undefined;

  if (!delta || typeof delta !== 'object') {
    return empty;
  }

  let textDelta = '';
  let reasoningDelta = '';

  if (typeof delta.content === 'string') {
    textDelta = delta.content;
  } else if (Array.isArray(delta.content)) {
    for (const part of delta.content) {
      if (!part || typeof part !== 'object') {
        continue;
      }
      const partType = toTrimmedString(part.type).toLowerCase();
      const fragment = toTrimmedString(part.text) || toTrimmedString(part.value) || toTrimmedString(part.content);
      if (!fragment) {
        const imageFragment = toImageMarkdown(part, partType);
        if (imageFragment) {
          textDelta += imageFragment;
        }
        const videoFragment = toVideoMarkdown(part, partType);
        if (videoFragment) {
          textDelta += videoFragment;
        }
        continue;
      }
      if (partType.includes('reason')) {
        reasoningDelta += fragment;
      } else {
        textDelta += fragment;
      }
    }
  }

  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
    reasoningDelta += delta.reasoning_content;
  }
  if (typeof delta.reasoning === 'string' && delta.reasoning) {
    reasoningDelta += delta.reasoning;
  }

  return { textDelta, reasoningDelta };
}

type ResponsesStreamEvent = StreamDeltaResult & { done: boolean };

function extractResponsesStreamEvent(payload: unknown): ResponsesStreamEvent {
  const done = isResponsesDoneEvent(payload);
  if (!payload || typeof payload !== 'object') {
    return { textDelta: '', reasoningDelta: '', done };
  }

  const event = payload as {
    type?: string;
    delta?: string;
    text?: string;
    item?: unknown;
    output_item?: unknown;
    response?: unknown;
    output?: unknown;
  };
  const eventType = toTrimmedString(event.type).toLowerCase();
  const deltaText = typeof event.delta === 'string' ? event.delta : typeof event.text === 'string' ? event.text : '';

  const imageChunks = [
    toImageMarkdown(event.item, eventType),
    toImageMarkdown(event.output_item, eventType),
    toImageMarkdown(event.response, eventType),
    toImageMarkdown(event.output, eventType),
    toImageMarkdown(event, eventType)
  ].filter((item): item is string => Boolean(item));
  const imageDelta = imageChunks.join('\n');

  const videoChunks = [
    toVideoMarkdown(event.item, eventType),
    toVideoMarkdown(event.output_item, eventType),
    toVideoMarkdown(event.response, eventType),
    toVideoMarkdown(event.output, eventType),
    toVideoMarkdown(event, eventType)
  ].filter((item): item is string => Boolean(item));
  const videoDelta = videoChunks.join('\n');
  const mediaDelta = [imageDelta, videoDelta].filter(Boolean).join('\n');

  if (!deltaText && !mediaDelta) {
    return { textDelta: '', reasoningDelta: '', done };
  }

  if (eventType.includes('reason')) {
    return { textDelta: '', reasoningDelta: deltaText, done };
  }
  if (!deltaText) {
    return { textDelta: mediaDelta, reasoningDelta: '', done };
  }
  if (!mediaDelta) {
    return { textDelta: deltaText, reasoningDelta: '', done };
  }
  return {
    textDelta: `${deltaText}\n${mediaDelta}`,
    reasoningDelta: '',
    done
  };
}

function isResponsesDoneEvent(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const event = payload as { type?: string };
  return (
    event.type === 'response.completed' ||
    event.type === 'response.output_text.done' ||
    event.type === 'response.done'
  );
}

function extractCapabilitiesFromStandardModel(raw: Record<string, unknown>): ModelCapabilities | undefined {
  // OpenRouter-style: architecture.input_modalities + supported_parameters
  const architecture = raw.architecture as Record<string, unknown> | undefined;
  const inputModalities = Array.isArray(architecture?.input_modalities) ? architecture.input_modalities as string[] : [];
  const supportedParams = Array.isArray(raw.supported_parameters) ? raw.supported_parameters as string[] : [];
  const pricing = raw.pricing as Record<string, unknown> | undefined;

  if (inputModalities.length === 0 && supportedParams.length === 0 && !pricing?.internal_reasoning) {
    return undefined;
  }

  const caps: ModelCapabilities = {};
  if (inputModalities.some((m) => m === 'image')) {
    caps.vision = true;
  }
  if (inputModalities.some((m) => m === 'audio')) {
    caps.audio = true;
  }
  if (inputModalities.some((m) => m === 'video')) {
    caps.video = true;
  }
  if (supportedParams.some((p) => p === 'tools' || p === 'tool_choice' || p === 'function_calling')) {
    caps.tools = true;
  }
  if (pricing && typeof pricing.internal_reasoning === 'string' && pricing.internal_reasoning !== '0' && pricing.internal_reasoning !== '') {
    caps.reasoning = true;
  }

  return hasAnyCapability(caps) ? caps : undefined;
}

function parseStandardModelList(data: unknown): ProviderModelProfile[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const payload = data as { data?: Array<Record<string, unknown>>; models?: Array<Record<string, unknown>> };
  const result: ProviderModelProfile[] = [];
  for (const model of payload.data ?? []) {
    const id = typeof model.id === 'string' ? model.id.trim() : '';
    if (!id) {
      continue;
    }
    const name = typeof model.name === 'string' && model.name.trim() ? model.name.trim() : id;
    result.push({
      id,
      name,
      capabilities: extractCapabilitiesFromStandardModel(model)
    });
  }
  for (const model of payload.models ?? []) {
    const id = typeof model.id === 'string' ? (model.id as string).trim() : '';
    if (!id) {
      continue;
    }
    const name = typeof model.name === 'string' && (model.name as string).trim() ? (model.name as string).trim() : id;
    result.push({
      id,
      name,
      capabilities: extractCapabilitiesFromStandardModel(model)
    });
  }
  return result;
}

function extractCapabilitiesFromGeminiModel(raw: Record<string, unknown>): ModelCapabilities | undefined {
  const description = typeof raw.description === 'string' ? (raw.description as string).toLowerCase() : '';
  const caps: ModelCapabilities = {};
  if (description.includes('multimodal') || description.includes('vision') || description.includes('image')) {
    caps.vision = true;
  }
  return hasAnyCapability(caps) ? caps : undefined;
}

function parseGeminiModels(data: unknown): ProviderModelProfile[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const payload = data as { models?: Array<Record<string, unknown>> };
  const result: ProviderModelProfile[] = [];
  for (const model of payload.models ?? []) {
    const rawName = typeof model.name === 'string' ? (model.name as string).trim() : '';
    if (!rawName) {
      continue;
    }
    const id = rawName.startsWith('models/') ? rawName.slice('models/'.length) : rawName;
    if (!id) {
      continue;
    }
    const displayName = typeof model.displayName === 'string' && (model.displayName as string).trim() ? (model.displayName as string).trim() : id;
    result.push({
      id,
      name: displayName,
      capabilities: extractCapabilitiesFromGeminiModel(model)
    });
  }
  return result;
}

function extractCapabilitiesFromOllamaModel(raw: Record<string, unknown>): ModelCapabilities | undefined {
  const details = raw.details as Record<string, unknown> | undefined;
  const families = Array.isArray(details?.families) ? (details!.families as string[]) : [];
  const capabilities = details?.capabilities as Record<string, unknown> | undefined;
  const caps: ModelCapabilities = {};
  if (capabilities?.vision === true || families.some((f) => f.toLowerCase() === 'vision' || f.toLowerCase() === 'clip')) {
    caps.vision = true;
  }
  if (capabilities?.audio === true || families.some((f) => f.toLowerCase() === 'audio')) {
    caps.audio = true;
  }
  if (capabilities?.tools === true || families.some((f) => f.toLowerCase() === 'tool' || f.toLowerCase() === 'tools')) {
    caps.tools = true;
  }
  return hasAnyCapability(caps) ? caps : undefined;
}

function parseOllamaModels(data: unknown): ProviderModelProfile[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const payload = data as { models?: Array<Record<string, unknown>> };
  const result: ProviderModelProfile[] = [];
  for (const model of payload.models ?? []) {
    const id = typeof model.name === 'string' ? (model.name as string).trim() : typeof model.model === 'string' ? (model.model as string).trim() : '';
    if (!id) {
      continue;
    }
    result.push({
      id,
      name: id,
      capabilities: extractCapabilitiesFromOllamaModel(model)
    });
  }
  return result;
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
  throw new Error(toErrorMessage(response.status, fallback, locale));
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
    timeoutMs: clamp(settings.timeoutMs, 5000, 300000, 60000)
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
    timeoutMs: clamp(overrides?.timeoutMs ?? settings.timeoutMs, 5000, 300000, 60000)
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
    signal?: AbortSignal
  ): Promise<ProviderChatResult> {
    if (providerConfig.apiType === 'responses') {
      return this.responses(messages, providerConfig, locale, signal);
    }
    return this.chatCompletions(messages, providerConfig, locale, signal);
  }

  public async chatStream(
    messages: ProviderMessage[],
    providerConfig: ProviderConfig,
    handlers: StreamHandlers,
    locale: RuntimeLocale,
    signal?: AbortSignal
  ): Promise<void> {
    if (providerConfig.apiType === 'responses') {
      await this.responsesStream(messages, providerConfig, handlers, locale, signal);
      return;
    }
    await this.chatCompletionsStream(messages, providerConfig, handlers, locale, signal);
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
      timeoutMs: 30000
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
      if (isOllamaProvider(provider)) {
        return this.fetchOllamaModels(provider, locale, signal);
      }
      if (isGeminiProvider(provider)) {
        return this.fetchGeminiModels(provider, locale, signal);
      }
      return this.fetchStandardModels(provider, locale, signal);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(getStrings(locale).unknownError);
    }
  }

  private async chatCompletions(
    messages: ProviderMessage[],
    providerConfig: ProviderConfig,
    locale: RuntimeLocale,
    signal?: AbortSignal
  ): Promise<ProviderChatResult> {
    const provider: ProviderConnectionInput = {
      id: providerConfig.providerId,
      kind: providerConfig.providerKind,
      name: providerConfig.providerName,
      apiType: providerConfig.apiType,
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl
    };
    const response = await fetch(`${normalizeBaseUrl(providerConfig.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: createHeaders(provider),
      body: JSON.stringify(toChatCompletionBody(messages, providerConfig, false)),
      signal
    });
    await ensureSuccess(response, locale);
    return extractChatCompletionResult(await response.json());
  }

  private async responses(
    messages: ProviderMessage[],
    providerConfig: ProviderConfig,
    locale: RuntimeLocale,
    signal?: AbortSignal
  ): Promise<ProviderChatResult> {
    const provider: ProviderConnectionInput = {
      id: providerConfig.providerId,
      kind: providerConfig.providerKind,
      name: providerConfig.providerName,
      apiType: providerConfig.apiType,
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl
    };
    const response = await fetch(`${normalizeBaseUrl(providerConfig.baseUrl)}/responses`, {
      method: 'POST',
      headers: createHeaders(provider),
      body: JSON.stringify(toResponsesBody(messages, providerConfig, false)),
      signal
    });
    await ensureSuccess(response, locale);
    return extractResponsesResult(await response.json());
  }

  private async chatCompletionsStream(
    messages: ProviderMessage[],
    providerConfig: ProviderConfig,
    handlers: StreamHandlers,
    locale: RuntimeLocale,
    signal?: AbortSignal
  ): Promise<void> {
    const provider: ProviderConnectionInput = {
      id: providerConfig.providerId,
      kind: providerConfig.providerKind,
      name: providerConfig.providerName,
      apiType: providerConfig.apiType,
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl
    };
    const response = await fetch(`${normalizeBaseUrl(providerConfig.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: createHeaders(provider),
      body: JSON.stringify(toChatCompletionBody(messages, providerConfig, true)),
      signal
    });
    await ensureSuccess(response, locale);
    if (!response.body) {
      throw new Error(locale === 'zh-CN' ? '服务端未返回可读流。' : 'The server did not return a readable stream.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
      let reading = true;
      while (reading) {
        const { done, value } = await reader.read();
        if (done) {
          reading = false;
          continue;
        }
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) {
            continue;
          }
          const payload = trimmed.slice('data:'.length).trim();
          if (payload === '[DONE]') {
            handlers.onDone();
            return;
          }
          if (!payload) {
            continue;
          }
          try {
            const parsed = JSON.parse(payload);
            const delta = extractChatCompletionsStreamDelta(parsed);
            if (delta.textDelta) {
              handlers.onDelta(delta.textDelta);
            }
            if (delta.reasoningDelta) {
              handlers.onReasoningDelta?.(delta.reasoningDelta);
            }
          } catch {
            // Ignore invalid chunks from compatibility providers.
          }
        }
      }
      handlers.onDone();
    } finally {
      reader.releaseLock();
    }
  }

  private async responsesStream(
    messages: ProviderMessage[],
    providerConfig: ProviderConfig,
    handlers: StreamHandlers,
    locale: RuntimeLocale,
    signal?: AbortSignal
  ): Promise<void> {
    const provider: ProviderConnectionInput = {
      id: providerConfig.providerId,
      kind: providerConfig.providerKind,
      name: providerConfig.providerName,
      apiType: providerConfig.apiType,
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl
    };
    const response = await fetch(`${normalizeBaseUrl(providerConfig.baseUrl)}/responses`, {
      method: 'POST',
      headers: createHeaders(provider),
      body: JSON.stringify(toResponsesBody(messages, providerConfig, true)),
      signal
    });
    await ensureSuccess(response, locale);
    if (!response.body) {
      throw new Error(locale === 'zh-CN' ? '服务端未返回可读流。' : 'The server did not return a readable stream.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
      let reading = true;
      while (reading) {
        const { done, value } = await reader.read();
        if (done) {
          reading = false;
          continue;
        }
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) {
            continue;
          }
          const payload = trimmed.slice('data:'.length).trim();
          if (payload === '[DONE]') {
            handlers.onDone();
            return;
          }
          if (!payload) {
            continue;
          }
          try {
            const parsed = JSON.parse(payload);
            const event = extractResponsesStreamEvent(parsed);
            if (event.textDelta) {
              handlers.onDelta(event.textDelta);
            }
            if (event.reasoningDelta) {
              handlers.onReasoningDelta?.(event.reasoningDelta);
            }
            if (event.done) {
              handlers.onDone();
              return;
            }
          } catch {
            // Ignore invalid chunks from compatibility providers.
          }
        }
      }
      handlers.onDone();
    } finally {
      reader.releaseLock();
    }
  }

  private async fetchStandardModels(
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

  private async fetchGeminiModels(
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

  private async fetchOllamaModels(
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
