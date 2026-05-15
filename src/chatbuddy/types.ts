/**
 * ChatBuddy 全局类型定义模块。
 *
 * 定义整个扩展使用的所有核心数据类型和接口，
 * 包括助手、会话、消息、Provider 配置、MCP 设置、WebView 消息协议等。
 */
export type ChatRole = 'system' | 'user' | 'assistant';
export type RuntimeLocale = 'zh-CN' | 'en';
export type ChatBuddyLocaleSetting = 'auto' | RuntimeLocale;
export type ChatSendShortcut = 'enter' | 'ctrlEnter' | 'shiftEnter';
export type ChatTabMode = 'single' | 'multi';
export type AssistantGroupKind = 'default' | 'deleted' | 'custom';
export type ProviderApiType = 'chat_completions' | 'responses' | 'gemini';
export type ProviderKind = 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'custom';
export type ProviderModelSource = 'manual' | 'fetched';
export type McpTransportType = 'stdio' | 'streamableHttp' | 'sse';

export interface SessionTempParams {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
}

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
  groupId?: string;
}

export interface McpServerGroup {
  id: string;
  name: string;
  enabled: boolean;
}

export interface McpSettings {
  servers: McpServerProfile[];
  groups: McpServerGroup[];
  maxToolRounds: number;
}

export type ModelKind = 'chat' | 'image' | 'video' | 'audio' | 'embedding' | 'rerank';

export interface ModelCapabilities {
  vision?: boolean;
  reasoning?: boolean;
  tools?: boolean;
  webSearch?: boolean;
  jsonMode?: boolean;
  parallelToolCalls?: boolean;
  maxContextLength?: number;
}

export interface ProviderModelProfile {
  id: string;
  name: string;
  /** Runtime-resolved model type (from API / registry / patterns). Not persisted unless user overrides. */
  kind?: ModelKind;
  /** Runtime-resolved capabilities. Not persisted unless user overrides. */
  capabilities?: ModelCapabilities;
  source?: ProviderModelSource;
  /** User manual override for kind — persisted across sessions. */
  userKindOverride?: ModelKind;
  /** User manual override for capabilities — persisted across sessions. */
  userCapabilitiesOverride?: ModelCapabilities;
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

export interface AssistantTemplate {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  systemPrompt: string;
  greeting: string;
  questionPrefix: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  contextCount: number;
  presencePenalty: number;
  frequencyPenalty: number;
  enabledMcpServerIds: string[];
  streaming: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderModelOption {
  ref: string;
  providerId: string;
  providerName: string;
  modelId: string;
  label: string;
  kind?: ModelKind;
  capabilities?: ModelCapabilities;
  /** Pre-built "[Kind | Caps]" suffix for dropdown display */
  metaLabel?: string;
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
  topK?: number;
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
  stopSequences?: string[];
  seed?: number;
  responseFormat?: ProviderResponseFormat;
  toolChoice?: ProviderToolChoice;
  geminiSafetyLevel?: GeminiSafetyLevel;
  failoverModelRefs?: string[];
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  model?: string;
  reasoning?: string;
  toolRounds?: ChatToolRound[];
  images?: ChatMessageImage[];
  files?: ChatMessageFile[];
}

export interface ChatMessageImage {
  base64: string;
  mimeType: string;
  /** File path relative to the images storage directory. When set, base64 is omitted from persisted state. */
  path?: string;
}

export interface ChatMessageFile {
  name: string;
  content: string;
  language?: string;
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
  collapsedGroupIds: string[];
  settings: ChatBuddySettings;
}

export interface PersistedStateLite {
  groups: AssistantGroup[];
  assistants: AssistantProfile[];
  selectedAssistantId?: string;
  selectedSessionIdByAssistant: Record<string, string>;
  sessionPanelCollapsed: boolean;
  collapsedGroupIds: string[];
  settings: ChatBuddySettings;
  templates: AssistantTemplate[];
}

export interface LocalBackupSettings {
  enabled: boolean;
  directory: string;
  intervalHours: number;
  maxCount: number;
  maxAgeDays: number;
  encryptionEnabled?: boolean;
  /** 备份加密密码，通过 Compass 共享存储同步到其他 IDE 实例 */
  password?: string;
}

export interface BackupFileEntry {
  fileName: string;
  fileSize: number;
  createdAt: string;
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
  localBackup: LocalBackupSettings;
}

export type ProviderResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | { type: 'json_schema'; json_schema: Record<string, unknown> };

export type ProviderToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

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
  topK?: number;
  maxTokens: number;
  contextCount: number;
  presencePenalty: number;
  frequencyPenalty: number;
  timeoutMs: number;
  stopSequences?: string[];
  seed?: number;
  responseFormat?: ProviderResponseFormat;
  toolChoice?: ProviderToolChoice;
  geminiSafetyLevel?: GeminiSafetyLevel;
}

export type GeminiSafetyLevel = 'default' | 'none' | 'low' | 'medium' | 'high';

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
  lastProbe?: {
    success: boolean;
    probedAt: number;
    error?: string;
  };
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

export type ProviderMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ProviderMessageContent[];
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
  sessionTempParams: SessionTempParams;
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
  templates: AssistantTemplate[];
}

export type WebviewInboundMessage =
  | { type: 'ready' }
  | { type: 'createSession' }
  | { type: 'selectSession'; sessionId: string }
  | { type: 'renameSession'; sessionId: string; title: string }
  | { type: 'deleteSession'; sessionId: string }
  | { type: 'setSessionTempModel'; modelRef: string }
  | { type: 'setSessionTempParams'; params: SessionTempParams }
  | { type: 'clearSessionTempParams' }
  | { type: 'toggleSessionPanel' }
  | { type: 'regenerateReply' }
  | { type: 'regenerateFromMessage'; messageId: string }
  | { type: 'copyMessage'; messageId: string }
  | { type: 'deleteMessage'; messageId: string }
  | { type: 'editMessage'; messageId: string; newContent: string; regenerate?: boolean }
  | { type: 'clearSession' }
  | { type: 'setStreaming'; enabled: boolean }
  | { type: 'sendMessage'; content: string; images?: Array<{ base64: string; mimeType: string }>; files?: Array<{ name: string; content: string; language?: string }> }
  | { type: 'continueToolCalls' }
  | { type: 'cancelToolCalls' }
  | { type: 'listMcpResources' }
  | { type: 'listMcpPrompts' }
  | { type: 'readMcpResource'; serverId: string; uri: string }
  | { type: 'getMcpPrompt'; serverId: string; name: string; args: Record<string, string> }
  | { type: 'selectFiles' }
  | { type: 'selectImages' }
  | { type: 'stopGeneration' }
  | { type: 'saveAsTemplate'; assistantId: string; name: string; description?: string }
  | { type: 'createAssistantFromTemplate'; templateId: string }
  | { type: 'deleteTemplate'; templateId: string }
  | { type: 'renameTemplate'; templateId: string; name: string };

export type WebviewOutboundMessage =
  | { type: 'state'; payload: ChatStatePayload }
  | { type: 'error'; message: string }
  | { type: 'mcpResources'; payload: { items: McpResourceEntry[]; message?: string } }
  | { type: 'mcpPrompts'; payload: { items: McpPromptEntry[]; message?: string } }
  | { type: 'mcpInsert'; payload: { content: string; message?: string } }
  | { type: 'prefillComposer'; content: string }
  | { type: 'filesSelected'; files: Array<{ name: string; content: string; language?: string }> }
  | { type: 'imagesSelected'; images: Array<{ base64: string; mimeType: string }> }
  | { type: 'toast'; message: string; tone?: 'success' | 'error' | 'info' };
