/**
 * ChatGenerationService 单元测试。
 *
 * 覆盖错误消息解析、生成状态判断等纯函数/轻逻辑。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGenerationErrorMessage } from '../chatbuddy/chatControllerToolOrchestrator';

function makeStrings(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    generationStopped: 'Generation stopped by user.',
    requestTimeout: 'Request timed out.',
    networkError: 'Network error occurred.',
    authFailed: 'Authentication failed.',
    rateLimitExceeded: 'Rate limit exceeded.',
    unknownError: 'Unknown error.',
    ...overrides
  };
}

describe('resolveGenerationErrorMessage', () => {
  test('returns generationStopped for manual abort', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('ignored'), 'manual', strings);
    assert.equal(result, strings.generationStopped);
  });

  test('returns requestTimeout for timeout abort', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('ignored'), 'timeout', strings);
    assert.equal(result, strings.requestTimeout);
  });

  test('detects network error from message', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('Network error: connection refused'), undefined, strings);
    assert.equal(result, strings.networkError);
  });

  test('detects fetch error from message', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('fetch failed'), undefined, strings);
    assert.equal(result, strings.networkError);
  });

  test('detects 401 unauthorized error', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('Request failed: 401 Unauthorized'), undefined, strings);
    assert.equal(result, strings.authFailed);
  });

  test('detects rate limit from 429', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('429 Too Many Requests'), undefined, strings);
    assert.equal(result, strings.rateLimitExceeded);
  });

  test('detects rate limit from text', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('Rate limit exceeded, try later'), undefined, strings);
    assert.equal(result, strings.rateLimitExceeded);
  });

  test('detects timeout from error message', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('Connection timeout after 30s'), undefined, strings);
    assert.equal(result, strings.requestTimeout);
  });

  test('returns generic error message for unmatched Error', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('Something went wrong'), undefined, strings);
    assert.equal(result, 'Something went wrong');
  });

  test('falls back to unknownError for non-Error value', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(null, undefined, strings);
    assert.equal(result, strings.unknownError);
  });

  test('falls back to unknownError for string error', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage('raw string error', undefined, strings);
    assert.equal(result, strings.unknownError);
  });

  test('falls back to error.message when localized string missing', () => {
    const strings = { unknownError: 'Fallback' };
    const result = resolveGenerationErrorMessage(new Error('Custom error'), undefined, strings);
    assert.equal(result, 'Custom error');
  });

  test('prioritizes abortReason over error message', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('timeout in message'), 'manual', strings);
    assert.equal(result, strings.generationStopped);
  });

  test('returns unknownError for empty Error message', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error(''), undefined, strings);
    assert.equal(result, strings.unknownError);
  });
});
