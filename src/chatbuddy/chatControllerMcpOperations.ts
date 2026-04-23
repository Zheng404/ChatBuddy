/**
 * 聊天控制器 MCP 操作代理。
 *
 * 封装 listResources / listPrompts / insertResource / insertPrompt
 * 四个高度重复的 MCP 操作模式，提取通用 `runMcpOp` 辅助函数消除重复。
 */
import type { ChatStateRepository } from './stateRepository';
import type { McpRuntime } from './mcpRuntime';
import type { AssistantProfile, ChatBuddySettings, RuntimeLocale, WebviewOutboundMessage } from './types';
import { getStrings } from './i18n';
import { toErrorMessage } from './utils';
import type { ToolOrchestratorPanelContext as PanelMessageContext } from './chatControllerToolOrchestrator';

export interface McpOperationDeps {
  readonly repository: ChatStateRepository;
  readonly mcpRuntime: McpRuntime;
  readonly getLocale: () => RuntimeLocale;
  readonly postMessage: (message: WebviewOutboundMessage, context?: PanelMessageContext) => void;
  readonly postError: (message: string, context?: PanelMessageContext) => void;
}

async function runMcpOp<T>(
  deps: McpOperationDeps,
  options: {
    execute: (settings: ChatBuddySettings, assistant: AssistantProfile) => Promise<T>;
    buildMessage: (result: T) => WebviewOutboundMessage;
    context?: PanelMessageContext;
  }
): Promise<void> {
  const assistant = deps.repository.getSelectedAssistant();
  if (!assistant || assistant.isDeleted) {
    return;
  }
  const settings = deps.repository.getSettings();
  try {
    const result = await options.execute(settings, assistant);
    deps.postMessage(options.buildMessage(result), options.context);
  } catch (error) {
    deps.postError(toErrorMessage(error, getStrings(deps.getLocale()).unknownError), options.context);
  }
}

export async function listMcpResources(deps: McpOperationDeps, context?: PanelMessageContext): Promise<void> {
  await runMcpOp(deps, {
    execute: (settings, assistant) => deps.mcpRuntime.listResources(settings, assistant),
    buildMessage: (items) => ({ type: 'mcpResources', payload: { items } }),
    context
  });
}

export async function listMcpPrompts(deps: McpOperationDeps, context?: PanelMessageContext): Promise<void> {
  await runMcpOp(deps, {
    execute: (settings, assistant) => deps.mcpRuntime.listPrompts(settings, assistant),
    buildMessage: (items) => ({ type: 'mcpPrompts', payload: { items } }),
    context
  });
}

export async function insertMcpResource(
  deps: McpOperationDeps,
  serverId: string,
  uri: string,
  context?: PanelMessageContext
): Promise<void> {
  await runMcpOp(deps, {
    execute: (settings, assistant) => deps.mcpRuntime.readResource(settings, assistant, serverId, uri),
    buildMessage: (content) => ({ type: 'mcpInsert', payload: { content } }),
    context
  });
}

export async function insertMcpPrompt(
  deps: McpOperationDeps,
  serverId: string,
  name: string,
  args: Record<string, string>,
  context?: PanelMessageContext
): Promise<void> {
  await runMcpOp(deps, {
    execute: (settings, assistant) => deps.mcpRuntime.getPrompt(settings, assistant, serverId, name, args),
    buildMessage: (content) => ({ type: 'mcpInsert', payload: { content } }),
    context
  });
}
