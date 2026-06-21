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
  McpTransport,
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

/**
 * MCP (Model Context Protocol) 运行时客户端。
 *
 * 管理 MCP 服务器的连接生命周期，支持 stdio、SSE、streamableHttp 三种传输方式。
 * 提供工具发现与调用、资源读取、Prompt 获取等功能。
 */
export class McpRuntime {
  private readonly connections = new Map<string, { promise: Promise<ManagedConnection>; createdAt: number; lastUsedAt: number }>();
  private readonly connectionLocks = new Map<string, Promise<ManagedConnection>>();
  private toolBindingsCache = new Map<string, { bindings: McpToolBinding[]; expiresAt: number }>();
  private disposed = false;
  private static readonly TOOL_BINDINGS_TTL_MS = 60_000;
  private static readonly CONNECTION_TTL_MS = 30 * 60 * 1000; // 30分钟
  private static readonly CONNECTION_TIMEOUT_MS = 30_000; // 30秒
  private static readonly CONNECTION_IDLE_PRUNE_MS = 60_000; // 60秒无使用则可被裁剪

  /** Race a promise against a timeout, rejecting with a descriptive message on timeout. */
  private static withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /**
   * 探测单个 MCP 服务器的可用性和能力列表。
   * @param server - MCP 服务器配置
   * @returns 探测结果（包含工具、资源、Prompt 列表或错误信息）
   */
  public async probeServer(server: McpServerProfile): Promise<import('./mcpTypes').McpProbeResult> {
    let client: McpClient | undefined;
    let transport: McpTransport | undefined;
    try {
      const { Client } = await loadMcpModule();
      client = new Client(CLIENT_INFO);
      transport = await this.connectTransport(client, server);
      // 捕获 client 引用，避免回调中使用 `client!` 非空断言
      const clientRef = client;

      let tools: McpTool[] = [];
      try {
        tools = await collectPaginated<McpTool>(async (cursor) => {
          const response = await clientRef.listTools(cursor ? { cursor } : undefined);
          return { items: response.tools ?? [], nextCursor: response.nextCursor };
        });
      } catch (toolError) {
        warn('[MCP] Failed to list tools during probe:', toolError);
      }

      let resources: import('./mcpTypes').McpProbeResult['resources'] = [];
      try {
        const resourceList = await collectPaginated<McpResource>(async (cursor) => {
          const response = await clientRef.listResources(cursor ? { cursor } : undefined);
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
          const response = await clientRef.listPrompts(cursor ? { cursor } : undefined);
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
      if (transport) {
        try { await transport.close(); } catch (cleanupError) {
          warn('[MCP] Cleanup error during probe (transport):', cleanupError);
        }
      }
      if (client) {
        try { await client.close(); } catch (cleanupError) {
          warn('[MCP] Cleanup error during probe (client):', cleanupError);
        }
      }
    }
  }

  /**
   * 获取助手当前启用的 MCP 服务器摘要列表。
   * @param settings - 全局设置
   * @param assistant - 助手配置
   * @returns MCP 服务器摘要数组
   */
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

  /**
   * 释放所有 MCP 连接并清理资源。
   * @returns Promise，清理完成后 resolve
   */
  public async dispose(): Promise<void> {
    this.disposed = true;
    this.toolBindingsCache.clear();
    this.connectionLocks.clear();
    const entries = [...this.connections.values()];
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
    this.connections.clear();
  }

  /**
   * 移除不再活跃或超过 TTL 的连接。
   * 在设置更新后调用以清理过期连接。
   * @param activeServerIds - 当前活跃的 MCP 服务器 ID 集合
   * @returns Promise，裁剪完成后 resolve
   */
  public async pruneConnections(activeServerIds: ReadonlySet<string>): Promise<void> {
    const staleIds: string[] = [];
    const now = Date.now();
    for (const [serverId, entry] of this.connections.entries()) {
      if (!activeServerIds.has(serverId)) {
        staleIds.push(serverId);
      } else if (now - entry.createdAt > McpRuntime.CONNECTION_TTL_MS && now - (entry.lastUsedAt ?? entry.createdAt) > McpRuntime.CONNECTION_IDLE_PRUNE_MS) {
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
   * 使指定助手的工具绑定缓存失效。
   * 当助手的 MCP 服务器分配发生变化时调用。
   * @param assistantId - 可选的助手 ID，不传则清除所有缓存
   */
  public invalidateToolBindings(assistantId?: string): void {
    if (assistantId) {
      this.toolBindingsCache.delete(assistantId);
    } else {
      this.toolBindingsCache.clear();
    }
  }

  /**
   * 获取助手当前可用的所有 MCP 工具绑定（含缓存）。
   * @param settings - 全局设置
   * @param assistant - 助手配置
   * @returns 工具绑定数组
   * @throws {Error} 当服务器连接失败或超时时抛出
   */
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
        const tools = await McpRuntime.withTimeout(
          collectPaginated<McpTool>(async (cursor) => {
            const response = await connection.client.listTools(cursor ? { cursor } : undefined);
            return {
              items: response.tools ?? [],
              nextCursor: response.nextCursor
            };
          }),
          10_000,
          `Listing tools from MCP server ${server.name} timed out after 10s`
        );
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
      } else {
        const failedServer = servers[results.indexOf(item)];
        warn('[MCP] Server failed:', failedServer?.id, item.reason);
      }
    }
    this.toolBindingsCache.set(cacheKey, {
      bindings,
      expiresAt: now + McpRuntime.TOOL_BINDINGS_TTL_MS
    });
    return bindings;
  }

  /**
   * 调用已绑定的 MCP 工具。
   * @param settings - 全局设置
   * @param assistant - 助手配置
   * @param boundName - 绑定后的工具名称
   * @param argsText - 工具参数的 JSON 字符串
   * @returns 工具调用结果的字符串表示
   * @throws {Error} 当工具或服务器不可用时抛出
   */
  public async callBoundTool(
    settings: ChatBuddySettings,
    assistant: AssistantProfile,
    boundName: string,
    argsText: string,
    signal?: AbortSignal
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
    this.touchConnection(server.id);
    const parsedArgs = this.parseToolArguments(argsText);
    const timeout = this.resolveServerTimeout(server);
    // Bug 2: 通过 AbortSignal 实现可中断的工具调用
    const result = await this.raceWithAbort(
      connection.client.callTool(
        {
          name: binding.toolName,
          arguments: parsedArgs
        },
        {
          timeout
        }
      ),
      signal
    );
    return stringifyToolResult(result);
  }

  /**
   * 获取助手当前可用的所有 MCP 资源列表。
   * @param settings - 全局设置
   * @param assistant - 助手配置
   * @returns 资源条目数组
   * @throws {Error} 当服务器连接失败或超时时抛出
   */
  public async listResources(settings: ChatBuddySettings, assistant: AssistantProfile): Promise<McpResourceEntry[]> {
    const servers = getEnabledServers(settings, assistant);
    const results = await Promise.allSettled(
      servers.map(async (server) => {
        const connection = await this.getConnection(server);
        const resources = await McpRuntime.withTimeout(
          collectPaginated<McpResource>(async (cursor) => {
            const response = await connection.client.listResources(cursor ? { cursor } : undefined);
            return {
              items: response.resources ?? [],
              nextCursor: response.nextCursor
            };
          }),
          10_000,
          `Listing resources from MCP server ${server.name} timed out after 10s`
        );
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
      } else {
        const failedServer = servers[results.indexOf(item)];
        warn('[MCP] Server failed:', failedServer?.id, item.reason);
      }
    }
    return result.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  }

  /**
   * 读取指定 MCP 资源的内容。
   * @param settings - 全局设置
   * @param assistant - 助手配置
   * @param serverId - MCP 服务器 ID
   * @param uri - 资源 URI
   * @returns 资源内容的字符串表示
   * @throws {Error} 当服务器不可用或资源读取失败时抛出
   */
  public async readResource(
    settings: ChatBuddySettings,
    assistant: AssistantProfile,
    serverId: string,
    uri: string
  ): Promise<string> {
    const server = this.getAssistantServer(settings, assistant, serverId);
    const connection = await this.getConnection(server);
    this.touchConnection(serverId);
    // Bug 8: 统一超时兜底，避免 timeoutMs=0 时无超时挂起
    const result = await connection.client.readResource({ uri }, { timeout: this.resolveServerTimeout(server) });
    return stringifyResourceContents(result.contents ?? []);
  }

  /**
   * 获取助手当前可用的所有 MCP Prompt 列表。
   * @param settings - 全局设置
   * @param assistant - 助手配置
   * @returns Prompt 条目数组
   * @throws {Error} 当服务器连接失败或超时时抛出
   */
  public async listPrompts(settings: ChatBuddySettings, assistant: AssistantProfile): Promise<McpPromptEntry[]> {
    const servers = getEnabledServers(settings, assistant);
    const results = await Promise.allSettled(
      servers.map(async (server) => {
        const connection = await this.getConnection(server);
        const prompts = await McpRuntime.withTimeout(
          collectPaginated<McpPrompt>(async (cursor) => {
            const response = await connection.client.listPrompts(cursor ? { cursor } : undefined);
            return {
              items: response.prompts ?? [],
              nextCursor: response.nextCursor
            };
          }),
          10_000,
          `Listing prompts from MCP server ${server.name} timed out after 10s`
        );
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
      } else {
        const failedServer = servers[results.indexOf(item)];
        warn('[MCP] Server failed:', failedServer?.id, item.reason);
      }
    }
    return result.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  }

  /**
   * 获取指定 MCP Prompt 的渲染结果。
   * @param settings - 全局设置
   * @param assistant - 助手配置
   * @param serverId - MCP 服务器 ID
   * @param name - Prompt 名称
   * @param args - Prompt 参数字典
   * @returns Prompt 消息内容的字符串表示
   * @throws {Error} 当服务器不可用或 Prompt 获取失败时抛出
   */
  public async getPrompt(
    settings: ChatBuddySettings,
    assistant: AssistantProfile,
    serverId: string,
    name: string,
    args: Record<string, string>
  ): Promise<string> {
    const server = this.getAssistantServer(settings, assistant, serverId);
    const connection = await this.getConnection(server);
    this.touchConnection(serverId);
    // Bug 8: 统一超时兜底，避免 timeoutMs=0 时无超时挂起
    const result = await connection.client.getPrompt(
      {
        name,
        arguments: args
      },
      {
        timeout: this.resolveServerTimeout(server)
      }
    );
    return stringifyPromptMessages(result.messages ?? []);
  }

  /**
   * 解析 MCP 服务器的调用超时（Bug 8）。
   *
   * 统一为 callBoundTool / readResource / getPrompt 提供兜底：
   * - timeoutMs 为 0 或 falsy 时回退到默认连接超时（30s）
   * - 下限 1000ms，避免极小值导致误触发
   */
  private resolveServerTimeout(server: McpServerProfile): number {
    return Math.max(1000, server.timeoutMs || McpRuntime.CONNECTION_TIMEOUT_MS);
  }

  /**
   * 用 AbortSignal 包装一个 promise，signal abort 时立即拒绝（Bug 2）。
   *
   * MCP transport 层取消能力不一致（stdio/SSE/HTTP），此处通过 Promise.race 提供统一的
   * 可中断语义封装。无论 promise 是否真正取消，调用方都能快速感知用户中断。
   * 注意：监听器在 finally 中显式移除，避免 signal 长期存活时泄漏。
   */
  private raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) {
      return promise;
    }
    if (signal.aborted) {
      return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }
    let onAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    return Promise.race([promise, abortPromise]).finally(() => {
      if (onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    });
  }

  private async getConnection(server: McpServerProfile): Promise<ManagedConnection> {
    if (this.disposed) {
      throw new Error('McpRuntime has been disposed');
    }
    const existing = this.connections.get(server.id);
    if (existing && Date.now() - existing.createdAt <= McpRuntime.CONNECTION_TTL_MS) {
      return existing.promise;
    }
    // 使用锁防止并发创建
    const lock = this.connectionLocks.get(server.id);
    if (lock) {
      return lock;
    }
    const pending = this.doGetConnection(server);
    this.connectionLocks.set(server.id, pending);
    try {
      return await pending;
    } finally {
      this.connectionLocks.delete(server.id);
    }
  }

  /** Update the lastUsedAt timestamp for a connection to prevent pruning while in use. */
  private touchConnection(serverId: string): void {
    const entry = this.connections.get(serverId);
    if (entry) {
      entry.lastUsedAt = Date.now();
    }
  }

  private async doGetConnection(server: McpServerProfile): Promise<ManagedConnection> {
    // 双重检查
    const existing = this.connections.get(server.id);
    if (existing && Date.now() - existing.createdAt <= McpRuntime.CONNECTION_TTL_MS) {
      return existing.promise;
    }
    if (existing) {
      this.connections.delete(server.id);
      this.closeConnectionGracefully(existing.promise);
    }
    const pending = this.createConnection(server);
    const now = Date.now();
    this.connections.set(server.id, { promise: pending, createdAt: now, lastUsedAt: now });
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
          const closePromise = Promise.all([connection.transport.close(), connection.client.close()]);
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Graceful close timed out after 5s')), 5000);
          });
          await Promise.race([closePromise, timeoutPromise]).finally(() => {
            if (timer) clearTimeout(timer);
          });
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
    const timeoutMs = Math.max(1000, server.timeoutMs || McpRuntime.CONNECTION_TIMEOUT_MS);
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    const connectPromise = this.connectTransport(client, server);
    const timeoutPromise = new Promise<never>((_, reject) => {
      connectTimer = setTimeout(() => reject(new Error(`MCP connection to ${server.name} timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    const transport = await Promise.race([connectPromise, timeoutPromise]).finally(() => {
      if (connectTimer) clearTimeout(connectTimer);
    });
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
      try {
        const transport = new SSEClientTransport(url, { requestInit });
        await serverClient.connect(transport);
        return transport;
      } catch (sseError) {
        const streamableMsg = toErrorMessage(streamableError, 'unknown');
        const sseMsg = toErrorMessage(sseError, 'unknown');
        throw new Error(`SSE transport failed: ${sseMsg} (original StreamableHTTP error: ${streamableMsg})`);
      }
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
