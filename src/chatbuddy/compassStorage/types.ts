/**
 * Compass 存储类型定义与数据规范化工具模块。
 *
 * 包含结构化存储的 TypeScript 类型（StateDocument、SettingsFile、Commit 等），
 * 以及将原始数据安全转换为已知类型的工具函数（`toStringValue`、`toNumberValue` 等）。
 */
import {
  AssistantGroup,
  AssistantProfile,
  ChatBuddySettings,
  ChatMessage,
  ChatSessionDetail,
  ChatSessionSummary,
  DefaultModelSettings,
  McpSettings,
  ProviderProfile
} from '../types';

export type SessionTitleSource = ChatSessionDetail['titleSource'];

export type SessionSummaryInternal = {
  id: string;
  assistantId: string;
  title: string;
  titleSource: SessionTitleSource;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview?: string;
};

export type CompassIndexFile = {
  sessions: SessionSummaryInternal[];
};

export type CompassMigrationRecord = {
  name: 'compass';
  layoutVersion: number;
  source: 'fresh' | 'sqlite' | 'existing-compass' | 'existing-structured';
  migratedAt: string;
  legacyPath?: string;
};

export type CompassValidationResult = {
  valid: boolean;
  reason?: string;
};

export type StructuredStateCoreFile = {
  groups: AssistantGroup[];
  assistants: AssistantProfile[];
};

export type StructuredUiSelectionFile = {
  selectedAssistantId?: string;
  selectedSessionIdByAssistant: Record<string, string>;
  sessionPanelCollapsed: boolean;
  collapsedGroupIds: string[];
};

export type StructuredSettingsGeneralFile = Pick<
  ChatBuddySettings,
  | 'temperature'
  | 'topP'
  | 'maxTokens'
  | 'presencePenalty'
  | 'frequencyPenalty'
  | 'timeoutMs'
  | 'streamingDefault'
  | 'locale'
  | 'sendShortcut'
  | 'chatTabMode'
>;

export type StructuredSettingsModelConfigFile = {
  providers: ProviderProfile[];
};

export type StructuredSettingsDefaultModelsFile = {
  defaultModels: DefaultModelSettings;
};

export type StructuredSettingsMcpFile = {
  mcp: McpSettings;
};

export type StructuredStateDocument = {
  core: StructuredStateCoreFile;
  ui: StructuredUiSelectionFile;
  settingsGeneral: StructuredSettingsGeneralFile;
  settingsModelConfig: StructuredSettingsModelConfigFile;
  settingsDefaultModels: StructuredSettingsDefaultModelsFile;
  settingsMcp: StructuredSettingsMcpFile;
};

export type StructuredStateCommitFile = {
  name: 'compass-structured-state';
  layoutVersion: number;
  generation: number;
  writtenAt: string;
};

export type LegacySqliteRows = {
  sessions: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  kv: Array<Record<string, unknown>>;
};

export function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function toNumberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function toRoleValue(value: unknown): ChatMessage['role'] {
  if (value === 'user' || value === 'assistant' || value === 'system') {
    return value;
  }
  return 'assistant';
}

export function toTitleSource(value: unknown): SessionTitleSource {
  if (value === 'default' || value === 'generated' || value === 'custom') {
    return value;
  }
  return 'default';
}

export function buildPreview(messages: ChatMessage[], maxLength = 240): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = toStringValue(messages[index].content).trim();
    if (!content) {
      continue;
    }
    return content.slice(0, maxLength);
  }
  return undefined;
}

export function cloneSummary(summary: SessionSummaryInternal): ChatSessionSummary {
  return {
    id: summary.id,
    assistantId: summary.assistantId,
    title: summary.title,
    titleSource: summary.titleSource,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    messageCount: summary.messageCount,
    preview: summary.preview
  };
}

export function cloneMessage(message: ChatMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    model: message.model,
    reasoning: message.reasoning,
    toolRounds: message.toolRounds
      ? message.toolRounds.map((round) => ({
          reasoning: round.reasoning,
          calls: round.calls.map((call) => ({
            id: call.id,
            name: call.name,
            argumentsText: call.argumentsText,
            output: call.output
          }))
        }))
      : undefined,
    images: message.images
      ? message.images.map((image) => ({
          base64: image.base64,
          mimeType: image.mimeType
        }))
      : undefined
  };
}

export function normalizeMessageInput(message: ChatMessage, now: number): ChatMessage {
  return {
    id: toStringValue(message.id),
    role: toRoleValue(message.role),
    content: toStringValue(message.content),
    timestamp: toNumberValue(message.timestamp, now),
    model: toStringValue(message.model).trim() || undefined,
    reasoning: toStringValue(message.reasoning).trim() || undefined,
    toolRounds: Array.isArray(message.toolRounds) && message.toolRounds.length > 0 ? message.toolRounds : undefined,
    images: Array.isArray(message.images) && message.images.length > 0 ? message.images : undefined
  };
}

export function normalizeSummary(summary: SessionSummaryInternal, now: number): SessionSummaryInternal {
  return {
    id: toStringValue(summary.id),
    assistantId: toStringValue(summary.assistantId),
    title: toStringValue(summary.title),
    titleSource: toTitleSource(summary.titleSource),
    createdAt: toNumberValue(summary.createdAt, now),
    updatedAt: toNumberValue(summary.updatedAt, now),
    messageCount: Math.max(0, Math.floor(toNumberValue(summary.messageCount, 0))),
    preview: toStringValue(summary.preview).trim() || undefined
  };
}
