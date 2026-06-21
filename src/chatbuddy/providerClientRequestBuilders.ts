/**
 * Provider 请求体构建模块。
 *
 * 将内部 `ProviderConfig` 和消息列表转换为不同 Provider API 的请求体格式，
 * 包括 chat_completions 和 responses 两种 API 类型，以及本地函数工具和 MCP 工具的注入。
 */
import { ProviderConfig, ProviderMessage, ProviderToolDefinition } from './types';
import { ProviderConnectionInput, ProviderToolRound } from './providerClientTypes';
import { warn } from './utils';

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export function normalizeBaseUrlForDetect(baseUrl: string | undefined): string {
  return String(baseUrl || '').trim().toLowerCase();
}

export function isGeminiProvider(provider: Pick<ProviderConnectionInput, 'kind' | 'baseUrl'>): boolean {
  const baseUrl = normalizeBaseUrlForDetect(provider.baseUrl);
  if (baseUrl.includes('generativelanguage.googleapis.com')) {
    return true;
  }
  // 仅当同时包含 Google API 域名时才匹配 /v1beta/openai，避免误判其他 Provider
  if (baseUrl.includes('googleapis.com') && baseUrl.includes('/v1beta/openai')) {
    return true;
  }
  return provider.kind === 'gemini' && baseUrl.length === 0;
}

export function isOllamaProvider(provider: Pick<ProviderConnectionInput, 'kind' | 'baseUrl'>): boolean {
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

export function createHeaders(provider: ProviderConnectionInput, json = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) {
    headers['Content-Type'] = 'application/json';
  }
  if (provider.apiKey.trim()) {
    if (isGeminiProvider(provider)) {
      // Gemini 原生 API 仅使用 x-goog-api-key 鉴权，同时发送 Authorization 头
      // 会导致部分网关（含 Google 官方）因鉴权方式冲突而拒绝请求。
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
  const input: Array<Record<string, unknown>> = messages.map((message) => {
    if (typeof message.content === 'string') {
      return {
        role: message.role,
        content: [{ type: 'input_text', text: message.content }]
      };
    }
    const mapped = message.content.map((part) => {
      if (part.type === 'text') {
        return { type: 'input_text', text: part.text };
      }
      if (part.type === 'image_url' && part.image_url?.url) {
        return { type: 'input_image', image_url: part.image_url.url };
      }
      // 安全回退：忽略未知类型
      return { type: 'input_text', text: '' };
    });
    return { role: message.role, content: mapped };
  });
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

export function toChatCompletionBody(
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
  if (providerConfig.stopSequences?.length) {
    body.stop = providerConfig.stopSequences;
  }
  if (providerConfig.seed != null) {
    body.seed = providerConfig.seed;
  }
  if (providerConfig.responseFormat) {
    body.response_format = providerConfig.responseFormat;
  }
  if (providerConfig.toolChoice != null) {
    body.tool_choice = providerConfig.toolChoice;
  }
  return body;
}

export function toResponsesBody(
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
  if (providerConfig.stopSequences?.length) {
    body.stop = providerConfig.stopSequences;
  }
  if (providerConfig.seed != null) {
    body.seed = providerConfig.seed;
  }
  if (providerConfig.responseFormat) {
    body.response_format = providerConfig.responseFormat;
  }
  if (providerConfig.toolChoice != null) {
    body.tool_choice = providerConfig.toolChoice;
  }
  return body;
}

// ── Gemini Native API ──────────────────────────────────────────

function toGeminiParts(message: ProviderMessage): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  if (typeof message.content === 'string') {
    if (message.content) {
      parts.push({ text: message.content });
    }
    return parts;
  }
  for (const part of message.content) {
    if (part.type === 'text') {
      parts.push({ text: part.text });
    } else if (part.type === 'image_url') {
      const url = part.image_url?.url || '';
      const match = url.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
    }
  }
  return parts;
}

function toGeminiToolResultParts(toolRound: ProviderToolRound): Array<Record<string, unknown>> {
  const nameById = new Map<string, string>();
  for (const call of toolRound.toolCalls) {
    nameById.set(call.id, call.name);
  }
  const parts: Array<Record<string, unknown>> = [];
  for (const result of toolRound.results) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.output);
    } catch (err) {
      warn('Error parsing tool result output:', err);
      parsed = result.output;
    }
    parts.push({
      functionResponse: {
        name: nameById.get(result.toolCallId) ?? result.toolCallId,
        response: { result: parsed }
      }
    });
  }
  return parts;
}

function toGeminiContents(messages: ProviderMessage[], toolRounds: ProviderToolRound[] = []): Array<Record<string, unknown>> {
  const contents: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }
    const geminiRole = message.role === 'assistant' ? 'model' : 'user';
    contents.push({ role: geminiRole, parts: toGeminiParts(message) });
  }
  for (const round of toolRounds) {
    if (round.toolCalls.length > 0) {
      const callParts = round.toolCalls.map((call) => ({
        functionCall: {
          name: call.name,
          args: (() => { try { return JSON.parse(call.argumentsText); } catch (err) { warn('Error parsing tool call arguments:', err); return {}; } })()
        }
      }));
      contents.push({ role: 'model', parts: callParts });
    }
    if (round.results.length > 0) {
      contents.push({ role: 'user', parts: toGeminiToolResultParts(round) });
    }
  }
  return contents;
}

function extractGeminiSystemInstruction(messages: ProviderMessage[]): Record<string, unknown> | undefined {
  const systemMessages = messages.filter((m) => m.role === 'system');
  if (systemMessages.length === 0) {
    return undefined;
  }
  const parts: Array<Record<string, unknown>> = [];
  for (const msg of systemMessages) {
    const msgParts = toGeminiParts(msg);
    parts.push(...msgParts);
  }
  if (parts.length === 0) {
    return undefined;
  }
  return { parts };
}

function toGeminiGenerationConfig(providerConfig: ProviderConfig): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (providerConfig.temperature >= 0) {
    config.temperature = providerConfig.temperature;
  }
  if (providerConfig.topP >= 0) {
    config.topP = providerConfig.topP;
  }
  if (providerConfig.topK != null && providerConfig.topK >= 0) {
    config.topK = providerConfig.topK;
  }
  if (providerConfig.maxTokens > 0) {
    config.maxOutputTokens = providerConfig.maxTokens;
  }
  if (providerConfig.stopSequences?.length) {
    config.stopSequences = providerConfig.stopSequences;
  }
  if (providerConfig.seed != null) {
    config.seed = providerConfig.seed;
  }
  if (providerConfig.responseFormat) {
    config.responseMimeType = providerConfig.responseFormat.type === 'json_object'
      ? 'application/json'
      : providerConfig.responseFormat.type === 'json_schema'
        ? 'application/json'
        : 'text/plain';
  }
  return config;
}

function toGeminiToolDeclarations(tools: ProviderToolDefinition[]): Array<Record<string, unknown>> {
  const declarations = tools
    .filter((t) => t.type === 'function')
    .map((t) => ({
      name: t.function.name,
      description: t.function.description || '',
      parameters: t.function.parameters || {}
    }));
  return [{ functionDeclarations: declarations }];
}

function toGeminiSafetySettings(level: ProviderConfig['geminiSafetyLevel']): Array<Record<string, unknown>> | undefined {
  if (!level || level === 'default') { return undefined; }
  const thresholdMap: Record<Exclude<NonNullable<ProviderConfig['geminiSafetyLevel']>, 'default'>, string> = {
    none: 'BLOCK_NONE',
    low: 'BLOCK_LOW_AND_ABOVE',
    medium: 'BLOCK_MEDIUM_AND_ABOVE',
    high: 'BLOCK_ONLY_HIGH'
  };
  const threshold = thresholdMap[level];
  const categories = [
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_DANGEROUS_CONTENT'
  ];
  return categories.map((category) => ({ category, threshold }));
}

export function toGeminiBody(
  messages: ProviderMessage[],
  providerConfig: ProviderConfig,
  _stream: boolean,
  tools: ProviderToolDefinition[] = [],
  toolRounds: ProviderToolRound[] = []
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contents: toGeminiContents(messages, toolRounds)
  };
  const systemInstruction = extractGeminiSystemInstruction(messages);
  if (systemInstruction) {
    body.systemInstruction = systemInstruction;
  }
  const genConfig = toGeminiGenerationConfig(providerConfig);
  if (Object.keys(genConfig).length > 0) {
    body.generationConfig = genConfig;
  }
  if (tools.length > 0) {
    body.tools = toGeminiToolDeclarations(tools);
  }
  const safetySettings = toGeminiSafetySettings(providerConfig.geminiSafetyLevel);
  if (safetySettings) {
    body.safetySettings = safetySettings;
  }
  return body;
}
