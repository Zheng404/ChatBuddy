/**
 * streamAccumulator 单元测试。
 *
 * 覆盖流累积器创建、刷新回调、定时器调度、回调构建、错误内容构建等逻辑。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStreamAccumulator,
  buildStreamFlush,
  scheduleStreamFlush,
  clearStreamFlush,
  buildStreamCallbacks,
  buildStreamErrorContent,
  STREAM_FLUSH_INTERVAL_MS
} from '../chatbuddy/streamAccumulator';
import type { StreamAccumulator } from '../chatbuddy/streamAccumulator';
import type { RuntimeStrings } from '../chatbuddy/types';
import type { ChatStateRepository } from '../chatbuddy/stateRepository';

// ─── Helpers ────────────────────────────────────────────────────────

function makeAcc(overrides: Partial<StreamAccumulator> = {}): StreamAccumulator {
  return { ...createStreamAccumulator(), ...overrides };
}

function makeStrings(overrides: Partial<RuntimeStrings> = {}): RuntimeStrings {
  return { emptyResponse: '(empty)', ...overrides };
}

interface CapturedUpdate {
  id: string;
  content: string;
  model: string;
  reasoning?: string;
  toolRounds?: unknown;
  persist: boolean;
}

function createMockRepository(captures: CapturedUpdate[]): ChatStateRepository {
  return {
    updateLastAssistantMessage(
      _aid: string,
      _sid: string,
      updater: (current: { id: string; role: string; content: string; timestamp: number; model: string } | undefined) => Record<string, unknown>,
      persist: boolean
    ) {
      const result = updater(undefined);
      captures.push({
        id: result.id as string,
        content: result.content as string,
        model: result.model as string,
        reasoning: result.reasoning as string | undefined,
        toolRounds: result.toolRounds,
        persist
      });
    }
  } as unknown as ChatStateRepository;
}

// ─── createStreamAccumulator ────────────────────────────────────────

describe('createStreamAccumulator', () => {
  test('initializes all fields to empty/undefined', () => {
    const acc = createStreamAccumulator();
    assert.equal(acc.rawMerged, '');
    assert.equal(acc.rawPersisted, '');
    assert.equal(acc.reasoningMerged, '');
    assert.equal(acc.reasoningPersisted, '');
    assert.equal(acc.flushTimer, undefined);
  });
});

// ─── buildStreamFlush ───────────────────────────────────────────────

describe('buildStreamFlush', () => {
  test('flushes content via repository.updateLastAssistantMessage', () => {
    const acc = makeAcc({ rawMerged: 'Hello world' });
    const captures: CapturedUpdate[] = [];
    const repository = createMockRepository(captures);
    const flush = buildStreamFlush(acc, {
      assistantId: 'a1',
      sessionId: 's1',
      fallbackMessageId: 'msg-fb',
      modelLabel: 'TestModel'
    }, repository, makeStrings());

    flush(true);

    assert.equal(captures.length, 1);
    assert.equal(captures[0].persist, true);
    assert.equal(captures[0].content, 'Hello world');
    assert.equal(captures[0].model, 'TestModel');
  });

  test('uses fallbackMessageId when no current message', () => {
    const acc = makeAcc({ rawMerged: 'content' });
    const captures: CapturedUpdate[] = [];
    const repository = createMockRepository(captures);
    const flush = buildStreamFlush(acc, {
      assistantId: 'a1',
      sessionId: 's1',
      fallbackMessageId: 'msg-fb',
      modelLabel: 'M'
    }, repository, makeStrings());

    flush(true);
    assert.equal(captures[0].id, 'msg-fb');
  });

  test('uses emptyResponse string when content is blank and persist is true', () => {
    const acc = makeAcc({ rawMerged: '   ' });
    const captures: CapturedUpdate[] = [];
    const repository = createMockRepository(captures);
    const flush = buildStreamFlush(acc, {
      assistantId: 'a1',
      sessionId: 's1',
      fallbackMessageId: 'msg-fb',
      modelLabel: 'M'
    }, repository, makeStrings({ emptyResponse: '(no content)' }));

    flush(true);
    assert.equal(captures[0].content, '(no content)');
  });

  test('uses empty string when content is blank and persist is false', () => {
    const acc = makeAcc({ rawMerged: '   ' });
    const captures: CapturedUpdate[] = [];
    const repository = createMockRepository(captures);
    const flush = buildStreamFlush(acc, {
      assistantId: 'a1',
      sessionId: 's1',
      fallbackMessageId: 'msg-fb',
      modelLabel: 'M'
    }, repository, makeStrings({ emptyResponse: '(no content)' }));

    flush(false);
    assert.equal(captures[0].content, '');
  });

  test('updates rawPersisted and reasoningPersisted after flush', () => {
    const acc = makeAcc({ rawMerged: 'hello', reasoningMerged: 'thinking' });
    const repository = createMockRepository([]);
    const flush = buildStreamFlush(acc, {
      assistantId: 'a1',
      sessionId: 's1',
      fallbackMessageId: 'msg-fb',
      modelLabel: 'M'
    }, repository, makeStrings());

    flush(true);
    assert.equal(acc.rawPersisted, 'hello');
    assert.equal(acc.reasoningPersisted, 'thinking');
  });

  test('calls notifyState callback', () => {
    const acc = makeAcc({ rawMerged: 'content' });
    const repository = createMockRepository([]);
    const notified: boolean[] = [];
    const flush = buildStreamFlush(acc, {
      assistantId: 'a1',
      sessionId: 's1',
      fallbackMessageId: 'msg-fb',
      modelLabel: 'M'
    }, repository, makeStrings(), (persist) => { notified.push(persist); });

    flush(true);
    flush(false);
    assert.deepEqual(notified, [true, false]);
  });

  test('calls notifyDelta callback with content and reasoning', () => {
    const acc = makeAcc({ rawMerged: 'hello', reasoningMerged: 'thinking' });
    const repository = createMockRepository([]);
    const deltas: Array<{ content: string; reasoning?: string }> = [];
    const flush = buildStreamFlush(acc, {
      assistantId: 'a1',
      sessionId: 's1',
      fallbackMessageId: 'msg-fb',
      modelLabel: 'M'
    }, repository, makeStrings(), undefined, (content, reasoning) => { deltas.push({ content, reasoning }); });

    flush(false);
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0].content, 'hello');
    assert.equal(deltas[0].reasoning, 'thinking');
  });

  test('notifyDelta is called before notifyState', () => {
    const acc = makeAcc({ rawMerged: 'content' });
    const repository = createMockRepository([]);
    const order: string[] = [];
    const flush = buildStreamFlush(acc, {
      assistantId: 'a1',
      sessionId: 's1',
      fallbackMessageId: 'msg-fb',
      modelLabel: 'M'
    }, repository, makeStrings(), () => { order.push('state'); }, () => { order.push('delta'); });

    flush(false);
    assert.deepEqual(order, ['delta', 'state']);
  });

  test('handles think-tagged content correctly', () => {
    const acc = makeAcc({ rawMerged: '<think reasoning here</think actual content' });
    const captures: CapturedUpdate[] = [];
    const repository = createMockRepository(captures);
    const flush = buildStreamFlush(acc, {
      assistantId: 'a1',
      sessionId: 's1',
      fallbackMessageId: 'msg-fb',
      modelLabel: 'M'
    }, repository, makeStrings());

    flush(true);
    assert.equal(captures.length, 1);
    // <think without closing > is treated as raw content, not parsed as think block
    assert.equal(captures[0].content, '<think reasoning here</think actual content');
  });

  test('includes toolRounds when provided', () => {
    const acc = makeAcc({ rawMerged: 'content' });
    const captures: CapturedUpdate[] = [];
    const repository = createMockRepository(captures);
    const toolRounds = [{ calls: [{ id: 'tc1', name: 'tool', argumentsText: '{}', output: 'ok' }] }];
    const flush = buildStreamFlush(acc, {
      assistantId: 'a1',
      sessionId: 's1',
      fallbackMessageId: 'msg-fb',
      modelLabel: 'M',
      toolRounds
    }, repository, makeStrings());

    flush(true);
    assert.ok(captures[0].toolRounds);
  });
});

// ─── scheduleStreamFlush ────────────────────────────────────────────

describe('scheduleStreamFlush', () => {
  test('sets a timer when none exists', () => {
    const acc = createStreamAccumulator();
    scheduleStreamFlush(acc, () => {});
    assert.ok(acc.flushTimer !== undefined);
    clearStreamFlush(acc);
  });

  test('does not replace existing timer (re-entrant protection)', () => {
    const acc = createStreamAccumulator();
    scheduleStreamFlush(acc, () => {});
    const firstTimer = acc.flushTimer;
    scheduleStreamFlush(acc, () => {});
    assert.equal(acc.flushTimer, firstTimer);
    clearStreamFlush(acc);
  });

  test('timer fires and calls flush when data changed', (_t, done) => {
    const acc = createStreamAccumulator();
    acc.rawMerged = 'new data';
    let flushCalled = false;
    scheduleStreamFlush(acc, (persist) => {
      flushCalled = true;
      assert.equal(persist, false);
    });
    setTimeout(() => {
      assert.equal(flushCalled, true);
      assert.equal(acc.flushTimer, undefined);
      done();
    }, STREAM_FLUSH_INTERVAL_MS + 50);
  });

  test('timer fires but does not call flush when data unchanged', (_t, done) => {
    const acc = createStreamAccumulator();
    acc.rawMerged = 'data';
    acc.rawPersisted = 'data';
    let flushCalled = false;
    scheduleStreamFlush(acc, () => { flushCalled = true; });
    setTimeout(() => {
      assert.equal(flushCalled, false);
      assert.equal(acc.flushTimer, undefined);
      done();
    }, STREAM_FLUSH_INTERVAL_MS + 50);
  });
});

// ─── clearStreamFlush ───────────────────────────────────────────────

describe('clearStreamFlush', () => {
  test('cancels pending timer', () => {
    const acc = createStreamAccumulator();
    scheduleStreamFlush(acc, () => {});
    assert.ok(acc.flushTimer !== undefined);
    clearStreamFlush(acc);
    assert.equal(acc.flushTimer, undefined);
  });

  test('no-ops when no timer exists', () => {
    const acc = createStreamAccumulator();
    clearStreamFlush(acc);
    assert.equal(acc.flushTimer, undefined);
  });
});

// ─── buildStreamCallbacks ───────────────────────────────────────────

describe('buildStreamCallbacks', () => {
  test('onDelta appends to rawMerged and schedules flush', () => {
    const acc = createStreamAccumulator();
    const { onDelta } = buildStreamCallbacks(acc, () => {});
    onDelta('hello ');
    onDelta('world');
    assert.equal(acc.rawMerged, 'hello world');
    clearStreamFlush(acc);
  });

  test('onReasoningDelta appends to reasoningMerged and schedules flush', () => {
    const acc = createStreamAccumulator();
    const { onReasoningDelta } = buildStreamCallbacks(acc, () => {});
    onReasoningDelta('thinking ');
    onReasoningDelta('more');
    assert.equal(acc.reasoningMerged, 'thinking more');
    clearStreamFlush(acc);
  });

  test('onDone clears timer and calls flush with persist=true', () => {
    const acc = createStreamAccumulator();
    acc.rawMerged = 'final content';
    const flushCalls: boolean[] = [];
    const { onDone } = buildStreamCallbacks(acc, (persist) => { flushCalls.push(persist); });
    onDone();
    assert.equal(acc.flushTimer, undefined);
    assert.deepEqual(flushCalls, [true]);
  });

  test('full flow: onDelta then onDone', () => {
    const acc = createStreamAccumulator();
    const flushCalls: boolean[] = [];
    const { onDelta, onDone } = buildStreamCallbacks(acc, (persist) => { flushCalls.push(persist); });

    onDelta('chunk1');
    onDelta(' chunk2');
    assert.equal(acc.rawMerged, 'chunk1 chunk2');
    assert.ok(acc.flushTimer !== undefined);

    onDone();
    assert.equal(acc.flushTimer, undefined);
    assert.deepEqual(flushCalls, [true]);
  });
});

// ─── buildStreamErrorContent ────────────────────────────────────────

describe('buildStreamErrorContent', () => {
  test('returns error message when no accumulated content', () => {
    const acc = createStreamAccumulator();
    const result = buildStreamErrorContent(acc, 'Error occurred');
    assert.equal(result.content, 'Error occurred');
    assert.equal(result.reasoning, undefined);
  });

  test('appends error to partial content', () => {
    const acc = createStreamAccumulator();
    acc.rawMerged = 'Partial response here';
    const result = buildStreamErrorContent(acc, 'Stream interrupted');
    assert.equal(result.content, 'Partial response here\n\nStream interrupted');
  });

  test('strips whitespace from partial content', () => {
    const acc = createStreamAccumulator();
    acc.rawMerged = '   partial   ';
    const result = buildStreamErrorContent(acc, 'Error');
    assert.equal(result.content, 'partial\n\nError');
  });

  test('uses only error when partial is only whitespace', () => {
    const acc = createStreamAccumulator();
    acc.rawMerged = '   ';
    const result = buildStreamErrorContent(acc, 'Timeout');
    assert.equal(result.content, 'Timeout');
  });

  test('includes reasoning when present', () => {
    const acc = createStreamAccumulator();
    acc.rawMerged = '<think reasoning content</think actual content';
    acc.reasoningMerged = 'extra reasoning';
    const result = buildStreamErrorContent(acc, 'Failed');
    assert.ok(result.reasoning);
    assert.ok(result.reasoning!.length > 0);
  });

  test('omits reasoning when empty', () => {
    const acc = createStreamAccumulator();
    acc.rawMerged = 'some content';
    acc.reasoningMerged = '';
    const result = buildStreamErrorContent(acc, 'Error');
    assert.equal(result.reasoning, undefined);
  });
});
