export type ChatRole = 'system' | 'user' | 'assistant';
export type RuntimeLocale = 'zh-CN' | 'en';
export type ChatBuddyLocaleSetting = 'auto' | RuntimeLocale;
export type ChatSendShortcut = 'enter' | 'ctrlEnter';
export type ChatTabMode = 'single' | 'multi';
export type AssistantGroupKind = 'default' | 'deleted' | 'custom';
export type ProviderApiType = 'chat_completions' | 'responses';
export type ProviderKind = 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'custom';
export type McpTransportType = 'stdio' | 'streamableHttp' | 'sse';

export interface AssistantOverrides {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
}

export interface McpKeyValueEntry {
  key: string;
  value: string;
}

export interface McpServerProfile {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransportType;
  command: string;
  args: string[];
  cwd: string;
  env: McpKeyValueEntry[];
  url: string;
  headers: McpKeyValueEntry[];
  timeoutMs: number;
  remotePassthroughEnabled: boolean;
}

export interface McpSettings {
  servers: McpServerProfile[];
  maxToolRounds: number;
}

export interface ModelCapabilities {
  vision?: boolean;
  reasoning?: boolean;
  audio?: boolean;
  video?: boolean;
  tools?: boolean;
}

export interface ProviderModelProfile {
  id: string;
  name: string;
  capabilities?: ModelCapabilities;
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
  titleSummary?: ModelBinding;
  titleSummaryPrompt?: string;
}

export interface ProviderModelOption {
  ref: string;
  providerId: string;
  providerName: string;
  modelId: string;
  label: string;
  capabilities?: ModelCapabilities;
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
  enabledMcpServerIds: string[];
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
  toolRounds?: ChatToolRound[];
}

export interface ChatToolRound {
  reasoning?: string;
  calls: Array<{
    id: string;
    name: string;
    argumentsText: string;
    output?: string;
  }>;
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
  mcp: McpSettings;
  temperature: number;
  topP: number;
  maxTokens: number;
  presencePenalty: number;
  frequencyPenalty: number;
  timeoutMs: number;
  streamingDefault: boolean;
  locale: ChatBuddyLocaleSetting;
  sendShortcut: ChatSendShortcut;
  chatTabMode: ChatTabMode;
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

export type ProviderToolDefinition =
  | {
      type: 'function';
      function: {
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
      };
    }
  | {
      type: 'mcp';
      server_label: string;
      server_url: string;
      headers?: Record<string, string>;
      require_approval?: 'never' | 'always';
    };

export interface ProviderToolCall {
  id: string;
  name: string;
  argumentsText: string;
}

export interface ProviderToolResult {
  toolCallId: string;
  output: string;
}

export interface McpServerSummary {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransportType;
}

export interface McpResourceEntry {
  serverId: string;
  serverName: string;
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required: boolean;
}

export interface McpPromptEntry {
  serverId: string;
  serverName: string;
  name: string;
  description?: string;
  arguments: McpPromptArgument[];
}

export type RuntimeStrings = Record<string, string>;

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
  providerLabel: string;
  modelLabel: string;
  modelOptions: ProviderModelOption[];
  sessionTempModelRef: string;
  sendShortcut: ChatSendShortcut;
  streaming: boolean;
  isGenerating: boolean;
  canChat: boolean;
  mcpServers: McpServerSummary[];
  awaitingToolContinuation: boolean;
  pendingToolCallCount: number;
  toolRoundLimit: number;
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
  | { type: 'editMessage'; messageId: string; newContent: string }
  | { type: 'clearSession' }
  | { type: 'setStreaming'; enabled: boolean }
  | { type: 'sendMessage'; content: string }
  | { type: 'continueToolCalls' }
  | { type: 'cancelToolCalls' }
  | { type: 'listMcpResources' }
  | { type: 'listMcpPrompts' }
  | { type: 'readMcpResource'; serverId: string; uri: string }
  | { type: 'getMcpPrompt'; serverId: string; name: string; args: Record<string, string> }
  | { type: 'stopGeneration' };

export type WebviewOutboundMessage =
  | { type: 'state'; payload: ChatStatePayload }
  | { type: 'error'; message: string }
  | { type: 'mcpResources'; payload: { items: McpResourceEntry[]; message?: string } }
  | { type: 'mcpPrompts'; payload: { items: McpPromptEntry[]; message?: string } }
  | { type: 'mcpInsert'; payload: { content: string; message?: string } }
  | { type: 'toast'; message: string; tone?: 'success' | 'error' | 'info' };
