/**
 * 数据操作处理器（导入/导出/重置）。
 */
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';

import { ChatController } from '../chatbuddy/chatController';
import { createBackupArchive, extractBackupPayloadFromArchive, isZipArchive } from '../chatbuddy/backupArchive';
import { formatString } from '../chatbuddy/i18n';
import { ChatStateRepository } from '../chatbuddy/stateRepository';
import { warn } from '../chatbuddy/utils';
import { DataActionResult, ActivationSidebarViewProviders } from './activationTypes';
import { buildBackupFileName } from './shared';

/**
 * 清空 assistants / recycleBin 两个侧边栏 Webview View 的搜索状态。
 *
 * 阶段 2.3：从原 TreeProvider.clearSearchKeyword 改为 WebviewView Provider.clearSearch，
 *          同时推送清空搜索框指令与最新状态到前端。
 */
export function clearAssistantSearchFilters(
  sidebarViewProviders: ActivationSidebarViewProviders
): void {
  sidebarViewProviders.assistantsViewProvider.clearSearch();
  sidebarViewProviders.recycleBinViewProvider.clearSearch();
}

export function createDataActionHandlers(args: {
  repository: ChatStateRepository;
  chatController: ChatController;
  sidebarViewProviders: ActivationSidebarViewProviders;
  refreshAll: () => void;
  getRuntimeStrings: () => Record<string, string>;
}): {
  handleResetData: () => Promise<boolean>;
  handleExportData: () => Promise<DataActionResult | undefined>;
  handleImportData: () => Promise<DataActionResult | undefined>;
  handleImportLegacyData: () => Promise<DataActionResult | undefined>;
  handleSelectiveExportData: (categories: string[]) => Promise<DataActionResult | undefined>;
} {
  const {
    repository,
    chatController,
    sidebarViewProviders,
    refreshAll,
    getRuntimeStrings
  } = args;

  const handleSelectiveExportData = async (categories: string[]): Promise<DataActionResult | undefined> => {
      const strings = getRuntimeStrings();
      if (!categories.length) {
        return { notice: strings.selectiveExportNoCategory || 'Please select at least one category.', tone: 'error' };
      }
      const fileName = 'chatbuddy-selective-export.json';
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      const defaultUri = workspaceRoot
        ? vscode.Uri.joinPath(workspaceRoot, fileName)
        : vscode.Uri.file(path.join(os.homedir(), fileName));
      const uri = await vscode.window.showSaveDialog({
        saveLabel: strings.selectiveExportAction || 'Export Selected',
        filters: { JSON: ['json'] },
        defaultUri
      });
      if (!uri) { return undefined; }
      const data = repository.exportSelectiveData(categories);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(data, null, 2), 'utf8'));
      return {
        notice: formatString(strings.selectiveExportDone || 'Selective export saved to: {path}', { path: uri.fsPath }),
        tone: 'success'
      };
    };

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
      clearAssistantSearchFilters(sidebarViewProviders);
      refreshAll();
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
          ZIP: ['zip']
        },
        defaultUri
      });
      if (!uri) {
        return undefined;
      }
      const backup = repository.exportBackupData();
      const archive = createBackupArchive(backup);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(archive));
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
          ZIP: ['zip']
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
        if (!isZipArchive(raw)) {
          throw new Error('Expected ZIP backup archive');
        }
        parsed = await extractBackupPayloadFromArchive(raw);
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
      clearAssistantSearchFilters(sidebarViewProviders);
      refreshAll();
      return {
        notice: strings.importDataDone,
        tone: 'success'
      };
    },
    handleImportLegacyData: async () => {
      const strings = getRuntimeStrings();
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: strings.importLegacyDataAction,
        filters: {
          JSON: ['json']
        }
      });
      const target = picked?.[0];
      if (!target) {
        return undefined;
      }
      const confirmed = await vscode.window.showWarningMessage(
        strings.confirmImportLegacyData,
        { modal: true },
        strings.importLegacyDataAction
      );
      if (confirmed !== strings.importLegacyDataAction) {
        return undefined;
      }

      let parsed: unknown;
      try {
        const raw = await vscode.workspace.fs.readFile(target);
        if (isZipArchive(raw)) {
          throw new Error('Legacy JSON import does not accept ZIP archives');
        }
        parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
      } catch (err) {
        warn('Failed to parse legacy backup file:', err);
        return {
          notice: strings.importLegacyDataInvalid,
          tone: 'error'
        };
      }

      try {
        chatController.stopGeneration('manual');
        await repository.importBackupData(parsed);
      } catch (err) {
        warn('Failed to import legacy backup data:', err);
        return {
          notice: strings.importLegacyDataInvalid,
          tone: 'error'
        };
      }

      chatController.applySettings(repository.getSettings());
      chatController.openAssistantChat();
      clearAssistantSearchFilters(sidebarViewProviders);
      refreshAll();
      return {
        notice: strings.importLegacyDataDone,
        tone: 'success'
      };
    },
    handleSelectiveExportData
  };
}
