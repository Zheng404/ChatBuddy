/**
 * Retry a function with exponential backoff.
 *
 * Retries on HTTP status codes that indicate transient failures
 * (429 rate-limited, 5xx server errors) and network-level errors
 * (ECONNREFUSED, ETIMEDOUT, ENOTFOUND, fetch TypeError).
 * Client errors (4xx except 429) are not retried.
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
  /** AbortSignal to cancel pending retries. */
  signal?: AbortSignal;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'isRetryable' | 'signal'>> = {
  maxRetries: 2,
  baseDelayMs: 1000,
  backoffFactor: 2,
  jitterMs: 500
};

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
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

/** 精确匹配的网络相关 errno 代码，避免 `code.startsWith('E')` 误判。 */
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND',
  'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ECONNABORTED',
]);

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && error.message === 'fetch failed') {
    return true;
  }
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) {
      return true;
    }
    // Some fetch implementations wrap network errors with a cause
    const cause = (error as { cause?: unknown }).cause;
    if (cause && isNetworkError(cause)) {
      return true;
    }
  }
  return false;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
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
          : status !== undefined
            ? isTransientHttpStatus(status)
            : isNetworkError(err) && !isAbortError(err);

      if (!retryable || attempt >= opts.maxRetries) {
        throw err;
      }

      const delay = jitter(
        opts.baseDelayMs * Math.pow(opts.backoffFactor, attempt),
        opts.jitterMs
      );
      await abortableSleep(Math.max(0, delay), options.signal);
    }
  }

  throw lastError;
}
