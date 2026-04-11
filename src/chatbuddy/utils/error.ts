/**
 * Extract a safe error message from an unknown thrown value.
 * Falls back to the provided default message if the error is not an Error instance.
 */
export function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
