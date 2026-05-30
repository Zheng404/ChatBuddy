import type { AssistantProfile, ProviderProfile, ChatSessionDetail, ChatMessage } from '../../chatbuddy/types';

export function makeAssistant(overrides?: Partial<AssistantProfile>): AssistantProfile {
  return {
    id: 'a1',
    name: 'Test Assistant',
    note: '',
    groupId: 'default',
    systemPrompt: '',
    greeting: '',
    questionPrefix: '',
    modelRef: 'p1:m1',
    temperature: 0.7,
    topP: 1,
    maxTokens: 2048,
    contextCount: 10,
    presencePenalty: 0,
    frequencyPenalty: 0,
    streaming: true,
    enabledMcpServerIds: [],
    pinned: false,
    isDeleted: false,
    createdAt: 0,
    updatedAt: 0,
    lastInteractedAt: 0,
    ...overrides
  };
}

export function makeProvider(overrides?: Partial<ProviderProfile>): ProviderProfile {
  return {
    id: 'p1',
    kind: 'openai',
    name: 'Test Provider',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    apiType: 'chat_completions',
    enabled: true,
    models: [{ id: 'm1', name: 'Model 1' }],
    ...overrides
  };
}

export function makeSession(overrides?: Partial<ChatSessionDetail>): ChatSessionDetail {
  return {
    id: 's1',
    assistantId: 'a1',
    title: 'Test Session',
    titleSource: 'default',
    messages: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  };
}

export function makeMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg_test',
    role: 'user',
    content: 'Test message',
    timestamp: Date.now(),
    ...overrides
  };
}
