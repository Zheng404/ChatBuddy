import { hasAnyCapability } from './modelCapabilities';
import { ModelCapabilities, ProviderModelProfile, ProviderToolCall } from './types';
import {
  ProviderChatResult,
  ResponsesStreamEvent,
  StreamDeltaResult
} from './providerClientTypes';
import {
  appendChunk,
  joinChunks,
  toImageMarkdown,
  toObject,
  toTrimmedString,
  toVideoMarkdown
} from './providerClientMedia';

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

export function extractChatCompletionResult(data: unknown): ProviderChatResult {
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

  return {
    text: joinChunks(textChunks) || '',
    reasoning: joinChunks(reasoningChunks),
    toolCalls: extractChatCompletionToolCalls(message)
  };
}

export function extractResponsesResult(data: unknown): ProviderChatResult {
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

export function extractChatCompletionsStreamDelta(payload: unknown): StreamDeltaResult {
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

export function extractResponsesStreamEvent(payload: unknown): ResponsesStreamEvent {
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

function extractCapabilitiesFromStandardModel(raw: Record<string, unknown>): ModelCapabilities | undefined {
  const architecture = raw.architecture as Record<string, unknown> | undefined;
  const inputModalities = Array.isArray(architecture?.input_modalities) ? (architecture.input_modalities as string[]) : [];
  const supportedParams = Array.isArray(raw.supported_parameters) ? (raw.supported_parameters as string[]) : [];
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

function extractCapabilitiesFromGeminiModel(raw: Record<string, unknown>): ModelCapabilities | undefined {
  const description = typeof raw.description === 'string' ? raw.description.toLowerCase() : '';
  const caps: ModelCapabilities = {};
  if (description.includes('multimodal') || description.includes('vision') || description.includes('image')) {
    caps.vision = true;
  }
  return hasAnyCapability(caps) ? caps : undefined;
}

function extractCapabilitiesFromOllamaModel(raw: Record<string, unknown>): ModelCapabilities | undefined {
  const details = raw.details as Record<string, unknown> | undefined;
  const families = Array.isArray(details?.families) ? (details.families as string[]) : [];
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

export function parseStandardModelList(data: unknown): ProviderModelProfile[] {
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
  return result;
}

export function parseGeminiModels(data: unknown): ProviderModelProfile[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const payload = toObject<{ models?: Array<Record<string, unknown>> }>(data);
  if (!payload) {
    return [];
  }
  const result: ProviderModelProfile[] = [];
  for (const model of payload.models ?? []) {
    const rawName = typeof model.name === 'string' ? model.name.trim() : '';
    if (!rawName) {
      continue;
    }
    const id = rawName.startsWith('models/') ? rawName.slice('models/'.length) : rawName;
    if (!id) {
      continue;
    }
    const displayName = typeof model.displayName === 'string' && model.displayName.trim() ? model.displayName.trim() : id;
    result.push({
      id,
      name: displayName,
      capabilities: extractCapabilitiesFromGeminiModel(model)
    });
  }
  return result;
}

export function parseOllamaModels(data: unknown): ProviderModelProfile[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const payload = toObject<{ models?: Array<Record<string, unknown>> }>(data);
  if (!payload) {
    return [];
  }
  const result: ProviderModelProfile[] = [];
  for (const model of payload.models ?? []) {
    const id =
      typeof model.name === 'string'
        ? model.name.trim()
        : typeof model.model === 'string'
          ? model.model.trim()
          : '';
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
