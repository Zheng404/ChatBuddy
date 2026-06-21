/**
 * MCP 工具函数集合。
 *
 * 从 mcpRuntime.ts 中提取的纯函数，无状态、无副作用，
 * 便于独立测试和复用。
 */
import type { AssistantProfile, ChatBuddySettings, McpServerProfile } from './types';
import type { McpModule } from './mcpTypes';

export const CLIENT_INFO = { name: 'chatbuddy', version: '0.0.4' };

let cachedMcpModule: Promise<McpModule> | undefined;

export async function loadMcpModule(): Promise<McpModule> {
  if (!cachedMcpModule) {
    // @modelcontextprotocol/client is ESM-only; dynamic import() resolves at runtime
    cachedMcpModule = import('@modelcontextprotocol/client')
      .then((mod) => mod as McpModule)
      .catch((err) => {
        cachedMcpModule = undefined; // 清除缓存允许重试
        throw err;
      });
  }
  return cachedMcpModule;
}

export function toRecord(entries: Array<{ key: string; value: string }>): Record<string, string> {
  return Object.fromEntries(
    entries
      .map((entry) => [entry.key.trim(), entry.value] as const)
      .filter(([key]) => key.length > 0)
  );
}

export function hasInvalidProcessText(value: string): boolean {
  return value.includes('\0') || value.includes('\r') || value.includes('\n');
}

export function validateStdioLaunchConfig(server: McpServerProfile): { command: string; args: string[] } {
  const command = server.command.trim();
  if (!command) {
    throw new Error(`MCP server ${server.name} is missing command.`);
  }
  if (hasInvalidProcessText(command)) {
    throw new Error(`MCP server ${server.name} command contains invalid control characters.`);
  }
  if (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string' || hasInvalidProcessText(arg))) {
    throw new Error(`MCP server ${server.name} args must be an array of plain strings.`);
  }
  return {
    command,
    args: server.args
  };
}

export function getEnabledServers(settings: ChatBuddySettings, assistant: AssistantProfile): McpServerProfile[] {
  const enabledIds = new Set(assistant.enabledMcpServerIds);
  const groupEnabled = new Map<string, boolean>();
  for (const group of settings.mcp.groups || []) {
    groupEnabled.set(group.id, group.enabled !== false);
  }
  return settings.mcp.servers.filter((server) => {
    if (!server.enabled || !enabledIds.has(server.id)) {
      return false;
    }
    if (!server.groupId) {
      return true;
    }
    if (!groupEnabled.has(server.groupId)) {
      // Group was deleted — treat as disabled
      return false;
    }
    return groupEnabled.get(server.groupId) !== false;
  });
}

export function toTransportLabel(transport: McpServerProfile['transport']): string {
  switch (transport) {
    case 'streamableHttp':
      return 'HTTP';
    case 'sse':
      return 'SSE';
    case 'stdio':
      return 'stdio';
  }
}

export async function collectPaginated<T>(
  loader: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>
): Promise<T[]> {
  const result: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await loader(cursor);
    result.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return result;
}

export function getInheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

export function stringifyToolResult(result: {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}): string {
  const chunks: string[] = [];
  for (const item of result.content ?? []) {
    if (item?.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
      chunks.push(item.text.trim());
    }
  }
  if (chunks.length > 0) {
    return chunks.join('\n\n');
  }
  if (result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent, null, 2);
  }
  if (result.isError) {
    return 'Tool execution failed.';
  }
  return 'Tool completed with no textual output.';
}

export function stringifyResourceContents(contents: Array<{ uri?: string; text?: string; mimeType?: string; blob?: string }>): string {
  const chunks: string[] = [];
  for (const item of contents) {
    if (typeof item.text === 'string' && item.text.trim()) {
      chunks.push(item.text.trim());
      continue;
    }
    if (typeof item.blob === 'string' && item.blob.trim()) {
      chunks.push(item.blob.trim());
    }
  }
  return chunks.join('\n\n').trim();
}

export function stringifyPromptMessages(messages: Array<{ role: string; content?: { type?: string; text?: string } }>): string {
  return messages
    .map((message) => {
      const text = message.content?.type === 'text' ? message.content.text ?? '' : '';
      const role = String(message.role || 'prompt').trim();
      return text.trim() ? `${role}:\n${text.trim()}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

export function normalizeToolName(serverId: string, name: string): string {
  return `${serverId}__${name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function describeAssistantMcpServers(
  settings: ChatBuddySettings,
  assistant?: AssistantProfile
): string {
  if (!assistant) {
    return '';
  }
  return getEnabledServers(settings, assistant)
    .map((server) => `${server.name} (${toTransportLabel(server.transport)})`)
    .join(', ');
}

export function buildRemotePassthroughTools(
  settings: ChatBuddySettings,
  assistant: AssistantProfile,
  allowRemotePassthrough: boolean
): Array<{ serverId: string; tool: { type: 'mcp'; server_label: string; server_url: string; headers?: Record<string, string>; require_approval: 'never' } }> {
  if (!allowRemotePassthrough) {
    return [];
  }
  return getEnabledServers(settings, assistant)
    .filter((server) => server.transport !== 'stdio' && server.remotePassthroughEnabled && server.url.trim())
    .map((server) => ({
      serverId: server.id,
      tool: {
        type: 'mcp' as const,
        server_label: server.name,
        server_url: server.url.trim(),
        headers: server.headers.length > 0 ? toRecord(server.headers) : undefined,
        require_approval: 'never' as const
      }
    }));
}
