/**
 * 设置相关命令注册模块。
 *
 * 注册打开设置中心各页面的命令（通用设置、模型配置、默认模型、MCP、关于）。
 */
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
    }),
    vscode.commands.registerCommand('chatbuddy.openDataManagement', () => {
      settingsCenterPanelController.openPanel('dataManagement');
    }),
    vscode.commands.registerCommand('chatbuddy.openTemplates', () => {
      settingsCenterPanelController.openPanel('templates');
    }),
    vscode.commands.registerCommand('chatbuddy.openAbout', () => {
      settingsCenterPanelController.openPanel('about');
    })
  ];
}
