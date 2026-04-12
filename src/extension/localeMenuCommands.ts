import * as vscode from 'vscode';

import localeAwareManifestData from './localeAwareManifestData.json';

const LOCALE_AWARE_MENU_COMMANDS = localeAwareManifestData.commands.map((item) => item.command);

export function registerLocaleAwareMenuAliasCommands(): vscode.Disposable[] {
  return LOCALE_AWARE_MENU_COMMANDS.flatMap((commandId) => [
    vscode.commands.registerCommand(`${commandId}.uiEn`, (...args: unknown[]) => vscode.commands.executeCommand(commandId, ...args)),
    vscode.commands.registerCommand(`${commandId}.uiZh`, (...args: unknown[]) => vscode.commands.executeCommand(commandId, ...args))
  ]);
}
