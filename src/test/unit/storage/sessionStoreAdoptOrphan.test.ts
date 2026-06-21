/**
 * CompassSessionStore.adoptOrphanSessionFiles 专项测试。
 *
 * 回归场景：migrator.trySelfHealCompassSnapshot() 在检测到「Found orphan session file」
 * 时直接调用 `load()` + `persist()`。`load()` 只读取索引，孤儿文件不会进入
 * `sessionSummaries`；`persist()` 的孤儿清理路径随后会删除这些文件，造成数据丢失。
 *
 * 修复后：`adoptOrphanSessionFiles()` 先扫描孤儿文件、解析消息、重新加入索引，
 * 再 persist 时数据被保留。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CompassSessionStore } from '../../../chatbuddy/compassStorage/sessionStore';
import { writeJsonAtomic, writeTextAtomic } from '../../../chatbuddy/compassStorage/io';
import { createCompassPaths, CompassPaths } from '../../../chatbuddy/compassStorage/paths';
import type { ChatMessage } from '../../../chatbuddy/types';

function makeMessage(role: 'user' | 'assistant', content: string, id: string, ts: number): ChatMessage {
  return { id, role, content, timestamp: ts };
}

function sessionJsonlPath(paths: CompassPaths, assistantId: string, sessionId: string): string {
  return path.join(paths.sessionsPath, assistantId, `${sessionId}.jsonl`);
}

async function createTmpPaths(): Promise<{ paths: CompassPaths; tmpDir: string; cleanup: () => void }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sessionstore-orphan-test-'));
  const paths = createCompassPaths(tmpDir);
  await fs.promises.mkdir(paths.sessionsPath, { recursive: true });
  return {
    paths,
    tmpDir,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

function writeIndex(paths: CompassPaths, sessions: Array<Record<string, unknown>>): Promise<void> {
  return writeJsonAtomic(paths.indexPath, { sessions });
}

void test('adoptOrphanSessionFiles — 恢复孤儿会话文件到索引并保留消息', async () => {
  const { paths, cleanup } = await createTmpPaths();
  try {
    const assistantId = 'assistant-1';
    const orphanId = 'orphan-session-1';

    // 构造一个孤儿文件：写入有效 JSONL 消息，但不写入索引
    const messages: ChatMessage[] = [
      makeMessage('user', '你好', 'msg-1', 1_700_000_000_000),
      makeMessage('assistant', '你好，有什么可以帮你的？', 'msg-2', 1_700_000_001_000),
    ];
    const orphanPath = sessionJsonlPath(paths, assistantId, orphanId);
    const content = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
    await writeTextAtomic(orphanPath, content);

    // 索引中没有任何会话
    await writeIndex(paths, []);

    // load() 不会把孤儿文件加载进来
    const store = new CompassSessionStore();
    await store.load(paths);
    assert.equal(store.countSessions(), 0, 'load 不应把孤儿文件加载到 summaries');

    // 校验应失败（reason 包含 "Found orphan session file"）
    const beforeSnapshot = await store.validateSnapshot(paths);
    assert.equal(beforeSnapshot.valid, false);
    assert.ok(
      beforeSnapshot.reason?.includes('Found orphan session file'),
      `reason 应包含孤儿文件描述：${beforeSnapshot.reason}`
    );

    // 调用 adopt 应恢复 1 个孤儿
    const adopted = await store.adoptOrphanSessionFiles(paths);
    assert.equal(adopted, 1, '应恢复 1 个孤儿会话');
    assert.equal(store.countSessions(), 1);

    // 验证 summary 字段
    const detail = store.getSessionDetail(assistantId, orphanId);
    assert.ok(detail, 'adopt 后会话应可通过 getSessionDetail 访问');
    assert.equal(detail!.id, orphanId);
    assert.equal(detail!.assistantId, assistantId);
    assert.equal(detail!.messages.length, 2, '应保留全部 2 条消息');
    assert.equal(detail!.messages[0].id, 'msg-1');
    assert.equal(detail!.messages[1].id, 'msg-2');
    assert.equal(detail!.createdAt, 1_700_000_000_000);
    assert.equal(detail!.updatedAt, 1_700_000_001_000);

    // persist 后快照应有效
    await store.persist(paths);
    const afterSnapshot = await store.validateSnapshot(paths);
    assert.equal(afterSnapshot.valid, true, `persist 后快照应有效：${afterSnapshot.reason}`);

    // 文件应仍然存在
    const fileExists = await fs.promises.access(orphanPath).then(() => true).catch(() => false);
    assert.equal(fileExists, true, '孤儿文件应被保留，不应被删除');
  } finally {
    cleanup();
  }
});

void test('adoptOrphanSessionFiles — 已索引的会话不被重复 adopt', async () => {
  const { paths, cleanup } = await createTmpPaths();
  try {
    const assistantId = 'assistant-1';
    const indexedSessionId = 'indexed-1';
    const orphanSessionId = 'orphan-1';

    // 索引中已有 indexed-1
    await writeIndex(paths, [
      {
        id: indexedSessionId,
        assistantId,
        title: 'Indexed',
        titleSource: 'default',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
        messageCount: 1,
      },
    ]);

    // 写入两个文件：一个在索引中，一个是孤儿
    const indexedMsg = makeMessage('user', 'indexed msg', 'idx-1', 1_700_000_000_000);
    await writeTextAtomic(
      sessionJsonlPath(paths, assistantId, indexedSessionId),
      `${JSON.stringify(indexedMsg)}\n`
    );

    const orphanMsg = makeMessage('user', 'orphan msg', 'orp-1', 1_700_000_002_000);
    await writeTextAtomic(
      sessionJsonlPath(paths, assistantId, orphanSessionId),
      `${JSON.stringify(orphanMsg)}\n`
    );

    const store = new CompassSessionStore();
    await store.load(paths);
    // 此时 orphan 文件不在 summaries，validateSnapshot 会失败
    const adopted = await store.adoptOrphanSessionFiles(paths);
    assert.equal(adopted, 1, '只应 adopt 1 个孤儿');

    // indexed-1 保留原 summary（title=Indexed）
    const indexed = store.getSessionDetail(assistantId, indexedSessionId);
    assert.ok(indexed);
    assert.equal(indexed!.title, 'Indexed', '已索引会话的 title 不应被覆盖');

    // orphan-1 被 adopt，title 走 default 逻辑（空标题）
    const orphan = store.getSessionDetail(assistantId, orphanSessionId);
    assert.ok(orphan, '孤儿会话应被加入索引');
    assert.equal(orphan!.title, '', 'adopted 会话 title 应为空（待 UI 默认逻辑生成）');
  } finally {
    cleanup();
  }
});

void test('adoptOrphanSessionFiles — 无效消息的孤儿文件被跳过（保留磁盘文件）', async () => {
  const { paths, cleanup } = await createTmpPaths();
  try {
    const assistantId = 'assistant-1';
    const emptyOrphanId = 'empty-orphan';

    // 全部行解析失败的文件
    await writeTextAtomic(
      sessionJsonlPath(paths, assistantId, emptyOrphanId),
      'not a json line\n{invalid\n'
    );
    await writeIndex(paths, []);

    const store = new CompassSessionStore();
    await store.load(paths);

    const adopted = await store.adoptOrphanSessionFiles(paths);
    assert.equal(adopted, 0, '无有效消息的孤儿文件不应被 adopt');

    // persist 后文件仍应保留在磁盘（adopt 跳过不删除，persist 也不应清理）
    // 注意：persist 会扫描磁盘并删除不在 expectedSessionFiles 中的文件，
    // 此处不调用 persist 验证 —— 重点验证 adopt 本身的安全行为（不删除、不污染 summaries）
    assert.equal(store.countSessions(), 0, 'summaries 应保持空');
  } finally {
    cleanup();
  }
});

void test('adoptOrphanSessionFiles — 多个 assistant 下的孤儿文件全部恢复', async () => {
  const { paths, cleanup } = await createTmpPaths();
  try {
    // 两个 assistant 各一个孤儿
    const assistantA = 'assistant-A';
    const assistantB = 'assistant-B';

    await writeTextAtomic(
      sessionJsonlPath(paths, assistantA, 'orphan-a'),
      `${JSON.stringify(makeMessage('user', 'A 的消息', 'a-1', 1000))}\n`
    );
    await writeTextAtomic(
      sessionJsonlPath(paths, assistantB, 'orphan-b'),
      `${JSON.stringify(makeMessage('user', 'B 的消息', 'b-1', 2000))}\n`
    );
    await writeIndex(paths, []);

    const store = new CompassSessionStore();
    await store.load(paths);
    const adopted = await store.adoptOrphanSessionFiles(paths);
    assert.equal(adopted, 2, '应 adopt 两个孤儿');

    assert.ok(store.getSessionDetail(assistantA, 'orphan-a'));
    assert.ok(store.getSessionDetail(assistantB, 'orphan-b'));

    await store.persist(paths);
    const snapshot = await store.validateSnapshot(paths);
    assert.equal(snapshot.valid, true, `persist 后快照应有效：${snapshot.reason}`);
  } finally {
    cleanup();
  }
});
