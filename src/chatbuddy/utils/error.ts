/**
 * Extract a safe error message from an unknown thrown value.
 * Falls back to the provided default message if the error is not an Error instance.
 */
export function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Safely deliver a Webview `postMessage` Thenable, silently ignoring rejection.
 *
 * VS Code's `postMessage` returns a `Thenable` (not a standard Promise, so no
 * `.catch`). It rejects when the target webview has been disposed — this is
 * expected behavior (panel closed / view hidden) rather than a real error, so
 * the rejection is intentionally swallowed.
 *
 * Use this helper instead of the repetitive `.then(undefined, () => {})` to
 * make the intent explicit and keep call sites concise.
 */
export function postMessageSafely(promise: Thenable<unknown>): void {
  void promise.then(undefined, () => {
    // webview 已销毁时 postMessage 会 reject，属预期行为，安全忽略
  });
}
