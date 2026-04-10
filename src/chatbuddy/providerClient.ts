import { getStrings } from './i18n';
import { hasAnyCapability } from './modelCapabilities';
import { createModelRef, getModelDisplayLabel, parseModelRef } from './modelCatalog';
import { TIMEOUT } from './constants';
import {
  AssistantProfile,
  ChatBuddySettings,
  ModelBinding,
  ModelCapabilities,
  ProviderApiType,
  ProviderConfig,
  ProviderKind,
  ProviderToolCall,
  ProviderToolDefinition,
  ProviderMessage,
  ProviderModelProfile,
  ProviderToolResult,
  RuntimeLocale
} from './types';
import { clamp, resolveLocaleString, retryWithBackoff } from './utils';

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
  onDone: () => void;
}

export interface ProviderChatResult {
  text: string;
  reasoning?: string;
  toolCalls?: ProviderToolCall[];
  responseId?: string;
}

export interface ProviderToolRound {
  toolCalls: ProviderToolCall[];
  results: ProviderToolResult[];
}

export interface ProviderRequestOptions {
  tools?: ProviderToolDefinition[];
  toolRounds?: ProviderToolRound[];
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

type MediaKind = 'image' | 'video';

type MediaSourceConfig = {
  defaultDataMime: string;
  directKeys: readonly string[];
  nestedKeys: readonly string[];
  encodedKeys: ReadonlyArray<{ key: string; appendKind?: boolean }>;
};

const HTTP_URL_RE = /^https?:\/\/\S+$/i;
const DATA_IMAGE_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i;
const DATA_VIDEO_URL_RE = /^data:video\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i;
const BASE64_RE = /^[a-z0-9+/]+=*$/i;
const WHITESPACE_RE = /\s+/g;
const MEDIA_SOURCE_MAX_DEPTH = 4;

const MEDIA_SOURCE_CONFIG: Record<MediaKind, MediaSourceConfig> = {
  image: {
    defaultDataMime: 'image/png',
    directKeys: ['url', 'image_url', 'imageUrl', 'image'],
    nestedKeys: ['content', 'output', 'item', 'items', 'response', 'images'],
    encodedKeys: [
      { key: 'b64_json', appendKind: true },
      { key: 'base64', appendKind: true },
      { key: 'data', appendKind: true },
      { key: 'result' }
    ]
  },
  video: {
    defaultDataMime: 'video/mp4',
    directKeys: ['url', 'video_url', 'videoUrl', 'video'],
    nestedKeys: ['content', 'output', 'item', 'items', 'response', 'videos'],
    encodedKeys: [
      { key: 'b64_json', appendKind: true },
      { key: 'base64', appendKind: true },
      { key: 'data', appendKind: true },
      { key: 'result' }
    ]
  }
};

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

function toChatCompletionsMessages(messages: ProviderMessage[], toolRounds: ProviderToolRound[] = []) {
  const result: Array<Record<string, unknown>> = messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
  for (const round of toolRounds) {
    if (round.toolCalls.length > 0) {
      result.push({
        role: 'assistant',
        tool_calls: round.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: call.argumentsText
          }
        }))
      });
    }
    for (const toolResult of round.results) {
      result.push({
        role: 'tool',
        tool_call_id: toolResult.toolCallId,
        content: toolResult.output
      });
    }
  }
  return result;
}

function toResponsesInput(messages: ProviderMessage[], toolRounds: ProviderToolRound[] = []) {
  const input: Array<Record<string, unknown>> = messages.map((message) => ({
    role: message.role,
    content: [
      {
        type: 'input_text',
        text: message.content
      }
    ]
  }));
  for (const round of toolRounds) {
    for (const toolCall of round.toolCalls) {
      input.push({
        type: 'function_call',
        call_id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.argumentsText
      });
    }
    for (const result of round.results) {
      input.push({
        type: 'function_call_output',
        call_id: result.toolCallId,
        output: result.output
      });
    }
  }
  return input;
}

function toChatCompletionBody(
  messages: ProviderMessage[],
  providerConfig: ProviderConfig,
  stream: boolean,
  tools: ProviderToolDefinition[] = [],
  toolRounds: ProviderToolRound[] = []
) {
  const body: Record<string, unknown> = {
    model: providerConfig.modelId,
    temperature: providerConfig.temperature,
    top_p: providerConfig.topP,
    presence_penalty: providerConfig.presencePenalty,
    frequency_penalty: providerConfig.frequencyPenalty,
    stream,
    messages: toChatCompletionsMessages(messages, toolRounds)
  };
  if (tools.length > 0) {
    body.tools = tools;
  }
  if (providerConfig.maxTokens > 0) {
    body.max_tokens = providerConfig.maxTokens;
  }
  return body;
}

function toResponsesBody(
  messages: ProviderMessage[],
  providerConfig: ProviderConfig,
  stream: boolean,
  tools: ProviderToolDefinition[] = [],
  toolRounds: ProviderToolRound[] = []
) {
  const body: Record<string, unknown> = {
    model: providerConfig.modelId,
    input: toResponsesInput(messages, toolRounds),
    temperature: providerConfig.temperature,
    top_p: providerConfig.topP,
    presence_penalty: providerConfig.presencePenalty,
    frequency_penalty: providerConfig.frequencyPenalty,
    stream
  };
  if (tools.length > 0) {
    body.tools = tools;
  }
  if (providerConfig.maxTokens > 0) {
    body.max_output_tokens = providerConfig.maxTokens;
  }
  return body;
}

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Safely extract an object from an unknown value.
 * Returns a Record (always truthy for property access) or null.
 * Use this instead of raw `as` assertions when parsing external API responses.
 */
function toObject<T extends Record<string, unknown>>(value: unknown): T | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null;
}

function isHttpUrl(value: string): boolean {
  return HTTP_URL_RE.test(value);
}

function isDataImageUrl(value: string): boolean {
  return DATA_IMAGE_URL_RE.test(value);
}

function isDataVideoUrl(value: string): boolean {
  return DATA_VIDEO_URL_RE.test(value);
}

function looksLikeBase64(value: string): boolean {
  const normalized = value.replace(WHITESPACE_RE, '');
  if (normalized.length < 64 || normalized.length % 4 !== 0) {
    return false;
  }
  return BASE64_RE.test(normalized);
}

function toMediaSource(value: unknown, mediaKind: MediaKind, typeHint = '', depth = 0): string | undefined {
  if (depth > MEDIA_SOURCE_MAX_DEPTH) {
    return undefined;
  }
  const config = MEDIA_SOURCE_CONFIG[mediaKind];
  const normalizedHint = typeHint.toLowerCase();
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (!candidate) {
      return undefined;
    }
    const isDataUrl = mediaKind === 'image' ? isDataImageUrl(candidate) : isDataVideoUrl(candidate);
    if (isHttpUrl(candidate) || isDataUrl) {
      return candidate;
    }
    if (normalizedHint.includes(mediaKind) && looksLikeBase64(candidate)) {
      return `data:${config.defaultDataMime};base64,${candidate.replace(WHITESPACE_RE, '')}`;
    }
    return undefined;
  }

  const payload = toObject<Record<string, unknown>>(value);
  if (!payload) {
    return undefined;
  }

  const nextHint = `${normalizedHint} ${toTrimmedString(payload.type).toLowerCase()} ${toTrimmedString(payload.kind).toLowerCase()}`.trim();

  for (const key of config.directKeys) {
    const source = toMediaSource(payload[key], mediaKind, nextHint, depth + 1);
    if (source) {
      return source;
    }
  }

  for (const { key, appendKind } of config.encodedKeys) {
    const hint = appendKind ? `${nextHint} ${mediaKind}`.trim() : nextHint;
    const source = toMediaSource(payload[key], mediaKind, hint, depth + 1);
    if (source) {
      return source;
    }
  }

  for (const key of config.nestedKeys) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const source = toMediaSource(item, mediaKind, nextHint, depth + 1);
        if (source) {
          return source;
        }
      }
      continue;
    }
    const source = toMediaSource(candidate, mediaKind, nextHint, depth + 1);
    if (source) {
      return source;
    }
  }

  return undefined;
}

function toImageSource(value: unknown, typeHint = '', depth = 0): string | undefined {
  return toMediaSource(value, 'image', typeHint, depth);
}

function toImageMarkdown(value: unknown, typeHint = ''): string | undefined {
  const source = toImageSource(value, typeHint.toLowerCase());
  if (!source) {
    return undefined;
  }
  return `![image](${source})`;
}

function toVideoSource(value: unknown, typeHint = '', depth = 0): string | undefined {
  return toMediaSource(value, 'video', typeHint, depth);
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

function extractChatCompletionToolCalls(message: {
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}): ProviderToolCall[] {
  if (!Array.isArray(message.tool_calls)) {
    return [];
  }
  return message.tool_calls
    .map((call) => {
      const name = toTrimmedString(call?.function?.name);
      if (!name) {
        return undefined;
      }
      return {
        id: toTrimmedString(call?.id) || `${name}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        argumentsText: typeof call?.function?.arguments === 'string' ? call.function.arguments : '{}'
      };
    })
    .filter((call): call is ProviderToolCall => Boolean(call));
}

function extractResponsesToolCalls(payload: {
  output?: Array<{
    type?: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  }>;
}): ProviderToolCall[] {
  return (payload.output ?? [])
    .map((item) => {
      const itemType = toTrimmedString(item?.type).toLowerCase();
      if (!itemType.includes('function_call') && !itemType.includes('tool_call')) {
        return undefined;
      }
      const name = toTrimmedString(item?.name);
      if (!name) {
        return undefined;
      }
      return {
        id:
          toTrimmedString(item?.call_id) ||
          toTrimmedString(item?.id) ||
          `${name}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        argumentsText: typeof item?.arguments === 'string' ? item.arguments : '{}'
      };
    })
    .filter((call): call is ProviderToolCall => Boolean(call));
}

function extractChatCompletionResult(data: unknown): ProviderChatResult {
  const payload = toObject<{
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string; value?: string; content?: string }>;
        reasoning?: string | Array<{ text?: string; value?: string }>;
        reasoning_content?: string | Array<{ text?: string; value?: string }>;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: {
            name?: string;
            arguments?: string;
          };
        }>;
      };
    }>;
  }>(data);

  const message = payload?.choices?.[0]?.message;
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

  const result = {
    text: joinChunks(textChunks) || '',
    reasoning: joinChunks(reasoningChunks),
    toolCalls: extractChatCompletionToolCalls(message)
  };

  return result;
}

function extractResponsesResult(data: unknown): ProviderChatResult {
  const payload = toObject<{
    id?: string;
    output_text?: string;
    output?: Array<{
      type?: string;
      id?: string;
      call_id?: string;
      name?: string;
      arguments?: string;
      text?: string;
      value?: string;
      summary?: Array<{ text?: string; value?: string }>;
      content?: Array<{ type?: string; text?: string; value?: string; content?: string }>;
    }>;
  }>(data);
  if (!payload) {
    return { text: '' };
  }

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
    reasoning: joinChunks(reasoningChunks),
    toolCalls: extractResponsesToolCalls(payload),
    responseId: toTrimmedString(payload.id) || undefined
  };
}

type StreamDeltaResult = {
  textDelta: string;
  reasoningDelta: string;
};

function extractChatCompletionsStreamDelta(payload: unknown): StreamDeltaResult {
  const empty = { textDelta: '', reasoningDelta: '' };
  const choices = toObject<{ choices?: Array<{ delta?: unknown }> }>(payload)?.choices;
  if (!choices?.length) {
    return empty;
  }

  const delta = toObject<{
    content?: string | Array<{ type?: string; text?: string; value?: string; content?: string }>;
    reasoning?: string;
    reasoning_content?: string;
  }>(choices[0].delta);

  if (!delta) {
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

  const event = toObject<{
    type?: string;
    delta?: string;
    text?: string;
    item?: unknown;
    output_item?: unknown;
    response?: unknown;
    output?: unknown;
  }>(payload);
  if (!event) {
    return { textDelta: '', reasoningDelta: '', done };
  }
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
  const event = toObject<{ type?: string }>(payload);
  return (
    event?.type === 'response.completed' ||
    event?.type === 'response.output_text.done' ||
    event?.type === 'response.done'
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
  const payload = toObject<{ data?: Array<Record<string, unknown>>; models?: Array<Record<string, unknown>> }>(data);
  if (!payload) {
    return [];
  }
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
  const payload = toObject<{ models?: Array<Record<string, unknown>> }>(data);
  if (!payload) {
    return [];
  }
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
  const payload = toObject<{ models?: Array<Record<string, unknown>> }>(data);
  if (!payload) {
    return [];
  }
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
