/**
 * MCP (Model Context Protocol) 类型定义。
 *
 * 从 mcpRuntime.ts 中提取的类型，供 MCP 相关模块共享。
 */
import type { ProviderToolDefinition } from './types';

export type McpClient = {
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

export type McpTransport = {
  close(): Promise<void>;
};

export type McpTool = {
  name?: string;
  description?: string;
  inputSchema?: unknown;
};

export type McpResource = {
  uri?: string;
  name?: string;
  description?: string;
  mimeType?: string;
};

export type McpPrompt = {
  name?: string;
  description?: string;
  arguments?: Array<{
    name?: string;
    description?: string;
    required?: boolean;
  }>;
};

export type McpModule = {
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

export type ManagedConnection = {
  client: McpClient;
  transport: McpTransport;
  server: import('./types').McpServerProfile;
};

export type McpToolBinding = {
  providerTool: ProviderToolDefinition;
  serverId: string;
  toolName: string;
};

export type McpProbeResult = {
  success: boolean;
  tools: Array<{ name: string; description: string }>;
  resources: Array<{ name: string; uri: string; description?: string }>;
  prompts: Array<{ name: string; description?: string }>;
  error?: string;
};
