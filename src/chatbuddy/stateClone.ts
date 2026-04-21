/**
 * 状态深拷贝模块。
 *
 * 提供所有核心数据类型的不可变克隆函数，确保状态变更时不会意外修改共享引用。
 */
import type { AssistantGroup, AssistantProfile, ChatSession, ChatSessionSummary, McpKeyValueEntry, McpServerProfile, McpSettings, ProviderProfile } from './types';

export function cloneProvider(provider: ProviderProfile): ProviderProfile {
  return {
    ...provider,
    models: provider.models.map((model) => ({ ...model }))
  };
}

export function cloneGroup(group: AssistantGroup): AssistantGroup {
  return {
    ...group
  };
}

export function cloneAssistant(assistant: AssistantProfile): AssistantProfile {
  return {
    ...assistant,
    enabledMcpServerIds: [...assistant.enabledMcpServerIds],
    overrides: assistant.overrides ? { ...assistant.overrides } : undefined
  };
}

export function cloneMcpKeyValueEntries(entries: McpKeyValueEntry[]): McpKeyValueEntry[] {
  return entries.map((entry) => ({
    key: entry.key,
    value: entry.value
  }));
}

export function cloneMcpServer(server: McpServerProfile): McpServerProfile {
  return {
    ...server,
    args: [...server.args],
    env: cloneMcpKeyValueEntries(server.env),
    headers: cloneMcpKeyValueEntries(server.headers)
  };
}

export function cloneMcpSettings(settings: McpSettings): McpSettings {
  return {
    maxToolRounds: settings.maxToolRounds,
    servers: settings.servers.map(cloneMcpServer)
  };
}

export function cloneSession(session: ChatSession): ChatSession {
  return {
    ...session,
    messages: [...session.messages]
  };
}

export function cloneSessionSummary(session: ChatSessionSummary): ChatSessionSummary {
  return {
    ...session
  };
}
