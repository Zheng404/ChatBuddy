import * as vscode from 'vscode';

const PREFIX = '[ChatBuddy]';

export function warn(message: string, ...args: unknown[]): void {
  console.warn(PREFIX, message, ...args);
}

export function error(message: string, ...args: unknown[]): void {
  console.error(PREFIX, message, ...args);
}

export function log(message: string, ...args: unknown[]): void {
  // 在开发模式下输出日志
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    // eslint-disable-next-line no-console
    console.log(PREFIX, message, ...args);
  }
}

/**
 * 在 VSCode 输出通道中输出日志（如需要更正式的日志输出）
 */
export function createOutputChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
  const channel = vscode.window.createOutputChannel('ChatBuddy');
  context.subscriptions.push(channel);
  return channel;
}
