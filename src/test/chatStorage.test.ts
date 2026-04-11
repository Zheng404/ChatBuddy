import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

import { ChatStorage } from '../chatbuddy/chatStorage';
import type { ChatMessage, ChatSessionDetail } from '../chatbuddy/types';

// Use a temp directory for each test to avoid cross-test contamination
async function createStorage(): Promise<{ storage: ChatStorage; cleanup: () => void }> {
  const storage = new ChatStorage();
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chatbuddy-test-'));
  await storage.initialize(tmpDir);
  return {
    storage,
    cleanup: () => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };
}

function makeMessage(role: 'user' | 'assistant', content: string, id?: string): ChatMessage {
  return {
    id: id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: Date.now()
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
    messages: messages ?? []
  };
}

// ─── Initialize ──────────────────────────────────────────────────────────────

test('initialize creates an empty storage', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    assert.equal(storage.hasAnySession(), false);
    assert.equal(storage.countSessions(), 0);
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── Insert & Query ──────────────────────────────────────────────────────────

test('insertSession and listSessionsByAssistant', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const session = makeSession('a1', 's1');
    storage.insertSession(session, true);

    assert.equal(storage.hasAnySession(), true);
    assert.equal(storage.countSessions(), 1);

    const summaries = storage.listSessionsByAssistant('a1');
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].id, 's1');
    assert.equal(summaries[0].assistantId, 'a1');
  } finally {
    await storage.close();
    cleanup();
  }
});

test('getSessionDetailById returns inserted session', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const session = makeSession('a1', 's1', [makeMessage('user', 'Hello')]);
    storage.insertSession(session, true);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.id, 's1');
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0].content, 'Hello');
  } finally {
    await storage.close();
    cleanup();
  }
});

test('getSessionDetailById returns undefined for unknown session', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    assert.equal(storage.getSessionDetailById('nonexistent'), undefined);
  } finally {
    await storage.close();
    cleanup();
  }
});

test('sessionExists returns correct boolean', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const session = makeSession('a1', 's1');
    storage.insertSession(session, true);

    assert.equal(storage.sessionExists('a1', 's1'), true);
    assert.equal(storage.sessionExists('a1', 's999'), false);
    assert.equal(storage.sessionExists('other', 's1'), false);
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── Append Message ──────────────────────────────────────────────────────────

test('appendMessage adds a message to existing session', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const session = makeSession('a1', 's1');
    storage.insertSession(session, true);

    const msg = makeMessage('user', 'Hello');
    storage.appendMessage('a1', 's1', msg, Date.now(), true);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0].content, 'Hello');
  } finally {
    await storage.close();
    cleanup();
  }
});

test('appendMessage returns false for non-existent session', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const result = storage.appendMessage('a1', 's1', makeMessage('user', 'test'), Date.now());
    assert.equal(result, false);
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── Rename ──────────────────────────────────────────────────────────────────

test('renameSession updates the title', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const session = makeSession('a1', 's1');
    storage.insertSession(session, true);

    const renamed = storage.renameSession('a1', 's1', 'New Title', 'custom', Date.now());
    assert.equal(renamed, true);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.title, 'New Title');
    assert.equal(detail.titleSource, 'custom');
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── Delete ──────────────────────────────────────────────────────────────────

test('deleteSession removes a session', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    storage.insertSession(makeSession('a1', 's1'), true);
    storage.insertSession(makeSession('a1', 's2'), true);
    assert.equal(storage.countSessions(), 2);

    storage.deleteSession('a1', 's1', true);
    assert.equal(storage.countSessions(), 1);
    assert.equal(storage.sessionExists('a1', 's1'), false);
    assert.equal(storage.sessionExists('a1', 's2'), true);
  } finally {
    await storage.close();
    cleanup();
  }
});

test('clearSessionsForAssistant removes all sessions for an assistant', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    storage.insertSession(makeSession('a1', 's1'), true);
    storage.insertSession(makeSession('a1', 's2'), true);
    storage.insertSession(makeSession('a2', 's3'), true);

    const removed = storage.clearSessionsForAssistant('a1', true);
    assert.equal(removed, 2);
    assert.equal(storage.countSessions(), 1);
    assert.equal(storage.sessionExists('a2', 's3'), true);
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── Truncate Messages ──────────────────────────────────────────────────────

test('truncateMessages keeps only the first N messages', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const msgs = [
      makeMessage('user', 'msg1', 'm1'),
      makeMessage('assistant', 'reply1', 'm2'),
      makeMessage('user', 'msg2', 'm3'),
      makeMessage('assistant', 'reply2', 'm4')
    ];
    const session = makeSession('a1', 's1', msgs);
    storage.insertSession(session, true);

    storage.truncateMessages('a1', 's1', 2, Date.now(), true);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[0].id, 'm1');
    assert.equal(detail.messages[1].id, 'm2');
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── Delete Message ──────────────────────────────────────────────────────────

test('deleteMessage removes a specific message', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const msgs = [
      makeMessage('user', 'msg1', 'm1'),
      makeMessage('assistant', 'reply1', 'm2'),
      makeMessage('user', 'msg2', 'm3')
    ];
    const session = makeSession('a1', 's1', msgs);
    storage.insertSession(session, true);

    storage.deleteMessage('a1', 's1', 'm2', Date.now(), true);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[0].id, 'm1');
    assert.equal(detail.messages[1].id, 'm3');
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── Clear Session Messages ──────────────────────────────────────────────────

test('clearSessionMessages removes all messages from a session', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const msgs = [makeMessage('user', 'msg1'), makeMessage('assistant', 'reply1')];
    const session = makeSession('a1', 's1', msgs);
    storage.insertSession(session, true);

    storage.clearSessionMessages('a1', 's1', Date.now(), true);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.messages.length, 0);
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── KV Store ────────────────────────────────────────────────────────────────

test('KV store set and get', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    storage.setKv('test.key', 'hello', true);
    assert.equal(storage.getKv('test.key'), 'hello');
    assert.equal(storage.getKv('nonexistent'), undefined);
  } finally {
    await storage.close();
    cleanup();
  }
});

test('KV store overwrites existing value', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    storage.setKv('test.key', 'v1', true);
    storage.setKv('test.key', 'v2', true);
    assert.equal(storage.getKv('test.key'), 'v2');
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── Update Message ──────────────────────────────────────────────────────────

test('updateMessage changes message content', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const msgs = [makeMessage('assistant', 'original', 'm1')];
    const session = makeSession('a1', 's1', msgs);
    storage.insertSession(session, true);

    storage.updateMessage('a1', 's1', 'm1', 'updated', Date.now(), true);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.messages[0].content, 'updated');
  } finally {
    await storage.close();
    cleanup();
  }
});
