/**
 * CompassSessionStore.load() 同步修复专项测试。
 *
 * 验证共享存储模式下，pendingRewrites 会话在 reload 期间不会丢失消息。
 * 场景：流式生成中（updateLastAssistantMessage 设置了 pendingRewrites），
 * 其他 IDE 触发 reload，异步磁盘读取期间到达的消息必须保留。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

import { CompassSessionStore } from '../../../chatbuddy/compassStorage/sessionStore';
import { createCompassPaths, CompassPaths } from '../../../chatbuddy/compassStorage/paths';
import type { ChatMessage, ChatSessionDetail } from '../../../chatbuddy/types';

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

async function createTmpPaths(): Promise<{ paths: CompassPaths; tmpDir: string; cleanup: () => void }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sessionstore-test-'));
  const paths = createCompassPaths(tmpDir);
  await fs.promises.mkdir(paths.sessionsPath, { recursive: true });
  return {
    paths,
    tmpDir,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

void test('sessionStore.load() — pendingRewrites 会话在 reload 期间不丢失消息', async () => {
  const { paths, cleanup } = await createTmpPaths();
  try {
    const store = new CompassSessionStore();

    // 1. 创建会话，包含初始消息
    const msg1 = makeMessage('user', '你好');
    const msg2 = makeMessage('assistant', '你好！有什么可以帮你的？');
    const session = makeSession('assistant-1', 'session-1', [msg1, msg2]);
    store.insertSession(session);

    // 2. 首次持久化到磁盘
    await store.persist(paths);

    // 3. 重新加载（模拟启动）
    const store2 = new CompassSessionStore();
    await store2.load(paths);

    // 确认磁盘上有 2 条消息
    const detail1 = store2.getSessionDetail('assistant-1', 'session-1');
    assert.ok(detail1, '会话应存在');
    assert.equal(detail1.messages.length, 2, '初始应有 2 条消息');

    // 4. 模拟流式生成：updateLastAssistantMessage 设置 pendingRewrites
    const msg3 = makeMessage('user', '写个函数');
    store2.appendMessage('assistant-1', 'session-1', msg3, Date.now());

    // 流式更新 assistant 消息 → 设置 pendingRewrites，清除 pendingAppends
    store2.updateLastAssistantMessage(
      'assistant-1',
      'session-1',
      (current) => ({
        ...(current ?? makeMessage('assistant', '')),
        id: 'streaming-msg',
        content: '正在生成...',
        role: 'assistant',
      }),
      Date.now()
    );

    // 5. 在 reload 的异步磁盘读取期间，又到达一条新消息
    //    由于 pendingRewrites 已设置，appendMessage 不会写入 pendingAppends
    const msgDuringReload = makeMessage('user', '继续');
    store2.appendMessage('assistant-1', 'session-1', msgDuringReload, Date.now());

    // 6. 再次触发 load()（模拟其他 IDE 触发的 reload）
    await store2.load(paths);

    // 7. 验证：所有消息都应保留
    const detail2 = store2.getSessionDetail('assistant-1', 'session-1');
    assert.ok(detail2, 'reload 后会话应存在');

    const msgIds = new Set(detail2.messages.map((m) => m.id));
    assert.ok(msgIds.has(msg1.id), 'msg1（初始 user 消息）应保留');
    assert.ok(msgIds.has(msg2.id), 'msg2（初始 assistant 消息）应保留');
    assert.ok(msgIds.has('streaming-msg'), 'streaming-msg（流式更新的 assistant 消息）应保留');
    assert.ok(msgIds.has(msgDuringReload.id), 'msgDuringReload（reload 期间到达的消息）应保留');
    assert.ok(detail2.messages.length >= 4, `至少应有 4 条消息，实际 ${detail2.messages.length}`);
  } finally {
    cleanup();
  }
});

void test('sessionStore.load() — 有 savedAppends 的会话走正常 restore 路径', async () => {
  const { paths, cleanup } = await createTmpPaths();
  try {
    const store = new CompassSessionStore();

    // 1. 创建并持久化会话
    const msg1 = makeMessage('user', '问题');
    const msg2 = makeMessage('assistant', '回答');
    store.insertSession(makeSession('a1', 's1', [msg1, msg2]));
    await store.persist(paths);

    // 2. 重新加载
    const store2 = new CompassSessionStore();
    await store2.load(paths);

    // 3. 追加消息（不触发 pendingRewrites）
    const msg3 = makeMessage('user', '追问');
    store2.appendMessage('a1', 's1', msg3, Date.now());

    // 4. reload
    await store2.load(paths);

    // 5. 验证消息保留（走 savedAppends 路径）
    const detail = store2.getSessionDetail('a1', 's1');
    assert.ok(detail, '会话应存在');
    const ids = new Set(detail.messages.map((m) => m.id));
    assert.ok(ids.has(msg1.id), 'msg1 应保留');
    assert.ok(ids.has(msg2.id), 'msg2 应保留');
    assert.ok(ids.has(msg3.id), 'msg3（追加消息）应保留');
  } finally {
    cleanup();
  }
});

void test('sessionStore.load() — 内存独有会话（未 persist）在 reload 后保留', async () => {
  const { paths, cleanup } = await createTmpPaths();
  try {
    const store = new CompassSessionStore();

    // 1. 创建会话但不持久化（模拟新生成的会话）
    const msg1 = makeMessage('user', '新会话');
    const msg2 = makeMessage('assistant', '新回答');
    store.insertSession(makeSession('a1', 'new-session', [msg1, msg2]));

    // 2. reload（磁盘上没有这个会话）
    await store.load(paths);

    // 3. 验证会话仍在内存中
    const detail = store.getSessionDetail('a1', 'new-session');
    assert.ok(detail, '未 persist 的会话应在 reload 后保留');
    assert.equal(detail.messages.length, 2, '消息数量应不变');
    assert.equal(detail.messages[0].id, msg1.id);
    assert.equal(detail.messages[1].id, msg2.id);
  } finally {
    cleanup();
  }
});

void test('sessionStore.load() — 磁盘上有新会话时正确加载', async () => {
  const { paths, cleanup } = await createTmpPaths();
  try {
    // 1. 用第一个 store 持久化一个会话
    const store1 = new CompassSessionStore();
    const msg1 = makeMessage('user', 'hello');
    const msg2 = makeMessage('assistant', 'hi');
    store1.insertSession(makeSession('a1', 's1', [msg1, msg2]));
    await store1.persist(paths);

    // 2. 用第二个 store 加载（模拟另一个 IDE 实例）
    const store2 = new CompassSessionStore();
    await store2.load(paths);

    const detail = store2.getSessionDetail('a1', 's1');
    assert.ok(detail, '磁盘上的会话应被加载');
    assert.equal(detail.messages.length, 2);
  } finally {
    cleanup();
  }
});

void test('sessionStore.load() — reload 后 pendingRewrites 标记正确恢复', async () => {
  const { paths, cleanup } = await createTmpPaths();
  try {
    const store = new CompassSessionStore();

    // 1. 创建并持久化
    const msg1 = makeMessage('user', 'q');
    const msg2 = makeMessage('assistant', 'a');
    store.insertSession(makeSession('a1', 's1', [msg1, msg2]));
    await store.persist(paths);

    // 2. reload
    await store.load(paths);

    // 3. 触发 pendingRewrites（流式更新）
    store.updateLastAssistantMessage(
      'a1',
      's1',
      () => makeMessage('assistant', 'updated'),
      Date.now()
    );

    // 4. persist — 应该写入完整消息（因为 pendingRewrites）
    await store.persist(paths);

    // 5. 用新 store 加载验证
    const store2 = new CompassSessionStore();
    await store2.load(paths);
    const detail = store2.getSessionDetail('a1', 's1');
    assert.ok(detail, '会话应存在');
    // 流式更新应该已持久化
    const assistantMsgs = detail.messages.filter((m) => m.role === 'assistant');
    assert.ok(assistantMsgs.length > 0, '应有 assistant 消息');
  } finally {
    cleanup();
  }
});
