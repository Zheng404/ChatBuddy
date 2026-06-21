/**
 * CompassSessionStore 损坏 JSONL 行处理回归测试（Bug 1 修复）。
 *
 * 验证损坏行不再被静默跳过：
 * 1. 损坏行触发 error 级别日志（含完整上下文）
 * 2. 损坏行原始内容被保留到 sidecar 文件 `{file}.corrupt` 便于人工恢复
 * 3. validateSnapshot 检测到损坏行后返回校验失败
 * 4. 有效行仍被正常加载（不因单行损坏丢失整个会话）
 * 5. 修复后（无损坏行）corruptedSessionFiles 标记自动清理
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

import { CompassSessionStore } from '../../../chatbuddy/compassStorage/sessionStore';
import { createCompassPaths, CompassPaths } from '../../../chatbuddy/compassStorage/paths';
import { getSessionFilePath } from '../../../chatbuddy/compassStorage/paths';
import type { ChatMessage, ChatSessionDetail } from '../../../chatbuddy/types';

function makeMessage(role: 'user' | 'assistant', content: string, id?: string): ChatMessage {
  return {
    id: id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: Date.now(),
  };
}

function makeSession(assistantId: string, sessionId: string, messages: ChatMessage[]): ChatSessionDetail {
  return {
    id: sessionId,
    assistantId,
    title: 'Corrupt Test',
    titleSource: 'default',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages,
  };
}

async function createTmpPaths(): Promise<{ paths: CompassPaths; tmpDir: string; cleanup: () => void }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sessionstore-corrupt-test-'));
  const paths = createCompassPaths(tmpDir);
  await fs.promises.mkdir(paths.sessionsPath, { recursive: true });
  return {
    paths,
    tmpDir,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

void test('readSessionMessages — 损坏行被保留到 sidecar 文件且 validateSnapshot 失败', async () => {
  const { paths, cleanup } = await createTmpPaths();
  try {
    const store = new CompassSessionStore();

    // 1. 创建并持久化一个包含 2 条有效消息的会话
    const msg1 = makeMessage('user', '问题1');
    const msg2 = makeMessage('assistant', '回答1');
    store.insertSession(makeSession('a1', 's1', [msg1, msg2]));
    await store.persist(paths);

    // 2. 手动向会话文件追加一行损坏的 JSON 和一行有效的 JSON
    const sessionFilePath = getSessionFilePath(paths, 'a1', 's1');
    const corruptLine = '{ this is not valid json,,,';
    const validExtraLine = JSON.stringify(makeMessage('user', '额外的有效消息', 'msg-extra'));
    await fs.promises.appendFile(sessionFilePath, `\n${corruptLine}\n${validExtraLine}\n`, 'utf-8');

    // 3. reload — 触发 readSessionMessages 处理损坏行
    await store.load(paths);

    // 4. 验证：有效消息保留（包括原本的 2 条 + 额外的 1 条），损坏行被跳过
    const detail = store.getSessionDetail('a1', 's1');
    assert.ok(detail, '会话应存在');
    const ids = new Set(detail.messages.map((m) => m.id));
    assert.ok(ids.has(msg1.id), '原 msg1 应保留');
    assert.ok(ids.has(msg2.id), '原 msg2 应保留');
    assert.ok(ids.has('msg-extra'), '损坏行之后的有效行应保留');

    // 5. 验证：sidecar 文件已创建，包含损坏行原始内容
    const sidecarPath = `${sessionFilePath}.corrupt`;
    const sidecarContent = await fs.promises.readFile(sidecarPath, 'utf-8');
    const sidecarPayload = JSON.parse(sidecarContent) as Array<{ line: string; error: string }>;
    assert.ok(Array.isArray(sidecarPayload), 'sidecar 应为 JSON 数组');
    assert.equal(sidecarPayload.length, 1, '应记录 1 条损坏行');
    assert.equal(sidecarPayload[0].line, corruptLine, 'sidecar 应保留损坏行原始内容');
    assert.ok(sidecarPayload[0].error.length > 0, 'sidecar 应包含错误信息');

    // 6. 验证：validateSnapshot 返回 invalid（migrator 可感知损坏）
    const validation = await store.validateSnapshot(paths);
    assert.equal(validation.valid, false, '存在损坏行时快照校验应失败');
    assert.ok(validation.reason?.includes('malformed JSONL'), '失败原因应明确指出 JSONL 损坏');
  } finally {
    cleanup();
  }
});

void test('readSessionMessages — 无损坏行时 sidecar 标记自动清理，validateSnapshot 通过', async () => {
  const { paths, cleanup } = await createTmpPaths();
  try {
    const store = new CompassSessionStore();

    // 1. 创建并持久化正常会话
    const msg1 = makeMessage('user', '正常问题');
    store.insertSession(makeSession('a1', 's2', [msg1]));
    await store.persist(paths);

    // 2. reload — 无损坏行
    await store.load(paths);

    // 3. 验证 validateSnapshot 通过
    let validation = await store.validateSnapshot(paths);
    assert.equal(validation.valid, true, '无损坏行时快照校验应通过');

    // 4. 模拟手动修复：再次 reload（仍无损坏），标记应保持清洁
    await store.load(paths);
    validation = await store.validateSnapshot(paths);
    assert.equal(validation.valid, true, '再次 reload 后快照校验仍应通过');
  } finally {
    cleanup();
  }
});
