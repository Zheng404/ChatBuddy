import { ProviderConfig, ProviderMessage, ProviderToolDefinition } from './types';
import { ProviderConnectionInput, ProviderToolRound } from './providerClientTypes';

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
  if (baseUrl.includes('/v1beta/openai')) {
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
  return body;
}
