/**
 * MCP (Model Context Protocol) 运行时客户端。
 *
 * 管理 MCP 服务器的连接生命周期，支持 stdio、SSE、streamableHttp 三种传输方式。
 * 提供工具发现与调用、资源读取、Prompt 获取等功能。
 *
 * 类型定义 → mcpTypes.ts
 * 工具函数 → mcpUtils.ts
 */
import type {
  AssistantProfile,
  ChatBuddySettings,
  McpPromptArgument,
  McpPromptEntry,
  McpResourceEntry,
  McpServerProfile,
  McpServerSummary
} from './types';
import { toErrorMessage, warn } from './utils';
import type {
  McpClient,
  McpPrompt,
  McpResource,
  McpTool,
  ManagedConnection,
  McpToolBinding
} from './mcpTypes';
import {
  CLIENT_INFO,
  collectPaginated,
  getEnabledServers,
  getInheritedEnv,
  loadMcpModule,
  normalizeToolName,
  stringifyPromptMessages,
  stringifyResourceContents,
  stringifyToolResult,
  toRecord,
  validateStdioLaunchConfig
} from './mcpUtils';

export type { McpToolBinding, McpProbeResult } from './mcpTypes';
export { describeAssistantMcpServers, buildRemotePassthroughTools } from './mcpUtils';

export class McpRuntime {
  private readonly connections = new Map<string, { promise: Promise<ManagedConnection>; createdAt: number }>();
  private toolBindingsCache = new Map<string, { bindings: McpToolBinding[]; expiresAt: number }>();
  private static readonly TOOL_BINDINGS_TTL_MS = 60_000;
  private static readonly CONNECTION_TTL_MS = 30 * 60 * 1000; // 30分钟

  public async probeServer(server: McpServerProfile): Promise<import('./mcpTypes').McpProbeResult> {
    let connection: ManagedConnection | undefined;
    try {
      const { Client } = await loadMcpModule();
      const client = new Client(CLIENT_INFO);
      const transport = await this.connectTransport(client, server);
      connection = { client, transport, server };

      const tools = await collectPaginated<McpTool>(async (cursor) => {
        const response = await client.listTools(cursor ? { cursor } : undefined);
        return { items: response.tools ?? [], nextCursor: response.nextCursor };
      });

      let resources: import('./mcpTypes').McpProbeResult['resources'] = [];
      try {
        const resourceList = await collectPaginated<McpResource>(async (cursor) => {
          const response = await client.listResources(cursor ? { cursor } : undefined);
          return { items: response.resources ?? [], nextCursor: response.nextCursor };
        });
        resources = resourceList
          .filter((r) => typeof r.name === 'string' && r.name.trim())
          .map((r) => ({
            name: r.name!.trim(),
            uri: typeof r.uri === 'string' ? r.uri.trim() : '',
            description: typeof r.description === 'string' ? r.description.trim() : undefined
          }));
      } catch (resourceError) {
        warn('[MCP] Failed to list resources during probe:', resourceError);
      }

      let prompts: import('./mcpTypes').McpProbeResult['prompts'] = [];
      try {
        const promptList = await collectPaginated<McpPrompt>(async (cursor) => {
          const response = await client.listPrompts(cursor ? { cursor } : undefined);
          return { items: response.prompts ?? [], nextCursor: response.nextCursor };
        });
        prompts = promptList
          .filter((p) => typeof p.name === 'string' && p.name.trim())
          .map((p) => ({
            name: p.name!.trim(),
            description: typeof p.description === 'string' ? p.description.trim() : undefined
          }));
      } catch (promptError) {
        warn('[MCP] Failed to list prompts during probe:', promptError);
      }

      return {
        success: true,
        tools: tools
          .filter((tool) => typeof tool.name === 'string' && tool.name.trim())
          .map((tool) => ({
            name: tool.name!.trim(),
            description: typeof tool.description === 'string' ? tool.description!.trim() : ''
          })),
        resources,
        prompts
      };
    } catch (error) {
      return {
        success: false,
        tools: [],
        resources: [],
        prompts: [],
        error: toErrorMessage(error, 'Probe failed.')
      };
    } finally {
      if (connection) {
        try {
          await connection.transport.close();
          await connection.client.close();
        } catch (cleanupError) {
          warn('[MCP] Cleanup error during probe:', cleanupError);
        }
      }
    }
  }

  public getServerSummaries(settings: ChatBuddySettings, assistant?: AssistantProfile): McpServerSummary[] {
    if (!assistant) {
      return [];
    }
    return getEnabledServers(settings, assistant).map((server) => ({
      id: server.id,
      name: server.name,
      enabled: server.enabled,
      transport: server.transport
    }));
  }

  public async dispose(): Promise<void> {
    this.toolBindingsCache.clear();
    const entries = [...this.connections.values()];
    this.connections.clear();
    await Promise.all(
      entries.map(async (entry) => {
        try {
          const connection = await entry.promise;
          await connection.transport.close();
          await connection.client.close();
        } catch (shutdownError) {
          warn('[MCP] Shutdown error during dispose:', shutdownError);
        }
      })
    );
  }

  /**
   * Remove connections for servers that are no longer active or have exceeded TTL.
   * Call this after settings update to clean up stale connections.
   */
  public async pruneConnections(activeServerIds: ReadonlySet<string>): Promise<void> {
    const staleIds: string[] = [];
    const now = Date.now();
    for (const [serverId, entry] of this.connections.entries()) {
      if (!activeServerIds.has(serverId)) {
        staleIds.push(serverId);
      } else if (now - entry.createdAt > McpRuntime.CONNECTION_TTL_MS) {
        staleIds.push(serverId);
      }
    }
    if (!staleIds.length) {
      return;
    }
    for (const serverId of staleIds) {
      const entry = this.connections.get(serverId);
      this.connections.delete(serverId);
      if (entry) {
        try {
          const connection = await entry.promise;
          await connection.transport.close();
          await connection.client.close();
        } catch (shutdownError) {
          warn('[MCP] Shutdown error during prune:', shutdownError);
        }
      }
    }
    // Clear tool bindings cache since server list changed
    this.toolBindingsCache.clear();
  }

  /**
   * Invalidate cached tool bindings for a specific assistant.
   * Call this when MCP server assignments change for an assistant.
   */
  public invalidateToolBindings(assistantId?: string): void {
    if (assistantId) {
      this.toolBindingsCache.delete(assistantId);
    } else {
      this.toolBindingsCache.clear();
    }
  }

  public async listToolBindings(settings: ChatBuddySettings, assistant: AssistantProfile): Promise<McpToolBinding[]> {
    const cacheKey = assistant.id;
    const now = Date.now();
    const cached = this.toolBindingsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.bindings;
    }

    const servers = getEnabledServers(settings, assistant);
    const results = await Promise.allSettled(
      servers.map(async (server) => {
        const connection = await this.getConnection(server);
        const tools = await collectPaginated<McpTool>(async (cursor) => {
          const response = await connection.client.listTools(cursor ? { cursor } : undefined);
          return {
            items: response.tools ?? [],
            nextCursor: response.nextCursor
          };
        });
        return tools
          .filter((tool) => typeof tool.name === 'string' && tool.name.trim())
          .map((tool) => ({
            serverId: server.id,
            toolName: tool.name!.trim(),
            providerTool: {
              type: 'function' as const,
              function: {
                name: normalizeToolName(server.id, tool.name!.trim()),
                description: [server.name, tool.description].filter(Boolean).join(' · '),
                parameters:
                  tool.inputSchema && typeof tool.inputSchema === 'object'
                    ? (tool.inputSchema as Record<string, unknown>)
                    : { type: 'object', properties: {} }
              }
            }
          }));
      })
    );
    const bindings: McpToolBinding[] = [];
    for (const item of results) {
      if (item.status === 'fulfilled') {
        bindings.push(...item.value);
      }
    }
    this.toolBindingsCache.set(cacheKey, {
      bindings,
      expiresAt: now + McpRuntime.TOOL_BINDINGS_TTL_MS
    });
    return bindings;
  }

  public async callBoundTool(
    settings: ChatBuddySettings,
    assistant: AssistantProfile,
    boundName: string,
    argsText: string
  ): Promise<string> {
    const bindings = await this.listToolBindings(settings, assistant);
    const binding = bindings.find(
      (item) => item.providerTool.type === 'function' && item.providerTool.function.name === boundName
    );
    if (!binding) {
      throw new Error(`MCP tool not found: ${boundName}`);
    }
    const server = getEnabledServers(settings, assistant).find((item) => item.id === binding.serverId);
    if (!server) {
      throw new Error(`MCP server not available: ${binding.serverId}`);
    }
    const connection = await this.getConnection(server);
    const parsedArgs = this.parseToolArguments(argsText);
    const result = await connection.client.callTool(
      {
        name: binding.toolName,
        arguments: parsedArgs
      },
      {
        timeout: server.timeoutMs
      }
    );
    return stringifyToolResult(result);
  }

  public async listResources(settings: ChatBuddySettings, assistant: AssistantProfile): Promise<McpResourceEntry[]> {
    const servers = getEnabledServers(settings, assistant);
    const results = await Promise.allSettled(
      servers.map(async (server) => {
        const connection = await this.getConnection(server);
        const resources = await collectPaginated<McpResource>(async (cursor) => {
          const response = await connection.client.listResources(cursor ? { cursor } : undefined);
          return {
            items: response.resources ?? [],
            nextCursor: response.nextCursor
          };
        });
        return resources
          .filter((resource) => typeof resource.uri === 'string' && resource.uri.trim())
          .map((resource) => ({
            serverId: server.id,
            serverName: server.name,
            uri: resource.uri!.trim(),
            name: typeof resource.name === 'string' && resource.name.trim() ? resource.name.trim() : resource.uri!.trim(),
            description: typeof resource.description === 'string' ? resource.description.trim() : undefined,
            mimeType: typeof resource.mimeType === 'string' ? resource.mimeType.trim() : undefined
          }));
      })
    );
    const result: McpResourceEntry[] = [];
    for (const item of results) {
      if (item.status === 'fulfilled') {
        result.push(...item.value);
      }
    }
    return result.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  }

  public async readResource(
    settings: ChatBuddySettings,
    assistant: AssistantProfile,
    serverId: string,
    uri: string
  ): Promise<string> {
    const server = this.getAssistantServer(settings, assistant, serverId);
    const connection = await this.getConnection(server);
    const result = await connection.client.readResource({ uri }, { timeout: server.timeoutMs });
    return stringifyResourceContents(result.contents ?? []);
  }

  public async listPrompts(settings: ChatBuddySettings, assistant: AssistantProfile): Promise<McpPromptEntry[]> {
    const servers = getEnabledServers(settings, assistant);
    const results = await Promise.allSettled(
      servers.map(async (server) => {
        const connection = await this.getConnection(server);
        const prompts = await collectPaginated<McpPrompt>(async (cursor) => {
          const response = await connection.client.listPrompts(cursor ? { cursor } : undefined);
          return {
            items: response.prompts ?? [],
            nextCursor: response.nextCursor
          };
        });
        return prompts
          .filter((prompt) => typeof prompt.name === 'string' && prompt.name.trim())
          .map((prompt) => ({
            serverId: server.id,
            serverName: server.name,
            name: prompt.name!.trim(),
            description: typeof prompt.description === 'string' ? prompt.description.trim() : undefined,
            arguments: Array.isArray(prompt.arguments)
              ? prompt.arguments.map((arg) => this.toPromptArgument(arg))
              : []
          }));
      })
    );
    const result: McpPromptEntry[] = [];
    for (const item of results) {
      if (item.status === 'fulfilled') {
        result.push(...item.value);
      }
    }
    return result.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  }

  public async getPrompt(
    settings: ChatBuddySettings,
    assistant: AssistantProfile,
    serverId: string,
    name: string,
    args: Record<string, string>
  ): Promise<string> {
    const server = this.getAssistantServer(settings, assistant, serverId);
    const connection = await this.getConnection(server);
    const result = await connection.client.getPrompt(
      {
        name,
        arguments: args
      },
      {
        timeout: server.timeoutMs
      }
    );
    return stringifyPromptMessages(result.messages ?? []);
  }

  private async getConnection(server: McpServerProfile): Promise<ManagedConnection> {
    const existing = this.connections.get(server.id);
    if (existing && Date.now() - existing.createdAt <= McpRuntime.CONNECTION_TTL_MS) {
      return existing.promise;
    }
    // TTL 过期或首次连接：清理旧条目（如有）并创建新连接
    if (existing) {
      this.connections.delete(server.id);
      this.closeConnectionGracefully(existing.promise);
    }
    // Dedup: reuse any pending creation that was started by a concurrent call
    const current = this.connections.get(server.id);
    if (current) {
      return current.promise;
    }
    const pending = this.createConnection(server);
    this.connections.set(server.id, { promise: pending, createdAt: Date.now() });
    try {
      return await pending;
    } catch (error) {
      this.connections.delete(server.id);
      throw error;
    }
  }

  private closeConnectionGracefully(promise: Promise<ManagedConnection>): void {
    promise.then(
      async (connection) => {
        try {
          await connection.transport.close();
          await connection.client.close();
        } catch (shutdownError) {
          warn('[MCP] Graceful close error:', shutdownError);
        }
      },
      () => {
        // Connection failed — nothing to clean up.
      }
    );
  }

  private async createConnection(server: McpServerProfile): Promise<ManagedConnection> {
    const { Client } = await loadMcpModule();
    const client = new Client(CLIENT_INFO);
    const transport = await this.connectTransport(client, server);
    return {
      client,
      transport,
      server
    };
  }

  private async connectTransport(serverClient: McpClient, server: McpServerProfile) {
    const { SSEClientTransport, StdioClientTransport, StreamableHTTPClientTransport } = await loadMcpModule();
    if (server.transport === 'stdio') {
      const { command, args } = validateStdioLaunchConfig(server);
      const transport = new StdioClientTransport({
        command,
        args,
        cwd: server.cwd.trim() || undefined,
        env: {
          ...getInheritedEnv(),
          ...toRecord(server.env)
        }
      });
      await serverClient.connect(transport);
      return transport;
    }

    if (!server.url.trim()) {
      throw new Error(`MCP server ${server.name} is missing URL.`);
    }

    const requestInit = {
      headers: toRecord(server.headers)
    };
    const url = new URL(server.url);
    if (server.transport === 'sse') {
      const transport = new SSEClientTransport(url, { requestInit });
      await serverClient.connect(transport);
      return transport;
    }

    try {
      const transport = new StreamableHTTPClientTransport(url, { requestInit });
      await serverClient.connect(transport);
      return transport;
    } catch (streamableError) {
      // Streamable HTTP failed; fall back to SSE transport.
      warn('[MCP] StreamableHTTP failed, falling back to SSE:', streamableError);
      const transport = new SSEClientTransport(url, { requestInit });
      await serverClient.connect(transport);
      return transport;
    }
  }

  private getAssistantServer(
    settings: ChatBuddySettings,
    assistant: AssistantProfile,
    serverId: string
  ): McpServerProfile {
    const server = getEnabledServers(settings, assistant).find((item) => item.id === serverId);
    if (!server) {
      throw new Error(`MCP server not enabled: ${serverId}`);
    }
    return server;
  }

  private parseToolArguments(argsText: string): Record<string, unknown> {
    if (!argsText.trim()) {
      return {};
    }
    try {
      const parsed = JSON.parse(argsText) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Tool arguments must be a JSON object.');
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(toErrorMessage(error, 'Invalid tool arguments.'));
    }
  }

  private toPromptArgument(argument: {
    name?: string;
    description?: string;
    required?: boolean;
  }): McpPromptArgument {
    return {
      name: typeof argument.name === 'string' ? argument.name.trim() : '',
      description: typeof argument.description === 'string' ? argument.description.trim() : undefined,
      required: argument.required !== false
    };
  }
}
