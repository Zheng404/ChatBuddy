import * as vscode from 'vscode';
import type { ExtensionContext } from './shared';

export function registerSettingsCommands(ctx: ExtensionContext): vscode.Disposable[] {
  const { settingsCenterPanelController } = ctx;
  return [
    vscode.commands.registerCommand('chatbuddy.openSettings', () => {
      settingsCenterPanelController.openPanel('general');
    }),
    vscode.commands.registerCommand('chatbuddy.openModelConfig', () => {
      settingsCenterPanelController.openPanel('modelConfig');
    }),
    vscode.commands.registerCommand('chatbuddy.openDefaultModels', () => {
      settingsCenterPanelController.openPanel('defaultModels');
    }),
    vscode.commands.registerCommand('chatbuddy.openMcp', () => {
      settingsCenterPanelController.openPanel('mcp');
    })
  ];
}
