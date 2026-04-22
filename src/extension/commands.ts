/**
 * 命令注册聚合器。
 */
import * as vscode from 'vscode';

import type { ExtensionContext } from './shared';
import { registerSettingsCommands } from './settingsCommands';
import { registerNavigationCommands } from './navigationCommands';
import { registerAssistantTreeCommands } from './assistantTreeCommands';
import { registerAssistantManagementCommands } from './assistantManagementCommands';
import { registerSessionCommands } from './sessionCommands';
import { registerLocaleAwareMenuAliasCommands } from './localeMenuCommands';

export function registerCommands(ctx: ExtensionContext): vscode.Disposable[] {
  return [
    ...registerSettingsCommands(ctx),
    ...registerNavigationCommands(ctx),
    ...registerAssistantTreeCommands(ctx),
    ...registerAssistantManagementCommands(ctx),
    ...registerSessionCommands(ctx),
    ...registerLocaleAwareMenuAliasCommands()
  ];
}
