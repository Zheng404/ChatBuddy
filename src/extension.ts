import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';

import { AssistantsTreeProvider, AssistantGroupNode, AssistantNode } from './chatbuddy/assistantsView';
import { AssistantEditorPanelController } from './chatbuddy/assistantEditorPanel';
import { ChatController } from './chatbuddy/chatController';
import { DEFAULT_GROUP_ID, DELETED_GROUP_ID, isLegacyDefaultGroupName } from './chatbuddy/constants';
import { formatString, getStrings, resolveLocale } from './chatbuddy/i18n';
import { McpRuntime } from './chatbuddy/mcpRuntime';
import { OpenAICompatibleClient } from './chatbuddy/providerClient';
import { SessionNode, SessionsTreeProvider } from './chatbuddy/sessionsView';
import { SettingsCenterPanelController } from './chatbuddy/settingsCenterPanel';
import { escapeHtml, resolveLocaleString, warn } from './chatbuddy/utils';
import { ChatStateRepository } from './chatbuddy/stateRepository';
import { ChatBuddySettings, ChatSessionDetail } from './chatbuddy/types';

const MIN_SETTINGS_VIEW_ROWS = 4;

function buildBackupFileName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `chatbuddy-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
}

type SessionExportFormat = 'json' | 'markdown' | 'html';

function sanitizeFileNameSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, 80);
}

function buildSessionExportFileName(sessionTitle: string, extension: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const title = sanitizeFileNameSegment(sessionTitle, 'session');
  return `${title}-${stamp}.${extension}`;
}

function formatMessageTime(timestamp: number, locale: string): string {
  const targetLocale = resolveLocaleString(locale, 'zh-CN', 'en-US');
  try {
    return new Date(timestamp).toLocaleString(targetLocale);
  } catch {
    return new Date(timestamp).toISOString();
  }
}

function resolveMessageRoleLabel(
  role: 'system' | 'user' | 'assistant',
  assistantName: string,
  strings: Record<string, string>
): string {
  if (role === 'assistant') {
    return assistantName;
  }
  if (role === 'user') {
    return strings.userRole;
  }
  return strings.systemRole;
}

function buildSessionMarkdownExport(
  session: ChatSessionDetail,
  assistantName: string,
  locale: string,
  strings: Record<string, string>
): string {
  const lines: string[] = [];
  lines.push(`# ${session.title?.trim() || strings.untitledSession}`);
  lines.push('');
  lines.push(`- ${strings.assistantRole}: ${assistantName}`);
  lines.push(`- ${strings.exportGeneratedAtLabel}: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');

  for (const message of session.messages) {
    const roleLabel = resolveMessageRoleLabel(message.role, assistantName, strings);
    const timestamp = formatMessageTime(message.timestamp, locale);
    const modelSuffix = message.model?.trim() ? ` · ${message.model.trim()}` : '';
    lines.push('');
    lines.push(`## ${roleLabel} · ${timestamp}${modelSuffix}`);
    lines.push('');
    lines.push(message.content || '');
    const reasoning = message.reasoning?.trim();
    if (reasoning) {
      lines.push('');
      lines.push(`<details><summary>${strings.reasoningSectionTitle}</summary>`);
      lines.push('');
      lines.push(reasoning);
      lines.push('');
      lines.push('</details>');
    }
  }
  lines.push('');
  return lines.join('\n');
}

function buildSessionHtmlExport(
  session: ChatSessionDetail,
  assistantName: string,
  locale: string,
  strings: Record<string, string>
): string {
  const title = escapeHtml(session.title?.trim() || strings.untitledSession);
  const exportedAt = escapeHtml(new Date().toISOString());
  const assistant = escapeHtml(assistantName);
  const messageBlocks = session.messages
    .map((message) => {
      const roleLabel = escapeHtml(resolveMessageRoleLabel(message.role, assistantName, strings));
      const timestamp = escapeHtml(formatMessageTime(message.timestamp, locale));
      const model = message.model?.trim() ? ` · ${escapeHtml(message.model.trim())}` : '';
      const content = escapeHtml(message.content || '').replace(/\n/g, '<br/>');
      const reasoning = message.reasoning?.trim()
        ? `<details><summary>${escapeHtml(strings.reasoningSectionTitle)}</summary><pre>${escapeHtml(
            message.reasoning.trim()
          )}</pre></details>`
        : '';
      return `
        <article class="message message-${message.role}">
          <header>${roleLabel} · ${timestamp}${model}</header>
          <div class="content">${content}</div>
          ${reasoning}
        </article>
      `;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${resolveLocaleString(locale, 'zh-CN', 'en')}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px auto; max-width: 920px; padding: 0 16px; line-height: 1.6; color: #1f2328; }
      h1 { margin-bottom: 8px; }
      .meta { color: #57606a; margin-bottom: 20px; }
      .message { border: 1px solid #d0d7de; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
      .message header { font-size: 12px; color: #57606a; margin-bottom: 8px; }
      .message pre { white-space: pre-wrap; background: #f6f8fa; border-radius: 8px; padding: 10px; overflow: auto; }
      .message-user { background: #f6f8fa; }
      details summary { cursor: pointer; color: #57606a; font-size: 12px; margin-top: 8px; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <div class="meta">${escapeHtml(strings.assistantRole)}: ${assistant} · ${escapeHtml(strings.exportGeneratedAtLabel)}: ${exportedAt}</div>
    ${messageBlocks}
  </body>
</html>`;
}

function buildSessionExportContent(
  format: SessionExportFormat,
  session: ChatSessionDetail,
  assistant: { id: string; name: string },
  locale: string,
  strings: Record<string, string>
): string {
  if (format === 'json') {
    return JSON.stringify(
      {
        schema: 'chatbuddy.session-export',
        version: 1,
        exportedAt: new Date().toISOString(),
        locale,
        assistant,
        session
      },
      null,
      2
    );
  }
  if (format === 'markdown') {
    return buildSessionMarkdownExport(session, assistant.name, locale, strings);
  }
  return buildSessionHtmlExport(session, assistant.name, locale, strings);
}

/**
 * Type guard: validate and cast to AssistantNode.
 * @param arg - The object to validate.
 * @returns AssistantNode if valid, otherwise undefined.
 */
function asAssistantNode(arg: unknown): AssistantNode | undefined {
  if (!arg || typeof arg !== 'object') {
    return undefined;
  }
  const node = arg as Partial<AssistantNode>;
  if (node.kind !== 'assistant' || !node.assistant) {
    return undefined;
  }
  // Validate required assistant properties
  if (
    typeof node.assistant.id !== 'string' ||
    typeof node.assistant.name !== 'string' ||
    !node.assistant.id.trim()
  ) {
    warn('Invalid assistant node structure:', node);
    return undefined;
  }
  return node as AssistantNode;
}

/**
 * Type guard: validate and cast to AssistantGroupNode.
 * @param arg - The object to validate.
 * @returns AssistantGroupNode if valid, otherwise undefined.
 */
function asGroupNode(arg: unknown): AssistantGroupNode | undefined {
  if (!arg || typeof arg !== 'object') {
    return undefined;
  }
  const node = arg as Partial<AssistantGroupNode>;
  if (node.kind !== 'group' || !node.group) {
    return undefined;
  }
  // Validate required group properties
  if (
    typeof node.group.id !== 'string' ||
    typeof node.group.name !== 'string' ||
    !node.group.id.trim()
  ) {
    warn('Invalid group node structure:', node);
    return undefined;
  }
  return node as AssistantGroupNode;
}

/**
 * Type guard: validate and cast to SessionNode.
 * @param arg - The object to validate.
 * @returns SessionNode if valid, otherwise undefined.
 */
function asSessionNode(arg: unknown): SessionNode | undefined {
  if (!arg || typeof arg !== 'object') {
    return undefined;
  }
  const node = arg as Partial<SessionNode>;
  if (node.kind !== 'session' || !node.session || typeof node.assistantId !== 'string') {
    return undefined;
  }
  if (
    typeof node.session.id !== 'string' ||
    typeof node.session.assistantId !== 'string' ||
    !node.session.id.trim() ||
    !node.assistantId.trim()
  ) {
    return undefined;
  }
  return node as SessionNode;
}

type ExtensionContext = {
  repository: ChatStateRepository;
  chatController: ChatController;
  settingsCenterPanelController: SettingsCenterPanelController;
  assistantEditorPanelController: AssistantEditorPanelController;
  assistantsTreeProvider: AssistantsTreeProvider;
  sessionsTreeProvider: SessionsTreeProvider;
  assistantsTreeView: vscode.TreeView<unknown>;
  recycleBinTreeView: vscode.TreeView<unknown>;
  sessionsTreeView: vscode.TreeView<unknown>;
  refreshAll: () => void;
  updateTreeMessage: () => void;
  getRuntimeLocale: () => string;
  getRuntimeStrings: () => Record<string, string>;
};

/**
 * Register all ChatBuddy commands and return their disposables.
 */
function registerCommands(ctx: ExtensionContext): vscode.Disposable[] {
  const {
    repository, chatController, settingsCenterPanelController, assistantEditorPanelController,
    assistantsTreeProvider,
    refreshAll, updateTreeMessage, getRuntimeLocale, getRuntimeStrings
  } = ctx;
  const strings = () => getRuntimeStrings();

  const openSettingsCommand = vscode.commands.registerCommand('chatbuddy.openSettings', () => {
    settingsCenterPanelController.openPanel('general');
  });
  const openModelConfigCommand = vscode.commands.registerCommand('chatbuddy.openModelConfig', () => {
    settingsCenterPanelController.openPanel('modelConfig');
  });
  const openDefaultModelsCommand = vscode.commands.registerCommand('chatbuddy.openDefaultModels', () => {
    settingsCenterPanelController.openPanel('defaultModels');
  });
  const openMcpCommand = vscode.commands.registerCommand('chatbuddy.openMcp', () => {
    settingsCenterPanelController.openPanel('mcp');
  });

  const openChatCommand = vscode.commands.registerCommand(
    'chatbuddy.openAssistantChat',
    (assistantOrId?: AssistantNode | string) => {
      const assistantId =
        typeof assistantOrId === 'string'
          ? assistantOrId
          : asAssistantNode(assistantOrId)?.assistant.id;
      chatController.openAssistantChat(assistantId);
      refreshAll();
    }
  );

  const openSessionChatCommand = vscode.commands.registerCommand('chatbuddy.openSessionChat', (arg?: SessionNode) => {
    const node = asSessionNode(arg);
    if (!node) { return; }
    repository.setSelectedAssistant(node.assistantId);
    repository.selectSession(node.assistantId, node.session.id);
    chatController.openAssistantChat(node.assistantId);
    refreshAll();
  });

  const createAssistantCommand = vscode.commands.registerCommand('chatbuddy.createAssistant', () => {
    assistantEditorPanelController.openCreateAssistantEditor();
  });

  const createGroupCommand = vscode.commands.registerCommand('chatbuddy.createGroup', async () => {
    const name = await vscode.window.showInputBox({
      prompt: strings().createGroupPrompt,
      ignoreFocusOut: true
    });
    if (!name?.trim()) { return; }
    repository.createGroup(name.trim());
    refreshAll();
    updateTreeMessage();
  });

  const searchAssistantsCommand = vscode.commands.registerCommand('chatbuddy.searchAssistants', async () => {
    const keyword = await vscode.window.showInputBox({
      prompt: strings().assistantSearchPlaceholder,
      value: assistantsTreeProvider.getSearchKeyword(),
      ignoreFocusOut: true
    });
    if (keyword === undefined) { return; }
    assistantsTreeProvider.setSearchKeyword(keyword);
    updateTreeMessage();
  });

  const collapseAllAssistantsCommand = vscode.commands.registerCommand('chatbuddy.collapseAllAssistants', () => {
    void vscode.commands.executeCommand('workbench.actions.treeView.chatbuddy.assistantsView.collapseAll');
  });

  const clearSearchCommand = vscode.commands.registerCommand('chatbuddy.clearAssistantSearch', () => {
    assistantsTreeProvider.clearSearchKeyword();
    updateTreeMessage();
  });

  const renameGroupCommand = vscode.commands.registerCommand('chatbuddy.renameGroup', async (arg?: AssistantGroupNode) => {
    const node = asGroupNode(arg);
    if (!node) { return; }
    if (node.group.id === DELETED_GROUP_ID) {
      void vscode.window.showWarningMessage(strings().groupRenameBlocked);
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: strings().renameGroupPrompt,
      value:
        node.group.id === DEFAULT_GROUP_ID &&
        (!node.group.name.trim() || (node.group.updatedAt === node.group.createdAt && isLegacyDefaultGroupName(node.group.name)))
          ? strings().defaultGroupName
          : node.group.name,
      ignoreFocusOut: true
    });
    if (!name?.trim()) { return; }
    repository.renameGroup(node.group.id, name.trim());
    refreshAll();
  });

  const deleteGroupCommand = vscode.commands.registerCommand('chatbuddy.deleteGroup', async (arg?: AssistantGroupNode) => {
    const node = asGroupNode(arg);
    if (!node) { return; }
    if (node.group.id === DEFAULT_GROUP_ID || node.group.id === DELETED_GROUP_ID) {
      void vscode.window.showWarningMessage(strings().groupDeleteBlocked);
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      formatString(strings().confirmDeleteGroup, { name: node.group.name }),
      { modal: true },
      strings().deleteAction
    );
    if (confirm !== strings().deleteAction) { return; }
    repository.deleteGroup(node.group.id);
    refreshAll();
  });

  const pinAssistantCommand = vscode.commands.registerCommand('chatbuddy.pinAssistant', (arg?: AssistantNode) => {
    const node = asAssistantNode(arg);
    if (!node) { return; }
    repository.toggleAssistantPinned(node.assistant.id);
    refreshAll();
  });

  const unpinAssistantCommand = vscode.commands.registerCommand('chatbuddy.unpinAssistant', (arg?: AssistantNode) => {
    const node = asAssistantNode(arg);
    if (!node) { return; }
    repository.toggleAssistantPinned(node.assistant.id);
    refreshAll();
  });

  const editAssistantCommand = vscode.commands.registerCommand('chatbuddy.editAssistant', (arg?: AssistantNode) => {
    const node = asAssistantNode(arg);
    const assistantId = node?.assistant.id ?? repository.getState().selectedAssistantId;
    if (!assistantId) { return; }
    const assistant = repository.getAssistantById(assistantId);
    if (!assistant || assistant.isDeleted) {
      void vscode.window.showWarningMessage(strings().assistantEditDeletedBlocked);
      return;
    }
    assistantEditorPanelController.openAssistantEditor(assistantId);
  });

  const softDeleteAssistantCommand = vscode.commands.registerCommand(
    'chatbuddy.softDeleteAssistant',
    async (arg?: AssistantNode) => {
      const node = asAssistantNode(arg);
      if (!node) { return; }
      const confirm = await vscode.window.showWarningMessage(
        formatString(strings().confirmDeleteAssistant, { name: node.assistant.name }),
        { modal: true },
        strings().deleteAction
      );
      if (confirm !== strings().deleteAction) { return; }
      repository.softDeleteAssistant(node.assistant.id);
      chatController.openAssistantChat(node.assistant.id);
      refreshAll();
    }
  );

  const restoreAssistantCommand = vscode.commands.registerCommand('chatbuddy.restoreAssistant', (arg?: AssistantNode) => {
    const node = asAssistantNode(arg);
    if (!node) { return; }
    const restored = repository.restoreAssistant(node.assistant.id);
    if (!restored) { return; }
    chatController.openAssistantChat(restored.id);
    refreshAll();
  });

  const hardDeleteAssistantCommand = vscode.commands.registerCommand(
    'chatbuddy.hardDeleteAssistant',
    async (arg?: AssistantNode) => {
      const node = asAssistantNode(arg);
      if (!node) { return; }
      const confirm = await vscode.window.showWarningMessage(
        formatString(strings().confirmHardDeleteAssistant, { name: node.assistant.name }),
        { modal: true },
        strings().hardDeleteAction
      );
      if (confirm !== strings().hardDeleteAction) { return; }
      chatController.disposePanelForAssistant(node.assistant.id);
      repository.hardDeleteAssistant(node.assistant.id);
      chatController.openAssistantChat();
      refreshAll();
    }
  );

  const emptyRecycleBinCommand = vscode.commands.registerCommand('chatbuddy.emptyRecycleBin', async () => {
    const deletedAssistants = repository.getAssistants().filter((assistant) => assistant.isDeleted);
    if (deletedAssistants.length === 0) {
      void vscode.window.showInformationMessage(strings().recycleBinAlreadyEmpty);
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      formatString(strings().confirmEmptyRecycleBin, { count: String(deletedAssistants.length) }),
      { modal: true },
      strings().emptyRecycleBinAction
    );
    if (confirm !== strings().emptyRecycleBinAction) { return; }
    for (const assistant of deletedAssistants) {
      chatController.disposePanelForAssistant(assistant.id);
    }
    const removedCount = repository.hardDeleteDeletedAssistants();
    chatController.openAssistantChat();
    refreshAll();
    void vscode.window.showInformationMessage(formatString(strings().recycleBinEmptied, { count: String(removedCount) }));
  });

  const createSessionCommand = vscode.commands.registerCommand('chatbuddy.createSession', () => {
    chatController.createSessionForSelectedAssistant();
    chatController.openAssistantChat();
    refreshAll();
  });

  const renameSessionCommand = vscode.commands.registerCommand('chatbuddy.renameSession', async (arg?: SessionNode) => {
    const node = asSessionNode(arg);
    const assistant = node ? repository.getAssistantById(node.assistantId) : repository.getSelectedAssistant();
    if (!assistant) {
      void vscode.window.showInformationMessage(strings().noAssistantSelectedBody);
      return;
    }
    const currentSession = node
      ? repository.getSessionsForAssistant(assistant.id).find((session) => session.id === node.session.id)
      : repository.getSelectedSession(assistant.id);
    if (!currentSession) {
      void vscode.window.showInformationMessage(strings().noSessionsToRename);
      return;
    }
    const nextTitle = await vscode.window.showInputBox({
      prompt: strings().renameSessionPrompt,
      value: currentSession.title
    });
    if (!nextTitle?.trim()) { return; }
    repository.setSelectedAssistant(assistant.id);
    chatController.renameSessionForSelectedAssistant(currentSession.id, nextTitle.trim());
    chatController.openAssistantChat(assistant.id);
    refreshAll();
  });

  const deleteSessionCommand = vscode.commands.registerCommand('chatbuddy.deleteSession', async (arg?: SessionNode) => {
    const node = asSessionNode(arg);
    const assistant = node ? repository.getAssistantById(node.assistantId) : repository.getSelectedAssistant();
    if (!assistant) {
      void vscode.window.showInformationMessage(strings().noAssistantSelectedBody);
      return;
    }
    const currentSession = node
      ? repository.getSessionsForAssistant(assistant.id).find((session) => session.id === node.session.id)
      : repository.getSelectedSession(assistant.id);
    if (!currentSession) {
      void vscode.window.showInformationMessage(strings().noSessionsToDelete);
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      formatString(strings().confirmDeleteSession, { title: currentSession.title }),
      { modal: true },
      strings().deleteAction
    );
    if (confirm !== strings().deleteAction) { return; }
    repository.setSelectedAssistant(assistant.id);
    chatController.deleteSessionForSelectedAssistant(currentSession.id);
    chatController.openAssistantChat(assistant.id);
    refreshAll();
  });

  const exportSessionCommand = vscode.commands.registerCommand('chatbuddy.exportSession', async (arg?: SessionNode) => {
    const locale = getRuntimeLocale();
    const node = asSessionNode(arg);
    if (!node) {
      void vscode.window.showInformationMessage(strings().exportSessionSelectHint);
      return;
    }
    const assistant = repository.getAssistantById(node.assistantId);
    if (!assistant) {
      void vscode.window.showInformationMessage(strings().noAssistantSelectedBody);
      return;
    }
    const currentSession = repository.getSessionById(node.session.id);
    if (!currentSession || currentSession.assistantId !== assistant.id) {
      void vscode.window.showInformationMessage(strings().noSessionsToExport);
      return;
    }
    const formatPick = await vscode.window.showQuickPick(
      [
        { label: strings().exportFormatJson, format: 'json' as const, extension: 'json' },
        { label: strings().exportFormatMarkdown, format: 'markdown' as const, extension: 'md' },
        { label: strings().exportFormatHtml, format: 'html' as const, extension: 'html' }
      ],
      {
        title: strings().exportSessionAction,
        placeHolder: strings().exportFormatPrompt,
        ignoreFocusOut: true
      }
    );
    if (!formatPick) { return; }
    const fileName = buildSessionExportFileName(currentSession.title || strings().untitledSession, formatPick.extension);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultUri = workspaceRoot
      ? vscode.Uri.joinPath(workspaceRoot, fileName)
      : vscode.Uri.file(path.join(os.homedir(), fileName));
    const saveUri = await vscode.window.showSaveDialog({
      saveLabel: strings().exportSessionAction,
      defaultUri,
      filters: { [formatPick.extension.toUpperCase()]: [formatPick.extension] }
    });
    if (!saveUri) { return; }
    try {
      const content = buildSessionExportContent(formatPick.format, currentSession, { id: assistant.id, name: assistant.name }, locale, strings());
      await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf8'));
      void vscode.window.showInformationMessage(formatString(strings().exportSessionDone, { path: saveUri.fsPath }));
    } catch (err) {
      warn('Failed to export session:', err);
      void vscode.window.showErrorMessage(strings().exportSessionFailed);
    }
  });

  const stopGenerationCommand = vscode.commands.registerCommand('chatbuddy.stopGeneration', () => {
    chatController.stopGeneration('manual');
  });

  const clearAllSessionsCommand = vscode.commands.registerCommand('chatbuddy.clearAllSessions', async () => {
    const assistant = repository.getSelectedAssistant();
    if (!assistant || assistant.isDeleted) {
      void vscode.window.showInformationMessage(strings().noAssistantSelectedBody);
      return;
    }
    const sessions = repository.getSessionsForAssistant(assistant.id);
    if (!sessions.length) {
      void vscode.window.showInformationMessage(strings().noSessionsToClear);
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      formatString(strings().confirmClearAllSessions, { name: assistant.name, count: String(sessions.length) }),
      { modal: true },
      strings().clearAllSessionsAction
    );
    if (confirm !== strings().clearAllSessionsAction) { return; }
    const removedCount = repository.clearSessionsForAssistant(assistant.id);
    chatController.openAssistantChat(assistant.id);
    refreshAll();
    void vscode.window.showInformationMessage(formatString(strings().clearAllSessionsDone, { count: String(removedCount) }));
  });

  // Locale-aware menu alias commands for i18n when clauses
  const localeAwareMenuCommands = [
    'chatbuddy.createAssistant',
    'chatbuddy.createGroup',
    'chatbuddy.searchAssistants',
    'chatbuddy.collapseAllAssistants',
    'chatbuddy.createSession',
    'chatbuddy.clearAllSessions',
    'chatbuddy.emptyRecycleBin',
    'chatbuddy.pinAssistant',
    'chatbuddy.unpinAssistant',
    'chatbuddy.editAssistant',
    'chatbuddy.softDeleteAssistant',
    'chatbuddy.restoreAssistant',
    'chatbuddy.hardDeleteAssistant',
    'chatbuddy.renameGroup',
    'chatbuddy.deleteGroup',
    'chatbuddy.renameSession',
    'chatbuddy.deleteSession',
    'chatbuddy.exportSession'
  ] as const;
  const localeAwareMenuAliasCommands = localeAwareMenuCommands.flatMap((commandId) => [
    vscode.commands.registerCommand(`${commandId}.uiEn`, (...args: unknown[]) => vscode.commands.executeCommand(commandId, ...args)),
    vscode.commands.registerCommand(`${commandId}.uiZh`, (...args: unknown[]) => vscode.commands.executeCommand(commandId, ...args))
  ]);

  return [
    openSettingsCommand,
    openModelConfigCommand,
    openDefaultModelsCommand,
    openMcpCommand,
    openChatCommand,
    openSessionChatCommand,
    createAssistantCommand,
    createGroupCommand,
    searchAssistantsCommand,
    collapseAllAssistantsCommand,
    clearSearchCommand,
    renameGroupCommand,
    deleteGroupCommand,
    pinAssistantCommand,
    unpinAssistantCommand,
    editAssistantCommand,
    softDeleteAssistantCommand,
    restoreAssistantCommand,
    hardDeleteAssistantCommand,
    emptyRecycleBinCommand,
    createSessionCommand,
    clearAllSessionsCommand,
    renameSessionCommand,
    deleteSessionCommand,
    exportSessionCommand,
    stopGenerationCommand,
    ...localeAwareMenuAliasCommands
  ];
}

export async function activate(context: vscode.ExtensionContext) {
  // Global unhandled rejection handler — prevents silent crashes in production
  process.on('unhandledRejection', (reason: unknown) => {
    warn('Unhandled promise rejection:', reason);
  });

  const repository = new ChatStateRepository(context);
  await repository.initialize();
  const providerClient = new OpenAICompatibleClient();
  const mcpRuntime = new McpRuntime();
  const chatController = new ChatController(repository, providerClient, mcpRuntime);

  const getRuntimeLocale = () => resolveLocale(repository.getSettings().locale, vscode.env.language);
  const getRuntimeStrings = () => getStrings(getRuntimeLocale());
  const updateLocaleContext = () => {
    void vscode.commands.executeCommand('setContext', 'chatbuddy.locale', getRuntimeLocale());
  };
  const settingsTreeDataEmitter = new vscode.EventEmitter<void>();
  const settingsTreeProvider: vscode.TreeDataProvider<vscode.TreeItem> = {
    onDidChangeTreeData: settingsTreeDataEmitter.event,
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
      return element;
    },
    getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
      if (element) {
        return [];
      }
      const strings = getRuntimeStrings();
      const modelConfigItem = new vscode.TreeItem(strings.openModelConfig, vscode.TreeItemCollapsibleState.None);
      modelConfigItem.id = 'chatbuddy.model-config.open';
      modelConfigItem.iconPath = new vscode.ThemeIcon('hubot');
      modelConfigItem.command = {
        command: 'chatbuddy.openModelConfig',
        title: strings.openModelConfig
      };
      modelConfigItem.tooltip = strings.modelConfigDescription;

      const defaultModelsItem = new vscode.TreeItem(strings.openDefaultModels, vscode.TreeItemCollapsibleState.None);
      defaultModelsItem.id = 'chatbuddy.default-models.open';
      defaultModelsItem.iconPath = new vscode.ThemeIcon('symbol-constant');
      defaultModelsItem.command = {
        command: 'chatbuddy.openDefaultModels',
        title: strings.openDefaultModels
      };
      defaultModelsItem.tooltip = strings.defaultModelsDescription;

      const mcpSettingsItem = new vscode.TreeItem(strings.openMcp || strings.mcpTitle || 'MCP', vscode.TreeItemCollapsibleState.None);
      mcpSettingsItem.id = 'chatbuddy.mcp.open';
      mcpSettingsItem.iconPath = new vscode.ThemeIcon('plug');
      mcpSettingsItem.command = {
        command: 'chatbuddy.openMcp',
        title: strings.openMcp || strings.mcpTitle || 'MCP'
      };
      mcpSettingsItem.tooltip = strings.mcpDescription;

      const globalSettingsItem = new vscode.TreeItem(strings.openSettings, vscode.TreeItemCollapsibleState.None);
      globalSettingsItem.id = 'chatbuddy.settings.open';
      globalSettingsItem.iconPath = new vscode.ThemeIcon('settings-gear');
      globalSettingsItem.command = {
        command: 'chatbuddy.openSettings',
        title: strings.openSettings
      };
      globalSettingsItem.tooltip = strings.settingsDescription;

      const items: vscode.TreeItem[] = [modelConfigItem, defaultModelsItem, mcpSettingsItem, globalSettingsItem];
      for (let index = items.length; index < MIN_SETTINGS_VIEW_ROWS; index += 1) {
        const spacer = new vscode.TreeItem(' ', vscode.TreeItemCollapsibleState.None);
        spacer.id = `chatbuddy.settings.spacer.${index}`;
        spacer.contextValue = 'chatbuddy.view.spacer';
        items.push(spacer);
      }
      return items;
    }
  };

  let refreshAll = () => {
    // noop during controller wiring
  };

  const applySettingsAndRefresh = (settings: ChatBuddySettings) => {
    repository.updateSettings(settings);
    chatController.applySettings(settings);
    refreshAll();
    updateTreeMessage();
  };

  const handleResetData = async () => {
    const strings = getRuntimeStrings();
    const firstConfirm = await vscode.window.showWarningMessage(
      strings.confirmResetData,
      { modal: true },
      strings.resetAction
    );
    if (firstConfirm !== strings.resetAction) {
      return false;
    }

    const secondConfirm = await vscode.window.showWarningMessage(
      strings.confirmResetDataSecond ?? strings.confirmResetData,
      { modal: true },
      strings.resetAction
    );
    if (secondConfirm !== strings.resetAction) {
      return false;
    }
    chatController.stopGeneration('manual');
    await repository.resetState();
    chatController.applySettings(repository.getSettings());
    chatController.openAssistantChat();
    assistantsTreeProvider.clearSearchKeyword();
    recycleBinTreeProvider.clearSearchKeyword();
    refreshAll();
    updateTreeMessage();
    return true;
  };

  const handleExportData = async () => {
    const strings = getRuntimeStrings();
    const fileName = buildBackupFileName();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultUri = workspaceRoot
      ? vscode.Uri.joinPath(workspaceRoot, fileName)
      : vscode.Uri.file(path.join(os.homedir(), fileName));
    const uri = await vscode.window.showSaveDialog({
      saveLabel: strings.exportDataAction,
      filters: {
        JSON: ['json']
      },
      defaultUri
    });
    if (!uri) {
      return undefined;
    }
    const backup = repository.exportBackupData();
    const content = JSON.stringify(backup, null, 2);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    return {
      notice: formatString(strings.exportDataDone, { path: uri.fsPath }),
      tone: 'success' as const
    };
  };

  const handleImportData = async () => {
    const strings = getRuntimeStrings();
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: strings.importDataAction,
      filters: {
        JSON: ['json']
      }
    });
    const target = picked?.[0];
    if (!target) {
      return undefined;
    }
    const confirmed = await vscode.window.showWarningMessage(
      strings.confirmImportData,
      { modal: true },
      strings.importDataAction
    );
    if (confirmed !== strings.importDataAction) {
      return undefined;
    }
    let parsed: unknown;
    try {
      const raw = await vscode.workspace.fs.readFile(target);
      parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch (err) {
      warn('Failed to parse backup file:', err);
      return {
        notice: strings.importDataInvalid,
        tone: 'error' as const
      };
    }

    try {
      chatController.stopGeneration('manual');
      await repository.importBackupData(parsed);
    } catch (err) {
      warn('Failed to import backup data:', err);
      return {
        notice: strings.importDataInvalid,
        tone: 'error' as const
      };
    }

    chatController.applySettings(repository.getSettings());
    chatController.openAssistantChat();
    assistantsTreeProvider.clearSearchKeyword();
    recycleBinTreeProvider.clearSearchKeyword();
    refreshAll();
    updateTreeMessage();
    return {
      notice: strings.importDataDone,
      tone: 'success' as const
    };
  };

  const settingsCenterPanelController = new SettingsCenterPanelController(
    repository,
    providerClient,
    mcpRuntime,
    applySettingsAndRefresh,
    handleResetData,
    handleExportData,
    handleImportData
  );

  const assistantEditorPanelController = new AssistantEditorPanelController(
    repository,
    (assistantId, patch) => {
      repository.updateAssistant(assistantId, patch);
      chatController.openAssistantChat(assistantId);
      refreshAll();
    },
    (patch) => {
      const strings = getRuntimeStrings();
      const created = repository.createAssistant({
        name: patch.name?.trim() || strings.assistantRole,
        groupId: patch.groupId || DEFAULT_GROUP_ID
      });
      repository.updateAssistant(created.id, patch);
      chatController.openAssistantChat(created.id);
      refreshAll();
      updateTreeMessage();
      const targetNode = assistantsTreeProvider.findAssistantNode(created.id);
      if (targetNode) {
        void assistantsTreeView.reveal(targetNode, {
          select: true,
          focus: false,
          expand: true
        });
      }
      return created.id;
    }
  );

  const assistantsTreeProvider = new AssistantsTreeProvider(
    {
      getGroups: () => repository.getGroups(),
      getAssistants: () => repository.getAssistants(),
      getSelectedAssistantId: () => repository.getState().selectedAssistantId,
      getLocaleSetting: () => repository.getSettings().locale
    },
    'main'
  );

  const recycleBinTreeProvider = new AssistantsTreeProvider(
    {
      getGroups: () => repository.getGroups(),
      getAssistants: () => repository.getAssistants(),
      getSelectedAssistantId: () => repository.getState().selectedAssistantId,
      getLocaleSetting: () => repository.getSettings().locale
    },
    'recycle'
  );

  const assistantsTreeView = vscode.window.createTreeView('chatbuddy.assistantsView', {
    treeDataProvider: assistantsTreeProvider,
    showCollapseAll: false
  });
  const recycleBinTreeView = vscode.window.createTreeView('chatbuddy.recycleBinView', {
    treeDataProvider: recycleBinTreeProvider,
    showCollapseAll: false
  });
  const sessionsTreeProvider = new SessionsTreeProvider({
    getSelectedAssistant: () => repository.getSelectedAssistant(),
    getSessionsForAssistant: (assistantId: string) => repository.getSessionsForAssistant(assistantId),
    getSelectedSession: (assistantId?: string) => repository.getSelectedSession(assistantId),
    getLocaleSetting: () => repository.getSettings().locale
  });
  const sessionsTreeView = vscode.window.createTreeView('chatbuddy.sessionsView', {
    treeDataProvider: sessionsTreeProvider,
    showCollapseAll: false
  });
  const settingsTreeView = vscode.window.createTreeView('chatbuddy.settingsView', {
    treeDataProvider: settingsTreeProvider,
    showCollapseAll: false
  });

  const updateViewHeadings = () => {
    const strings = getRuntimeStrings();
    assistantsTreeView.title = strings.assistantsViewTitle || strings.searchAssistants;
    assistantsTreeView.description = undefined;
    recycleBinTreeView.title = strings.recycleBinViewTitle || strings.emptyRecycleBin;
    recycleBinTreeView.description = undefined;
    settingsTreeView.title = strings.settingsViewTitle || strings.settingsTitle;
    settingsTreeView.description = undefined;

    const selectedAssistant = repository.getSelectedAssistant();
    sessionsTreeView.title =
      selectedAssistant && !selectedAssistant.isDeleted
        ? `${strings.sessions} · ${selectedAssistant.name}`
        : strings.sessions;
    sessionsTreeView.description = undefined;
  };

  refreshAll = () => {
    updateLocaleContext();
    assistantsTreeProvider.refresh();
    sessionsTreeProvider.refresh();
    recycleBinTreeProvider.refresh();
    settingsTreeDataEmitter.fire();
    settingsCenterPanelController.refresh();
    assistantEditorPanelController.refresh();
    updateViewHeadings();
  };

  const updateTreeMessage = () => {
    const strings = getRuntimeStrings();
    const keyword = assistantsTreeProvider.getSearchKeyword();
    assistantsTreeView.message = keyword ? `${strings.searchAssistants}: ${keyword}` : undefined;
    recycleBinTreeView.message = undefined;
  };

  const commandDisposables = registerCommands({
    repository,
    chatController,
    settingsCenterPanelController,
    assistantEditorPanelController,
    assistantsTreeProvider,
    sessionsTreeProvider,
    assistantsTreeView,
    recycleBinTreeView,
    sessionsTreeView,
    refreshAll: () => refreshAll(),
    updateTreeMessage,
    getRuntimeLocale,
    getRuntimeStrings
  });

  updateLocaleContext();
  updateTreeMessage();
  updateViewHeadings();

  context.subscriptions.push(
    assistantsTreeView,
    sessionsTreeView,
    recycleBinTreeView,
    settingsTreeView,
    settingsTreeDataEmitter,
    ...commandDisposables
  );
}

export function deactivate() {
  // noop
}
