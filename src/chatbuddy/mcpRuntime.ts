import {
  AssistantProfile,
  ChatBuddySettings,
  McpPromptArgument,
  McpPromptEntry,
  McpResourceEntry,
  McpServerProfile,
  McpServerSummary,
  ProviderToolDefinition
} from './types';
import { toErrorMessage } from './utils';

type McpClient = {
  close(): Promise<void>;
  connect(transport: unknown): Promise<void>;
  listTools(params?: { cursor?: string }): Promise<{ tools?: McpTool[]; nextCursor?: string }>;
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    options?: { timeout?: number }
  ): Promise<{
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  }>;
  listResources(params?: { cursor?: string }): Promise<{ resources?: McpResource[]; nextCursor?: string }>;
  readResource(
    params: { uri: string },
    options?: { timeout?: number }
  ): Promise<{ contents?: Array<{ uri?: string; text?: string; mimeType?: string; blob?: string }> }>;
  listPrompts(params?: { cursor?: string }): Promise<{ prompts?: McpPrompt[]; nextCursor?: string }>;
  getPrompt(
    params: { name: string; arguments?: Record<string, string> },
    options?: { timeout?: number }
  ): Promise<{ messages?: Array<{ role: string; content?: { type?: string; text?: string } }> }>;
};

type McpTransport = {
  close(): Promise<void>;
};

type McpTool = {
  name?: string;
  description?: string;
  inputSchema?: unknown;
};

type McpResource = {
  uri?: string;
  name?: string;
  description?: string;
  mimeType?: string;
};

type McpPrompt = {
  name?: string;
  description?: string;
  arguments?: Array<{
    name?: string;
    description?: string;
    required?: boolean;
  }>;
};

type McpModule = {
  Client: new (clientInfo: { name: string; version: string }) => McpClient;
  SSEClientTransport: new (url: URL, options?: { requestInit?: { headers: Record<string, string> } }) => McpTransport;
  StdioClientTransport: new (options: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  }) => McpTransport;
  StreamableHTTPClientTransport: new (
    url: URL,
    options?: { requestInit?: { headers: Record<string, string> } }
  ) => McpTransport;
};

type ManagedConnection = {
  client: McpClient;
  transport: McpTransport;
  server: McpServerProfile;
};

export type McpToolBinding = {
  providerTool: ProviderToolDefinition;
  serverId: string;
  toolName: string;
};

const CLIENT_INFO = { name: 'chatbuddy', version: '0.0.4' };

let cachedMcpModule: Promise<McpModule> | undefined;

async function loadMcpModule(): Promise<McpModule> {
  if (!cachedMcpModule) {
    // @modelcontextprotocol/client is ESM-only; dynamic import() resolves at runtime
    cachedMcpModule = import('@modelcontextprotocol/client') as Promise<McpModule>;
  }
  return cachedMcpModule;
}

function toRecord(entries: Array<{ key: string; value: string }>): Record<string, string> {
  return Object.fromEntries(
    entries
      .map((entry) => [entry.key.trim(), entry.value] as const)
      .filter(([key]) => key.length > 0)
  );
}

function hasInvalidProcessText(value: string): boolean {
  return value.includes('\0') || value.includes('\r') || value.includes('\n');
}

function validateStdioLaunchConfig(server: McpServerProfile): { command: string; args: string[] } {
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

function getEnabledServers(settings: ChatBuddySettings, assistant: AssistantProfile): McpServerProfile[] {
  const enabledIds = new Set(assistant.enabledMcpServerIds);
  return settings.mcp.servers.filter((server) => server.enabled && enabledIds.has(server.id));
}

function toTransportLabel(transport: McpServerProfile['transport']): string {
  switch (transport) {
    case 'streamableHttp':
      return 'HTTP';
    case 'sse':
      return 'SSE';
    default:
      return 'stdio';
  }
}

async function collectPaginated<T>(
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

function getInheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function stringifyToolResult(result: {
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

function stringifyResourceContents(contents: Array<{ uri?: string; text?: string; mimeType?: string; blob?: string }>): string {
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

function stringifyPromptMessages(messages: Array<{ role: string; content?: { type?: string; text?: string } }>): string {
  return messages
    .map((message) => {
      const text = message.content?.type === 'text' ? message.content.text ?? '' : '';
      const role = String(message.role || 'prompt').trim();
      return text.trim() ? `${role}:\n${text.trim()}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function normalizeToolName(serverId: string, name: string): string {
  return `${serverId}__${name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export type McpProbeResult = {
  success: boolean;
  tools: Array<{ name: string; description: string }>;
  resources: Array<{ name: string; uri: string; description?: string }>;
  prompts: Array<{ name: string; description?: string }>;
  error?: string;
};

export class McpRuntime {
  private readonly connections = new Map<string, Promise<ManagedConnection>>();
  private toolBindingsCache = new Map<string, { bindings: McpToolBinding[]; expiresAt: number }>();
  private static readonly TOOL_BINDINGS_TTL_MS = 60_000;

  public async probeServer(server: McpServerProfile): Promise<McpProbeResult> {
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

      let resources: McpProbeResult['resources'] = [];
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
      } catch {
        // Server may not support resources.
      }

      let prompts: McpProbeResult['prompts'] = [];
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
      } catch {
        // Server may not support prompts.
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
        } catch {
          // Ignore cleanup errors.
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
    const pending = [...this.connections.values()];
    this.connections.clear();
    await Promise.all(
      pending.map(async (connectionPromise) => {
        try {
          const connection = await connectionPromise;
          await connection.transport.close();
          await connection.client.close();
        } catch {
          // Ignore shutdown failures.
        }
      })
    );
  }

  public async listToolBindings(settings: ChatBuddySettings, assistant: AssistantProfile): Promise<McpToolBinding[]> {
    const cacheKey = assistant.id;
    const now = Date.now();
    const cached = this.toolBindingsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.bindings;
    }

    const bindings: McpToolBinding[] = [];
    for (const server of getEnabledServers(settings, assistant)) {
      const connection = await this.getConnection(server);
      const tools = await collectPaginated<McpTool>(async (cursor) => {
        const response = await connection.client.listTools(cursor ? { cursor } : undefined);
        return {
          items: response.tools ?? [],
          nextCursor: response.nextCursor
        };
      });
      for (const tool of tools) {
        const toolName = typeof tool.name === 'string' ? tool.name.trim() : '';
        if (!toolName) {
          continue;
        }
        bindings.push({
          serverId: server.id,
          toolName,
          providerTool: {
            type: 'function',
            function: {
              name: normalizeToolName(server.id, toolName),
              description: [server.name, tool.description].filter(Boolean).join(' · '),
              parameters:
                tool.inputSchema && typeof tool.inputSchema === 'object'
                  ? (tool.inputSchema as Record<string, unknown>)
                  : { type: 'object', properties: {} }
            }
          }
        });
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
    const result: McpResourceEntry[] = [];
    for (const server of getEnabledServers(settings, assistant)) {
      const connection = await this.getConnection(server);
      const resources = await collectPaginated<McpResource>(async (cursor) => {
        const response = await connection.client.listResources(cursor ? { cursor } : undefined);
        return {
          items: response.resources ?? [],
          nextCursor: response.nextCursor
        };
      });
      for (const resource of resources) {
        const uri = typeof resource.uri === 'string' ? resource.uri.trim() : '';
        if (!uri) {
          continue;
        }
        result.push({
          serverId: server.id,
          serverName: server.name,
          uri,
          name: typeof resource.name === 'string' && resource.name.trim() ? resource.name.trim() : uri,
          description: typeof resource.description === 'string' ? resource.description.trim() : undefined,
          mimeType: typeof resource.mimeType === 'string' ? resource.mimeType.trim() : undefined
        });
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
    const result: McpPromptEntry[] = [];
    for (const server of getEnabledServers(settings, assistant)) {
      const connection = await this.getConnection(server);
      const prompts = await collectPaginated<McpPrompt>(async (cursor) => {
        const response = await connection.client.listPrompts(cursor ? { cursor } : undefined);
        return {
          items: response.prompts ?? [],
          nextCursor: response.nextCursor
        };
      });
      for (const prompt of prompts) {
        const name = typeof prompt.name === 'string' ? prompt.name.trim() : '';
        if (!name) {
          continue;
        }
        result.push({
          serverId: server.id,
          serverName: server.name,
          name,
          description: typeof prompt.description === 'string' ? prompt.description.trim() : undefined,
          arguments: Array.isArray(prompt.arguments)
            ? prompt.arguments.map((arg) => this.toPromptArgument(arg))
            : []
        });
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
    if (existing) {
      return existing;
    }
    const pending = this.createConnection(server);
    this.connections.set(server.id, pending);
    try {
      return await pending;
    } catch (error) {
      this.connections.delete(server.id);
      throw error;
    }
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
    } catch (error) {
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
): Array<{ serverId: string; tool: ProviderToolDefinition }> {
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
