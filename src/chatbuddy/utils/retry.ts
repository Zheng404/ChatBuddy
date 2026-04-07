/**
 * Retry a function with exponential backoff.
 *
 * Only retries on HTTP status codes that indicate transient failures
 * (429 rate-limited, 5xx server errors). Client errors (4xx except 429)
 * are not retried.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 2, i.e. 3 total calls). */
  maxRetries?: number;
  /** Initial delay in ms (default: 1000). */
  baseDelayMs?: number;
  /** Multiplier for each subsequent delay (default: 2). */
  backoffFactor?: number;
  /** Random jitter range in ms (default: 500). */
  jitterMs?: number;
  /** Custom predicate to decide whether a given error is retryable. */
  isRetryable?(error: unknown): boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'isRetryable'>> = {
  maxRetries: 2,
  baseDelayMs: 1000,
  backoffFactor: 2,
  jitterMs: 500
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jitter(ms: number, range: number): number {
  return ms + (Math.random() - 0.5) * 2 * range;
}

function extractStatus(error: unknown): number | undefined {
  if (error instanceof Response) {
    return error.status;
  }
  if (error instanceof Error && 'status' in error) {
    return (error as Error & { status: number }).status;
  }
  return undefined;
}

function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const status = extractStatus(err);
      const retryable =
        options.isRetryable
          ? options.isRetryable(err)
          : status !== undefined && isTransientHttpStatus(status);

      if (!retryable || attempt >= opts.maxRetries) {
        throw err;
      }

      const delay = jitter(
        opts.baseDelayMs * Math.pow(opts.backoffFactor, attempt),
        opts.jitterMs
      );
      await sleep(Math.max(0, delay));
    }
  }

  throw lastError;
}
