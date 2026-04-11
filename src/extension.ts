import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';

import { AssistantsTreeProvider } from './chatbuddy/assistantsView';
import { AssistantEditorPanelController } from './chatbuddy/assistantEditorPanel';
import { ChatController } from './chatbuddy/chatController';
import { DEFAULT_GROUP_ID } from './chatbuddy/constants';
import { formatString, getStrings, resolveLocale } from './chatbuddy/i18n';
import { McpRuntime } from './chatbuddy/mcpRuntime';
import { OpenAICompatibleClient } from './chatbuddy/providerClient';
import { SessionsTreeProvider } from './chatbuddy/sessionsView';
import { SettingsCenterPanelController } from './chatbuddy/settingsCenterPanel';
import { warn } from './chatbuddy/utils';
import { ChatStateRepository } from './chatbuddy/stateRepository';
import { ChatBuddySettings } from './chatbuddy/types';

import type { ExtensionContext } from './extension/shared';
import { buildBackupFileName } from './extension/shared';
import { registerSettingsCommands } from './extension/settingsCommands';
import { registerNavigationCommands } from './extension/navigationCommands';
import { registerAssistantTreeCommands } from './extension/assistantTreeCommands';
import { registerAssistantManagementCommands } from './extension/assistantManagementCommands';
import { registerSessionCommands } from './extension/sessionCommands';
import { registerLocaleAwareMenuAliasCommands } from './extension/localeMenuCommands';

const MIN_SETTINGS_VIEW_ROWS = 4;

// ─── Internal types ─────────────────────────────────────────────────────────

type SettingsTreeDataSource = {
  emitter: vscode.EventEmitter<void>;
  provider: vscode.TreeDataProvider<vscode.TreeItem>;
};

type DataActionResult = {
  notice: string;
  tone: 'success' | 'error';
};

type ActivationTreeProviders = {
  assistantsTreeProvider: AssistantsTreeProvider;
  recycleBinTreeProvider: AssistantsTreeProvider;
  sessionsTreeProvider: SessionsTreeProvider;
};

type ActivationTreeViews = {
  assistantsTreeView: vscode.TreeView<unknown>;
  recycleBinTreeView: vscode.TreeView<unknown>;
  sessionsTreeView: vscode.TreeView<unknown>;
  settingsTreeView: vscode.TreeView<unknown>;
};

type PanelControllers = {
  settingsCenterPanelController: SettingsCenterPanelController;
  assistantEditorPanelController: AssistantEditorPanelController;
};

// ─── Tree provider / view helpers ────────────────────────────────────────────

function createTreeProviders(repository: ChatStateRepository): ActivationTreeProviders {
  const assistantTreeRepository = {
    getGroups: () => repository.getGroups(),
    getAssistants: () => repository.getAssistants(),
    getLocaleSetting: () => repository.getLocaleSetting()
  };

  return {
    assistantsTreeProvider: new AssistantsTreeProvider(assistantTreeRepository, 'main'),
    recycleBinTreeProvider: new AssistantsTreeProvider(assistantTreeRepository, 'recycle'),
    sessionsTreeProvider: new SessionsTreeProvider({
      getSelectedAssistant: () => repository.getSelectedAssistant(),
      getSessionsForAssistant: (assistantId: string) => repository.getSessionsForAssistant(assistantId),
      getSelectedSessionId: (assistantId?: string) => repository.getSelectedSessionId(assistantId),
      getLocaleSetting: () => repository.getLocaleSetting()
    })
  };
}

function createTreeViews(args: {
  assistantsTreeProvider: AssistantsTreeProvider;
  recycleBinTreeProvider: AssistantsTreeProvider;
  sessionsTreeProvider: SessionsTreeProvider;
  settingsTreeProvider: vscode.TreeDataProvider<vscode.TreeItem>;
}): ActivationTreeViews {
  const { assistantsTreeProvider, recycleBinTreeProvider, sessionsTreeProvider, settingsTreeProvider } = args;

  return {
    assistantsTreeView: vscode.window.createTreeView('chatbuddy.assistantsView', {
      treeDataProvider: assistantsTreeProvider,
      showCollapseAll: false
    }),
    recycleBinTreeView: vscode.window.createTreeView('chatbuddy.recycleBinView', {
      treeDataProvider: recycleBinTreeProvider,
      showCollapseAll: false
    }),
    sessionsTreeView: vscode.window.createTreeView('chatbuddy.sessionsView', {
      treeDataProvider: sessionsTreeProvider,
      showCollapseAll: false
    }),
    settingsTreeView: vscode.window.createTreeView('chatbuddy.settingsView', {
      treeDataProvider: settingsTreeProvider,
      showCollapseAll: false
    })
  };
}

function createSettingsTreeDataSource(getRuntimeStrings: () => Record<string, string>): SettingsTreeDataSource {
  const emitter = new vscode.EventEmitter<void>();
  const provider: vscode.TreeDataProvider<vscode.TreeItem> = {
    onDidChangeTreeData: emitter.event,
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
      return element;
    },
    getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
      if (element) {
        return [];
      }
      const strings = getRuntimeStrings();
      const createItem = (
        id: string,
        label: string,
        icon: string,
        command: string,
        tooltip?: string
      ): vscode.TreeItem => {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.id = id;
        item.iconPath = new vscode.ThemeIcon(icon);
        item.command = {
          command,
          title: label
        };
        item.tooltip = tooltip;
        return item;
      };

      const items: vscode.TreeItem[] = [
        createItem('chatbuddy.model-config.open', strings.openModelConfig, 'hubot', 'chatbuddy.openModelConfig', strings.modelConfigDescription),
        createItem(
          'chatbuddy.default-models.open',
          strings.openDefaultModels,
          'symbol-constant',
          'chatbuddy.openDefaultModels',
          strings.defaultModelsDescription
        ),
        createItem(
          'chatbuddy.mcp.open',
          strings.openMcp || strings.mcpTitle || 'MCP',
          'plug',
          'chatbuddy.openMcp',
          strings.mcpDescription
        ),
        createItem('chatbuddy.settings.open', strings.openSettings, 'settings-gear', 'chatbuddy.openSettings', strings.settingsDescription)
      ];
      for (let index = items.length; index < MIN_SETTINGS_VIEW_ROWS; index += 1) {
        const spacer = new vscode.TreeItem(' ', vscode.TreeItemCollapsibleState.None);
        spacer.id = `chatbuddy.settings.spacer.${index}`;
        spacer.contextValue = 'chatbuddy.view.spacer';
        items.push(spacer);
      }
      return items;
    }
  };

  return { emitter, provider };
}

// ─── Data action handlers ───────────────────────────────────────────────────

function clearAssistantSearchFilters(
  assistantsTreeProvider: AssistantsTreeProvider,
  recycleBinTreeProvider: AssistantsTreeProvider
): void {
  assistantsTreeProvider.clearSearchKeyword();
  recycleBinTreeProvider.clearSearchKeyword();
}

function createDataActionHandlers(args: {
  repository: ChatStateRepository;
  chatController: ChatController;
  getAssistantsTreeProvider: () => AssistantsTreeProvider;
  getRecycleBinTreeProvider: () => AssistantsTreeProvider;
  refreshAll: () => void;
  updateTreeMessage: () => void;
  getRuntimeStrings: () => Record<string, string>;
}): {
  handleResetData: () => Promise<boolean>;
  handleExportData: () => Promise<DataActionResult | undefined>;
  handleImportData: () => Promise<DataActionResult | undefined>;
} {
  const {
    repository,
    chatController,
    getAssistantsTreeProvider,
    getRecycleBinTreeProvider,
    refreshAll,
    updateTreeMessage,
    getRuntimeStrings
  } = args;

  return {
    handleResetData: async () => {
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
      clearAssistantSearchFilters(getAssistantsTreeProvider(), getRecycleBinTreeProvider());
      refreshAll();
      updateTreeMessage();
      return true;
    },
    handleExportData: async () => {
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
        tone: 'success'
      };
    },
    handleImportData: async () => {
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
          tone: 'error'
        };
      }

      try {
        chatController.stopGeneration('manual');
        await repository.importBackupData(parsed);
      } catch (err) {
        warn('Failed to import backup data:', err);
        return {
          notice: strings.importDataInvalid,
          tone: 'error'
        };
      }

      chatController.applySettings(repository.getSettings());
      chatController.openAssistantChat();
      clearAssistantSearchFilters(getAssistantsTreeProvider(), getRecycleBinTreeProvider());
      refreshAll();
      updateTreeMessage();
      return {
        notice: strings.importDataDone,
        tone: 'success'
      };
    }
  };
}

// ─── Panel controllers ──────────────────────────────────────────────────────

function createPanelControllers(args: {
  repository: ChatStateRepository;
  providerClient: OpenAICompatibleClient;
  mcpRuntime: McpRuntime;
  chatController: ChatController;
  assistantsTreeProvider: AssistantsTreeProvider;
  assistantsTreeView: vscode.TreeView<unknown>;
  applySettingsAndRefresh: (settings: ChatBuddySettings) => void;
  handleResetData: () => Promise<boolean>;
  handleExportData: () => Promise<DataActionResult | undefined>;
  handleImportData: () => Promise<DataActionResult | undefined>;
  refreshAll: () => void;
  updateTreeMessage: () => void;
  getRuntimeStrings: () => Record<string, string>;
}): PanelControllers {
  const {
    repository,
    providerClient,
    mcpRuntime,
    chatController,
    assistantsTreeProvider,
    assistantsTreeView,
    applySettingsAndRefresh,
    handleResetData,
    handleExportData,
    handleImportData,
    refreshAll,
    updateTreeMessage,
    getRuntimeStrings
  } = args;

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

  return {
    settingsCenterPanelController,
    assistantEditorPanelController
  };
}

// ─── Command registration ───────────────────────────────────────────────────

function registerCommands(ctx: ExtensionContext): vscode.Disposable[] {
  return [
    ...registerSettingsCommands(ctx),
    ...registerNavigationCommands(ctx),
    ...registerAssistantTreeCommands(ctx),
    ...registerAssistantManagementCommands(ctx),
    ...registerSessionCommands(ctx),
    ...registerLocaleAwareMenuAliasCommands()
  ];
}

// ─── Extension lifecycle ────────────────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext) {
  // Global unhandled rejection handler — prevents silent crashes in production
  process.on('unhandledRejection', (reason: unknown) => {
    warn('Unhandled promise rejection:', reason);
  });

  const repository = new ChatStateRepository(context);
  await repository.initialize();
  const providerClient = new OpenAICompatibleClient();
  const mcpRuntime = new McpRuntime();
  const chatController = new ChatController(repository, providerClient, mcpRuntime, context.extensionUri);

  const getRuntimeLocale = () => resolveLocale(repository.getLocaleSetting(), vscode.env.language);
  const getRuntimeStrings = () => getStrings(getRuntimeLocale());
  const updateLocaleContext = () => {
    void vscode.commands.executeCommand('setContext', 'chatbuddy.locale', getRuntimeLocale());
  };
  const { emitter: settingsTreeDataEmitter, provider: settingsTreeProvider } = createSettingsTreeDataSource(getRuntimeStrings);
  const { assistantsTreeProvider, recycleBinTreeProvider, sessionsTreeProvider } = createTreeProviders(repository);
  const { assistantsTreeView, recycleBinTreeView, sessionsTreeView, settingsTreeView } = createTreeViews({
    assistantsTreeProvider,
    recycleBinTreeProvider,
    sessionsTreeProvider,
    settingsTreeProvider
  });

  const panelControllers: Partial<PanelControllers> = {};

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

  const updateTreeMessage = () => {
    const strings = getRuntimeStrings();
    const keyword = assistantsTreeProvider.getSearchKeyword();
    assistantsTreeView.message = keyword ? `${strings.searchAssistants}: ${keyword}` : undefined;
    recycleBinTreeView.message = undefined;
  };

  const refreshAll = () => {
    updateLocaleContext();
    assistantsTreeProvider.refresh();
    sessionsTreeProvider.refresh();
    recycleBinTreeProvider.refresh();
    settingsTreeDataEmitter.fire();
    panelControllers.settingsCenterPanelController?.refresh();
    panelControllers.assistantEditorPanelController?.refresh();
    updateViewHeadings();
  };

  chatController.setActivePanelChangeCallback(() => {
    sessionsTreeProvider.refresh();
    updateViewHeadings();
  });

  const applySettingsAndRefresh = (settings: ChatBuddySettings) => {
    repository.updateSettings(settings);
    chatController.applySettings(settings);
    refreshAll();
    updateTreeMessage();
  };

  const { handleResetData, handleExportData, handleImportData } = createDataActionHandlers({
    repository,
    chatController,
    getAssistantsTreeProvider: () => assistantsTreeProvider,
    getRecycleBinTreeProvider: () => recycleBinTreeProvider,
    refreshAll,
    updateTreeMessage,
    getRuntimeStrings
  });

  const { settingsCenterPanelController, assistantEditorPanelController } = createPanelControllers({
    repository,
    providerClient,
    mcpRuntime,
    chatController,
    assistantsTreeProvider,
    assistantsTreeView,
    applySettingsAndRefresh,
    handleResetData,
    handleExportData,
    handleImportData,
    refreshAll,
    updateTreeMessage,
    getRuntimeStrings
  });

  panelControllers.settingsCenterPanelController = settingsCenterPanelController;
  panelControllers.assistantEditorPanelController = assistantEditorPanelController;

  const commandDisposables = registerCommands({
    repository,
    chatController,
    settingsCenterPanelController,
    assistantEditorPanelController,
    assistantsTreeProvider,
    refreshAll,
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
    ...commandDisposables,
    { dispose: () => { chatController.dispose(); } },
    { dispose: () => { void mcpRuntime.dispose(); } },
    { dispose: () => { void repository.close(); } }
  );
}

export function deactivate(): void {
  // Resources are cleaned up via context.subscriptions dispose
}
