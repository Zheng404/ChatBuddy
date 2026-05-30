/**
 * CompassSessionStore search index tests.
 *
 * 验证倒排搜索索引的正确性：
 * - 单 token 搜索
 * - 多 token 搜索（AND 逻辑）
 * - 无结果搜索
 * - 追加消息后索引维护
 * - 删除会话后索引维护
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { CompassSessionStore } from '../chatbuddy/compassStorage/sessionStore';
import type { ChatMessage, ChatSessionDetail } from '../chatbuddy/types';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeMessage(role: 'user' | 'assistant', content: string, id?: string): ChatMessage {
  return {
    id: id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: Date.now(),
  };
}

function makeSession(assistantId: string, sessionId?: string, messages?: ChatMessage[]): ChatSessionDetail {
  return {
    id: sessionId ?? `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    assistantId,
    title: 'Test Session',
    titleSource: 'default',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: messages ?? [],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

void test('searchSessionIdsByContent — single token search', () => {
  const store = new CompassSessionStore();

  const msg1 = makeMessage('user', 'Hello world, this is a test message');
  const msg2 = makeMessage('assistant', 'Sure, I can help with testing');
  store.insertSession(makeSession('a1', 's1', [msg1, msg2]));

  const msg3 = makeMessage('user', 'Goodbye world');
  store.insertSession(makeSession('a1', 's2', [msg3]));

  const msg4 = makeMessage('user', 'No match here');
  store.insertSession(makeSession('a2', 's3', [msg4]));

  // Search for "world" — should match s1 and s2 (both have "world")
  const result1 = store.searchSessionIdsByContent('a1', 'world');
  assert.equal(result1.length, 2);
  assert.ok(result1.includes('s1'));
  assert.ok(result1.includes('s2'));

  // Search for "testing" — should match only s1
  const result2 = store.searchSessionIdsByContent('a1', 'testing');
  assert.equal(result2.length, 1);
  assert.ok(result2.includes('s1'));

  // Search for "world" with a2 — should not match s3 (a2 session has "No match here")
  const result3 = store.searchSessionIdsByContent('a2', 'world');
  assert.equal(result3.length, 0);
});

void test('searchSessionIdsByContent — multi-token search (AND logic)', () => {
  const store = new CompassSessionStore();

  const msg1 = makeMessage('user', 'Hello world from the test environment');
  store.insertSession(makeSession('a1', 's1', [msg1]));

  const msg2 = makeMessage('user', 'Hello there');
  store.insertSession(makeSession('a1', 's2', [msg2]));

  const msg3 = makeMessage('user', 'World peace');
  store.insertSession(makeSession('a1', 's3', [msg3]));

  // Search for "hello world" — should match only s1 (has both tokens)
  const result = store.searchSessionIdsByContent('a1', 'hello world');
  assert.equal(result.length, 1);
  assert.ok(result.includes('s1'));
});

void test('searchSessionIdsByContent — no results', () => {
  const store = new CompassSessionStore();

  const msg1 = makeMessage('user', 'Hello world');
  store.insertSession(makeSession('a1', 's1', [msg1]));

  const result = store.searchSessionIdsByContent('a1', 'nonexistent');
  assert.equal(result.length, 0);
});

void test('searchSessionIdsByContent — empty keyword', () => {
  const store = new CompassSessionStore();

  const msg1 = makeMessage('user', 'Hello world');
  store.insertSession(makeSession('a1', 's1', [msg1]));

  assert.equal(store.searchSessionIdsByContent('a1', '').length, 0);
  assert.equal(store.searchSessionIdsByContent('a1', '   ').length, 0);
});

void test('searchSessionIdsByContent — short keyword fallback to linear scan', () => {
  const store = new CompassSessionStore();

  const msg1 = makeMessage('user', 'Hello world');
  store.insertSession(makeSession('a1', 's1', [msg1]));

  // Single character should fall back to linear scan
  // 'x' does not exist in the message
  const result = store.searchSessionIdsByContent('a1', 'x');
  assert.equal(result.length, 0);

  // Single character 'e' falls back to linear scan and matches substring in "Hello"
  const result2 = store.searchSessionIdsByContent('a1', 'e');
  assert.equal(result2.length, 1);
  assert.ok(result2.includes('s1'));
});

void test('searchSessionIdsByContent — case insensitive', () => {
  const store = new CompassSessionStore();

  const msg1 = makeMessage('user', 'HELLO World');
  store.insertSession(makeSession('a1', 's1', [msg1]));

  const result = store.searchSessionIdsByContent('a1', 'hello');
  assert.equal(result.length, 1);
  assert.ok(result.includes('s1'));

  const result2 = store.searchSessionIdsByContent('a1', 'WORLD');
  assert.equal(result2.length, 1);
  assert.ok(result2.includes('s1'));
});

void test('searchSessionIdsByContent — index maintained after appendMessage', () => {
  const store = new CompassSessionStore();

  const msg1 = makeMessage('user', 'Initial message');
  store.insertSession(makeSession('a1', 's1', [msg1]));

  // Before append: "newcontent" should not match
  const before = store.searchSessionIdsByContent('a1', 'newcontent');
  assert.equal(before.length, 0);

  // Append a new message
  const msg2 = makeMessage('assistant', 'Here is some newcontent for you');
  store.appendMessage('a1', 's1', msg2, Date.now());

  // After append: "newcontent" should match
  const after = store.searchSessionIdsByContent('a1', 'newcontent');
  assert.equal(after.length, 1);
  assert.ok(after.includes('s1'));
});

void test('searchSessionIdsByContent — index maintained after deleteSession', () => {
  const store = new CompassSessionStore();

  const msg1 = makeMessage('user', 'Hello world from session one');
  store.insertSession(makeSession('a1', 's1', [msg1]));

  const msg2 = makeMessage('user', 'Hello world from session two');
  store.insertSession(makeSession('a1', 's2', [msg2]));

  // Both should match "world"
  const before = store.searchSessionIdsByContent('a1', 'world');
  assert.equal(before.length, 2);

  // Delete s1
  store.deleteSession('a1', 's1');

  // Only s2 should match now
  const after = store.searchSessionIdsByContent('a1', 'world');
  assert.equal(after.length, 1);
  assert.ok(after.includes('s2'));
});

void test('searchSessionIdsByContent — index maintained after updateMessage', () => {
  const store = new CompassSessionStore();

  const msg1 = makeMessage('user', 'Old content here');
  store.insertSession(makeSession('a1', 's1', [msg1]));

  // "old" should match
  const before = store.searchSessionIdsByContent('a1', 'old');
  assert.equal(before.length, 1);

  // Update the message
  store.updateMessage('a1', 's1', msg1.id, 'Updated content here', Date.now());

  // "old" should no longer match, "updated" should match
  const afterOld = store.searchSessionIdsByContent('a1', 'old');
  assert.equal(afterOld.length, 0);

  const afterUpdated = store.searchSessionIdsByContent('a1', 'updated');
  assert.equal(afterUpdated.length, 1);
  assert.ok(afterUpdated.includes('s1'));
});

void test('searchSessionIdsByContent — index maintained after clearSessionMessages', () => {
  const store = new CompassSessionStore();

  const msg1 = makeMessage('user', 'Hello world');
  store.insertSession(makeSession('a1', 's1', [msg1]));

  // "world" should match
  const before = store.searchSessionIdsByContent('a1', 'world');
  assert.equal(before.length, 1);

  // Clear all messages
  store.clearSessionMessages('a1', 's1', Date.now());

  // "world" should no longer match
  const after = store.searchSessionIdsByContent('a1', 'world');
  assert.equal(after.length, 0);
});

void test('searchSessionIdsByContent — index maintained after truncateMessages', () => {
  const store = new CompassSessionStore();

  const msg1 = makeMessage('user', 'First message');
  const msg2 = makeMessage('assistant', 'Second message');
  const msg3 = makeMessage('user', 'Third message');
  store.insertSession(makeSession('a1', 's1', [msg1, msg2, msg3]));

  // "third" should match
  const before = store.searchSessionIdsByContent('a1', 'third');
  assert.equal(before.length, 1);

  // Truncate to keep only 1 message
  store.truncateMessages('a1', 's1', 1, Date.now());

  // "third" should no longer match, "first" should still match
  const afterThird = store.searchSessionIdsByContent('a1', 'third');
  assert.equal(afterThird.length, 0);

  const afterFirst = store.searchSessionIdsByContent('a1', 'first');
  assert.equal(afterFirst.length, 1);
  assert.ok(afterFirst.includes('s1'));
});

void test('searchSessionIdsByContent — index maintained after clearSessionsForAssistant', () => {
  const store = new CompassSessionStore();

  const msg1 = makeMessage('user', 'Hello world');
  store.insertSession(makeSession('a1', 's1', [msg1]));

  const msg2 = makeMessage('user', 'Goodbye world');
  store.insertSession(makeSession('a2', 's2', [msg2]));

  // Both should match "world"
  const before = store.searchSessionIdsByContent('a1', 'world');
  assert.equal(before.length, 1);

  // Clear all sessions for a1
  store.clearSessionsForAssistant('a1');

  // a1 sessions should no longer match
  const afterA1 = store.searchSessionIdsByContent('a1', 'world');
  assert.equal(afterA1.length, 0);

  // a2 sessions should still match
  const afterA2 = store.searchSessionIdsByContent('a2', 'world');
  assert.equal(afterA2.length, 1);
  assert.ok(afterA2.includes('s2'));
});

void test('searchSessionIdsByContent — punctuation splitting', () => {
  const store = new CompassSessionStore();

  const msg1 = makeMessage('user', 'Hello, world! How are you?');
  store.insertSession(makeSession('a1', 's1', [msg1]));

  // Punctuation should be stripped during tokenization
  const result = store.searchSessionIdsByContent('a1', 'world');
  assert.equal(result.length, 1);
  assert.ok(result.includes('s1'));

  const result2 = store.searchSessionIdsByContent('a1', 'hello');
  assert.equal(result2.length, 1);
  assert.ok(result2.includes('s1'));
});
