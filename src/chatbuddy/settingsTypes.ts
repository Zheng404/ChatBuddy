/**
 * 设置中心类型定义与工具函数。
 *
 * 从 settingsCenterPanel 中提取的类型、消息定义及纯函数。
 */
import { createModelRef } from './modelCatalog';
import type { StorageMode } from './syncConfig';
import type {
  ChatBuddyLocaleSetting,
  ChatBuddySettings,
  ChatSendShortcut,
  ChatTabMode,
  McpServerProfile,
  ProviderModelOption,
  ProviderModelProfile,
  ProviderProfile,
  RuntimeStrings
} from './types';

// ─── 类型定义 ────────────────────────────────────────────────────────

export type SettingsCenterSection = 'modelConfig' | 'defaultModels' | 'general' | 'dataManagement' | 'templates' | 'mcp' | 'about';

export type SettingsActionResult = {
  notice: string;
  tone?: 'success' | 'error' | 'info';
};

export type McpToolRoundsPayload = { maxToolRounds: number };

export type SettingsCenterMessage =
  | { type: 'ready' }
  | { type: 'switchSection'; section: SettingsCenterSection }
  | { type: 'saveLocale'; payload: { locale: ChatBuddyLocaleSetting } }
  | { type: 'saveSendShortcut'; payload: { sendShortcut: ChatSendShortcut } }
  | { type: 'saveChatTabMode'; payload: { chatTabMode: ChatTabMode } }
  | { type: 'saveTimeout'; payload: { timeoutMs: number } }
  | { type: 'saveDefaultAssistant'; payload: { assistant: string } }
  | { type: 'saveDefaultTitleSummary'; payload: { titleSummary: string } }
  | { type: 'saveTitleSummaryPrompt'; payload: { titleSummaryPrompt: string } }
  | {
      type: 'saveProvider';
      payload: {
        provider: ProviderProfile;
        silent?: boolean;
      };
    }
  | {
      type: 'toggleProviderEnabled';
      payload: {
        providerId: string;
        enabled: boolean;
      };
    }
  | {
      type: 'deleteProvider';
      payload: {
        providerId: string;
        providerName: string;
      };
    }
  | {
      type: 'testConnection';
      payload: {
        provider: ProviderProfile;
        modelId: string;
      };
    }
  | {
      type: 'fetchModels';
      payload: ProviderProfile;
    }
  | { type: 'reset' }
  | { type: 'exportData' }
  | { type: 'importData' }
  | { type: 'importLegacyData' }
  | { type: 'selectiveExport'; payload: { categories: string[] } }
  | { type: 'deleteTemplate'; templateId: string; templateName: string }
  | { type: 'renameTemplate'; templateId: string; name?: string; currentName?: string }
  | { type: 'saveMcpServers'; payload: McpServerProfile[] | { servers: McpServerProfile[]; groups?: import('./types').McpServerGroup[]; maxToolRounds?: number } }
  | { type: 'saveMcpToolRounds'; payload: McpToolRoundsPayload }
  | { type: 'probeMcpServers' }
  | { type: 'testMcpServer'; payload: { server: McpServerProfile } }
  | {
      type: 'deleteMcpServer';
      payload: {
        serverId: string;
        serverName: string;
      };
    }
  | { type: 'browseBackupDir' }
  | { type: 'saveLocalBackupSettings'; payload: import('./types').LocalBackupSettings }
  | { type: 'triggerLocalBackup' }
  | { type: 'restoreLocalBackup'; payload: { fileName: string } }
  | { type: 'deleteLocalBackup'; payload: { fileName: string } }
  | { type: 'refreshBackupList' }
  | { type: 'setBackupPassword'; payload?: { password: string } }
  | { type: 'clearBackupPassword' }
  | { type: 'queryBackupPasswordStatus' }
  | { type: 'requestAddMcpGroup' }
  | { type: 'requestDeleteMcpGroup'; payload: { groupId: string; groupName: string } }
  | { type: 'switchStorageMode'; payload: { mode: StorageMode } }
  | { type: 'confirmStorageMigration'; payload: { mode: StorageMode; migrate: boolean } };

export type SettingsCenterState = {
  strings: RuntimeStrings;
  activeSection: SettingsCenterSection;
  languageOptions: ReadonlyArray<{ value: ChatBuddyLocaleSetting; label: string }>;
  sendShortcutOptions: ReadonlyArray<{ value: ChatSendShortcut; label: string }>;
  chatTabModeOptions: ReadonlyArray<{ value: ChatTabMode; label: string }>;
  timeoutOptions: ReadonlyArray<{ value: string; label: string }>;
  settings: ChatBuddySettings;
  modelOptions: ProviderModelOption[];
  invalidDefaultSelection: string;
  bulletin: {
    deprecationStartVersion: string;
    removalVersion: string;
  };
  about: {
    appName: string;
    version: string;
    author: string;
    authorUrl: string;
    publisher: string;
    license: string;
    repositoryUrl: string;
    marketplaceUrl: string;
    openVsxUrl: string;
  };
  changelogMarkdown: string;
  notice?: string;
  noticeTone?: 'success' | 'error' | 'info';
  backupFiles: import('./types').BackupFileEntry[];
  templates?: import('./types').AssistantTemplate[];
  syncConfig?: { storageMode: StorageMode; usingShared: boolean };
};

export type SettingsCenterOutbound =
  | {
      type: 'state';
      payload: SettingsCenterState;
    }
  | {
      type: 'activateSection';
      section: SettingsCenterSection;
    }
  | {
      type: 'connectionResult';
      payload: {
        providerId: string;
        success: boolean;
        message: string;
      };
    }
  | {
      type: 'modelsFetched';
      payload: {
        providerId: string;
        models: ProviderModelProfile[];
        success: boolean;
        message: string;
      };
    }
  | {
      type: 'mcpProbeResult';
      payload: {
        results: Array<{
          serverId: string;
          success: boolean;
          tools: Array<{ name: string; description: string }>;
          resources: Array<{ name: string; uri: string; description?: string }>;
          prompts: Array<{ name: string; description?: string }>;
          error?: string;
          probedAt?: number;
        }>;
        lastProbeAt?: number;
        fromCache?: boolean;
      };
    }
  | { type: 'backupDirSelected'; payload: { dir: string } }
  | { type: 'backupList'; payload: { items: import('./types').BackupFileEntry[] } }
  | { type: 'backupOperationResult'; payload: { success: boolean; message: string } }
  | { type: 'backupPasswordStatus'; payload: { hasPassword: boolean } }
  | { type: 'mcpGroupAdded'; payload: { name: string } }
  | { type: 'mcpGroupDeleted'; payload: { groupId: string } }
  | { type: 'storageMigrationPrompt'; payload: { targetMode: StorageMode } }
  | { type: 'storageSwitchResult'; payload: { success: boolean; reason?: string; filesCopied?: number; restartNeeded: boolean } };

// ─── 工具函数 ────────────────────────────────────────────────────────

export function normalizeSection(section: SettingsCenterSection | string | undefined): SettingsCenterSection {
  if (
    section === 'modelConfig' ||
    section === 'defaultModels' ||
    section === 'general' ||
    section === 'dataManagement' ||
    section === 'templates' ||
    section === 'mcp' ||
    section === 'about'
  ) {
    return section;
  }
  return 'general';
}

export function normalizeMcpServers(
  payload: McpServerProfile[] | { servers: McpServerProfile[]; groups?: import('./types').McpServerGroup[]; maxToolRounds?: number },
  fallback: ChatBuddySettings
): ChatBuddySettings {
  if (Array.isArray(payload)) {
    return {
      ...fallback,
      mcp: {
        ...fallback.mcp,
        servers: payload,
        groups: fallback.mcp.groups || []
      }
    };
  }
  return {
    ...fallback,
    mcp: {
      ...fallback.mcp,
      servers: payload.servers,
      groups: payload.groups ?? fallback.mcp.groups ?? [],
      maxToolRounds:
        typeof payload.maxToolRounds === 'number'
          ? Math.max(1, Math.min(20, payload.maxToolRounds))
          : fallback.mcp.maxToolRounds
    }
  };
}

export function normalizeMcpToolRounds(input: McpToolRoundsPayload, fallback: ChatBuddySettings): ChatBuddySettings {
  const raw = typeof input.maxToolRounds === 'number' ? input.maxToolRounds : 5;
  return {
    ...fallback,
    mcp: {
      ...fallback.mcp,
      maxToolRounds: Math.max(1, Math.min(20, raw))
    }
  };
}

export function toModelRef(value: ChatBuddySettings['defaultModels']['assistant']): string {
  return value ? createModelRef(value.providerId, value.modelId) : '';
}
