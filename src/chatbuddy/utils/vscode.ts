/**
 * VS Code 命令相关的安全辅助函数。
 */
import * as vscode from 'vscode';

/**
 * 安全地执行 `setContext` 命令，静默忽略 rejection。
 *
 * VS Code 的 `executeCommand('setContext', ...)` 返回 `Thenable`（不是标准
 * Promise，因此没有 `.catch`）。它在扩展卸载、面板销毁等生命周期边缘
 * 可能 reject —— 这属于预期行为而非真实错误，因此 rejection 被有意吞掉。
 *
 * 使用此辅助函数替代重复的 `void ... .then(undefined, () => {})`，
 * 让意图更明确、调用点更简洁（与 `postMessageSafely` 对齐）。
 */
export function safeSetContext(key: string, value: unknown): void {
  void vscode.commands.executeCommand('setContext', key, value).then(undefined, () => {
    // setContext 在扩展生命周期边缘可能 reject，属预期行为，安全忽略
  });
}
