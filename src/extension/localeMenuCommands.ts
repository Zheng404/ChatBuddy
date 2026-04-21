/**
 * 本地化菜单别名命令注册模块。
 *
 * 根据当前语言环境动态注册中英文菜单标题的命令别名，
 * 使树视图的右键菜单标题能够随语言设置切换。
 */
import * as vscode from 'vscode';

import localeAwareManifestData from './localeAwareManifestData.json';

const LOCALE_AWARE_MENU_COMMANDS = localeAwareManifestData.commands.map((item) => item.command);

export function registerLocaleAwareMenuAliasCommands(): vscode.Disposable[] {
  return LOCALE_AWARE_MENU_COMMANDS.flatMap((commandId) => [
    vscode.commands.registerCommand(`${commandId}.uiEn`, (...args: unknown[]) => vscode.commands.executeCommand(commandId, ...args)),
    vscode.commands.registerCommand(`${commandId}.uiZh`, (...args: unknown[]) => vscode.commands.executeCommand(commandId, ...args))
  ]);
}
