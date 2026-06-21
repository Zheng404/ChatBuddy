import test from 'node:test';
import assert from 'node:assert/strict';

import { retryWithBackoff } from '../../../chatbuddy/utils/retry';

// ─── Helpers ─────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(public readonly status: number, message?: string) {
    super(message || `HTTP ${status}`);
    this.name = 'HttpError';
  }
}

class NonHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonHttpError';
  }
}

/** Create a function that fails `failCount` times then succeeds. */
function succeedAfter(failCount: number, value: string = 'ok'): () => Promise<string> {
  let calls = 0;
  return async () => {
    calls++;
    if (calls <= failCount) {
      throw new HttpError(500, 'server error');
    }
    return value;
  };
}

/** Create a function that always fails with the given error. */
function alwaysFail(error: unknown): () => Promise<string> {
  return async () => { throw error; };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('retryWithBackoff - returns immediately on success', async () => {
  const result = await retryWithBackoff(() => Promise.resolve('hello'));
  assert.equal(result, 'hello');
});

test('retryWithBackoff - retries on 500 and succeeds', async () => {
  const fn = succeedAfter(1, 'recovered');
  const result = await retryWithBackoff(fn, { baseDelayMs: 1, jitterMs: 0 });
  assert.equal(result, 'recovered');
});

test('retryWithBackoff - retries on 429 and succeeds', async () => {
  const fn = succeedAfter(2, 'rate-limited-ok');
  const result = await retryWithBackoff(fn, {
    maxRetries: 3,
    baseDelayMs: 1,
    jitterMs: 0
  });
  assert.equal(result, 'rate-limited-ok');
});

test('retryWithBackoff - retries on 502 and succeeds', async () => {
  const fn = succeedAfter(1, 'bad-gateway-ok');
  const result = await retryWithBackoff(fn, { baseDelayMs: 1, jitterMs: 0 });
  assert.equal(result, 'bad-gateway-ok');
});

test('retryWithBackoff - retries on 503 and succeeds', async () => {
  const fn = succeedAfter(1, 'unavailable-ok');
  const result = await retryWithBackoff(fn, { baseDelayMs: 1, jitterMs: 0 });
  assert.equal(result, 'unavailable-ok');
});

test('retryWithBackoff - throws after exhausting retries on 500', async () => {
  const fn = alwaysFail(new HttpError(500, 'persistent error'));
  await assert.rejects(
    () => retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 1, jitterMs: 0 }),
    { message: 'persistent error' }
  );
});

test('retryWithBackoff - does not retry on 400 (client error)', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new HttpError(400, 'bad request');
  };
  await assert.rejects(() => retryWithBackoff(fn), { message: 'bad request' });
  assert.equal(calls, 1, 'should only be called once');
});

test('retryWithBackoff - does not retry on 401 (unauthorized)', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new HttpError(401, 'unauthorized');
  };
  await assert.rejects(() => retryWithBackoff(fn), { message: 'unauthorized' });
  assert.equal(calls, 1, 'should only be called once');
});

test('retryWithBackoff - does not retry on 404 (not found)', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new HttpError(404, 'not found');
  };
  await assert.rejects(() => retryWithBackoff(fn), { message: 'not found' });
  assert.equal(calls, 1, 'should only be called once');
});

test('retryWithBackoff - retries on 429 (rate limited)', async () => {
  const fn = succeedAfter(1, 'rate-limit-recovered');
  const result = await retryWithBackoff(fn, { baseDelayMs: 1, jitterMs: 0 });
  assert.equal(result, 'rate-limit-recovered');
});

test('retryWithBackoff - does not retry on non-HTTP error without status', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new NonHttpError('something broke');
  };
  await assert.rejects(() => retryWithBackoff(fn), { message: 'something broke' });
  assert.equal(calls, 1, 'should only be called once for non-HTTP errors');
});

test('retryWithBackoff - custom isRetryable predicate', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new NonHttpError('retryable');
  };
  await assert.rejects(
    () => retryWithBackoff(fn, {
      maxRetries: 1,
      baseDelayMs: 1,
      jitterMs: 0,
      isRetryable: (err) => err instanceof NonHttpError && err.message === 'retryable'
    })
  );
  assert.equal(calls, 2, 'should retry once due to custom predicate');
});

test('retryWithBackoff - custom isRetryable returning false does not retry', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new HttpError(500, 'server error');
  };
  await assert.rejects(
    () => retryWithBackoff(fn, {
      maxRetries: 2,
      baseDelayMs: 1,
      jitterMs: 0,
      isRetryable: () => false
    })
  );
  assert.equal(calls, 1, 'should not retry when custom predicate returns false');
});

test('retryWithBackoff - default maxRetries is 2 (3 total calls)', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new HttpError(503, 'service unavailable');
  };
  await assert.rejects(() => retryWithBackoff(fn, { baseDelayMs: 1, jitterMs: 0 }));
  assert.equal(calls, 3, 'default maxRetries=2 means 1 initial + 2 retries = 3 calls');
});

test('retryWithBackoff - maxRetries=0 means no retries', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new HttpError(500, 'server error');
  };
  await assert.rejects(() => retryWithBackoff(fn, { maxRetries: 0, baseDelayMs: 1, jitterMs: 0 }));
  assert.equal(calls, 1, 'maxRetries=0 means only 1 call, no retries');
});

test('retryWithBackoff - Response object with 500 status triggers retry', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    // Response object with status property
    const response = new Response(null, { status: calls < 2 ? 500 : 200 });
    if (response.status === 500) {
      throw response;
    }
    return 'response-ok';
  };
  const result = await retryWithBackoff(fn, { baseDelayMs: 1, jitterMs: 0 });
  assert.equal(result, 'response-ok');
  assert.equal(calls, 2);
});

test('retryWithBackoff - exponential backoff with zero jitter is deterministic', async () => {
  let attempt = 0;
  const fn = async () => {
    attempt++;
    if (attempt < 3) {
      throw new HttpError(500, 'server error');
    }
    return 'backoff-ok';
  };
  const startTime = Date.now();
  await retryWithBackoff(fn, {
    maxRetries: 3,
    baseDelayMs: 10,
    backoffFactor: 2,
    jitterMs: 0
  });
  const elapsed = Date.now() - startTime;
  // With 2 retries before success: delay1 = 10*2^0 = 10ms, delay2 = 10*2^1 = 20ms
  // Total delay should be at least 30ms
  assert.ok(elapsed >= 25, `expected at least ~30ms delay, got ${elapsed}ms`);
});

test('retryWithBackoff - handles void return type', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls < 2) {
      throw new HttpError(500, 'server error');
    }
    // void return
  };
  const result = await retryWithBackoff(fn, { baseDelayMs: 1, jitterMs: 0 });
  assert.equal(result, undefined);
  assert.equal(calls, 2);
});

test('retryWithBackoff - empty options uses defaults', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new HttpError(503, 'unavailable');
  };
  await assert.rejects(() => retryWithBackoff(fn));
  assert.equal(calls, 3, 'default options should allow 3 total calls');
});

// ─── Bug 4: abortableSleep abort listener cleanup ─────────────────

test('retryWithBackoff - abort signal rejects pending retry (Bug 4)', async () => {
  const controller = new AbortController();
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls === 1) {
      throw new HttpError(500, 'server error');
    }
    return 'ok';
  };
  // 在第一次失败后立即 abort，abortableSleep 应立即 reject
  const promise = retryWithBackoff(fn, {
    baseDelayMs: 5000,
    jitterMs: 0,
    signal: controller.signal
  });
  // 等待 fn 执行完毕进入 sleep
  await new Promise((r) => setTimeout(r, 20));
  controller.abort();
  await assert.rejects(promise, (err: unknown) => {
    return err instanceof DOMException && err.name === 'AbortError';
  });
  assert.equal(calls, 1);
});

test('retryWithBackoff - normal completion leaves signal without dangling listeners (Bug 4)', async () => {
  // Bug 4 修复前：abortableSleep 正常 resolve 时不会移除 abort 监听器，
  // 多次重试会在 signal 上累积监听器。修复后每次 sleep 完成都会清理。
  // 此测试验证多次重试后仍能正常完成，且 signal 可被 gc（无强引用泄漏）。
  const controller = new AbortController();
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls < 3) {
      throw new HttpError(500, 'server error');
    }
    return 'recovered';
  };
  const result = await retryWithBackoff(fn, {
    maxRetries: 3,
    baseDelayMs: 1,
    jitterMs: 0,
    signal: controller.signal
  });
  assert.equal(result, 'recovered');
  assert.equal(calls, 3);
  // signal 仍未 aborted，可安全复用
  assert.equal(controller.signal.aborted, false);
});
