export type ChatRole = 'system' | 'user' | 'assistant';
export type RuntimeLocale = 'zh-CN' | 'en';
export type ChatBuddyLocaleSetting = 'auto' | RuntimeLocale;
export type ChatSendShortcut = 'enter' | 'ctrlEnter';
export type AssistantGroupKind = 'default' | 'deleted' | 'custom';
export type ProviderApiType = 'chat_completions' | 'responses';
export type ProviderKind = 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'custom';

export interface AssistantOverrides {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
}

export interface ProviderModelProfile {
  id: string;
  name: string;
}

export interface ProviderProfile {
  id: string;
  kind: ProviderKind;
  name: string;
  apiKey: string;
  baseUrl: string;
  apiType: ProviderApiType;
  enabled: boolean;
  models: ProviderModelProfile[];
  modelLastSyncedAt?: number;
}

export interface ModelBinding {
  providerId: string;
  modelId: string;
}

export interface DefaultModelSettings {
  assistant?: ModelBinding;
}

export interface ProviderModelOption {
  ref: string;
  providerId: string;
  providerName: string;
  modelId: string;
  label: string;
}

export interface AssistantGroup {
  id: string;
  name: string;
  kind: AssistantGroupKind;
  createdAt: number;
  updatedAt: number;
}

export interface AssistantProfile {
  id: string;
  name: string;
  note: string;
  avatar?: string;
  groupId: string;
  systemPrompt: string;
  greeting: string;
  questionPrefix: string;
  modelRef: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  contextCount: number;
  presencePenalty: number;
  frequencyPenalty: number;
  streaming: boolean;
  pinned: boolean;
  isDeleted: boolean;
  deletedAt?: number;
  originalGroupId?: string;
  createdAt: number;
  updatedAt: number;
  lastInteractedAt: number;
  overrides?: AssistantOverrides;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  model?: string;
  reasoning?: string;
}

export interface ChatSession {
  id: string;
  assistantId: string;
  title: string;
  titleSource: 'default' | 'generated' | 'custom';
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ChatSessionSummary {
  id: string;
  assistantId: string;
  title: string;
  titleSource: 'default' | 'generated' | 'custom';
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview?: string;
}

export type ChatSessionDetail = ChatSession;

export interface PersistedState {
  groups: AssistantGroup[];
  assistants: AssistantProfile[];
  sessions: ChatSession[];
  selectedAssistantId?: string;
  selectedSessionIdByAssistant: Record<string, string>;
  sessionPanelCollapsed: boolean;
  settings: ChatBuddySettings;
}

export interface PersistedStateLite {
  groups: AssistantGroup[];
  assistants: AssistantProfile[];
  selectedAssistantId?: string;
  selectedSessionIdByAssistant: Record<string, string>;
  sessionPanelCollapsed: boolean;
  settings: ChatBuddySettings;
}

export interface ChatBuddySettings {
  providers: ProviderProfile[];
  defaultModels: DefaultModelSettings;
  temperature: number;
  topP: number;
  maxTokens: number;
  presencePenalty: number;
  frequencyPenalty: number;
  timeoutMs: number;
  streamingDefault: boolean;
  locale: ChatBuddyLocaleSetting;
  sendShortcut: ChatSendShortcut;
}

export interface ProviderConfig {
  providerId: string;
  providerKind: ProviderKind;
  providerName: string;
  apiType: ProviderApiType;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  modelRef: string;
  modelLabel: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  contextCount: number;
  presencePenalty: number;
  frequencyPenalty: number;
  timeoutMs: number;
}

export type RuntimeStrings = Record<string, string>;

export interface AssistantViewMeta {
  name: string;
  subtitle: string;
  isDeleted: boolean;
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatStatePayload {
  groups: AssistantGroup[];
  assistants: AssistantProfile[];
  selectedAssistant?: AssistantProfile;
  selectedAssistantId?: string;
  sessions: ChatSessionSummary[];
  selectedSessionId?: string;
  selectedSession?: ChatSessionDetail;
  sessionPanelCollapsed: boolean;
  locale: RuntimeLocale;
  strings: RuntimeStrings;
  assistantMeta: Record<string, AssistantViewMeta>;
  providerLabel: string;
  modelLabel: string;
  modelOptions: ProviderModelOption[];
  sessionTempModelRef: string;
  sendShortcut: ChatSendShortcut;
  streaming: boolean;
  isGenerating: boolean;
  canChat: boolean;
  readOnlyReason?: string;
  error?: string;
}

export type WebviewInboundMessage =
  | { type: 'ready' }
  | { type: 'createSession' }
  | { type: 'selectSession'; sessionId: string }
  | { type: 'renameSession'; sessionId: string; title: string }
  | { type: 'deleteSession'; sessionId: string }
  | { type: 'setSessionTempModel'; modelRef: string }
  | { type: 'toggleSessionPanel' }
  | { type: 'regenerateReply' }
  | { type: 'regenerateFromMessage'; messageId: string }
  | { type: 'copyMessage'; messageId: string }
  | { type: 'deleteMessage'; messageId: string }
  | { type: 'setStreaming'; enabled: boolean }
  | { type: 'sendMessage'; content: string }
  | { type: 'stopGeneration' };

export type WebviewOutboundMessage =
  | { type: 'state'; payload: ChatStatePayload }
  | { type: 'error'; message: string }
  | { type: 'toast'; message: string; tone?: 'success' | 'error' | 'info' };
