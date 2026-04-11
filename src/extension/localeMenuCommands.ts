import * as vscode from 'vscode';

const LOCALE_AWARE_MENU_COMMANDS = [
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

export function registerLocaleAwareMenuAliasCommands(): vscode.Disposable[] {
  return LOCALE_AWARE_MENU_COMMANDS.flatMap((commandId) => [
    vscode.commands.registerCommand(`${commandId}.uiEn`, (...args: unknown[]) => vscode.commands.executeCommand(commandId, ...args)),
    vscode.commands.registerCommand(`${commandId}.uiZh`, (...args: unknown[]) => vscode.commands.executeCommand(commandId, ...args))
  ]);
}
