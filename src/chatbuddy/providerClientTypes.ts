import {
  ProviderApiType,
  ProviderConfig,
  ProviderKind,
  ProviderModelProfile,
  ProviderToolCall,
  ProviderToolDefinition,
  ProviderToolResult,
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

export type StreamDeltaResult = {
  textDelta: string;
  reasoningDelta: string;
};

export type ResponsesStreamEvent = StreamDeltaResult & { done: boolean };

export interface ProviderModelFetcher {
  (
    provider: ProviderConnectionInput,
    locale: RuntimeLocale,
    signal?: AbortSignal
  ): Promise<ProviderModelProfile[]>;
}

export interface ProviderRequestExecutor {
  (
    providerConfig: ProviderConfig,
    endpoint: '/chat/completions' | '/responses',
    body: Record<string, unknown>,
    locale: RuntimeLocale,
    signal?: AbortSignal
  ): Promise<Response>;
}
