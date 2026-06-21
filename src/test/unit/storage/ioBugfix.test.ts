/**
 * Compass I/O 模块错误处理回归测试（Bug 2 + Bug 3 修复）。
 *
 * Bug 2: fileExists() 不再吞掉非 ENOENT 错误（如 EACCES 权限不足）。
 * Bug 3: readJsonFile() 解析失败时抛出（含 filePath），区分「文件不存在」与「文件损坏」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

import { fileExists, readJsonFile, readJsonFileSafe } from '../../../chatbuddy/compassStorage/io';

async function createTmpFile(content: string = ''): Promise<{ filePath: string; cleanup: () => void }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'io-test-'));
  const filePath = path.join(tmpDir, 'test.json');
  if (content) {
    await fs.promises.writeFile(filePath, content, 'utf-8');
  }
  return {
    filePath,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

// ── Bug 2: fileExists ──────────────────────────────────────────────────────

void test('fileExists — 文件存在返回 true', async () => {
  const { filePath, cleanup } = await createTmpFile('{}');
  try {
    const exists = await fileExists(filePath);
    assert.equal(exists, true);
  } finally {
    cleanup();
  }
});

void test('fileExists — ENOENT 返回 false（文件确实不存在）', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'io-test-'));
  const cleanup = () => fs.rmSync(tmpDir, { recursive: true, force: true });
  try {
    const exists = await fileExists(path.join(tmpDir, 'nonexistent.json'));
    assert.equal(exists, false, '不存在的文件应返回 false');
  } finally {
    cleanup();
  }
});

void test('fileExists — 非 ENOENT 错误（如 ENOTDIR）向上抛出', async () => {
  // ENOTDIR: 路径中某段是文件而非目录，触发非 ENOENT 错误
  const { filePath, cleanup } = await createTmpFile('not-a-dir');
  try {
    const invalidPath = `${filePath}/sub/file.json`;
    await assert.rejects(
      () => fileExists(invalidPath),
      (err: NodeJS.ErrnoException) => err.code === 'ENOTDIR',
      '非 ENOENT 错误应向上抛出而非返回 false'
    );
  } finally {
    cleanup();
  }
});

// ── Bug 3: readJsonFile ────────────────────────────────────────────────────

void test('readJsonFile — 文件不存在返回 undefined（合法降级）', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'io-test-'));
  const cleanup = () => fs.rmSync(tmpDir, { recursive: true, force: true });
  try {
    const result = await readJsonFile(path.join(tmpDir, 'missing.json'));
    assert.equal(result, undefined, '文件不存在应返回 undefined');
  } finally {
    cleanup();
  }
});

void test('readJsonFile — 空文件返回 undefined', async () => {
  const { filePath, cleanup } = await createTmpFile('   ');
  try {
    const result = await readJsonFile(filePath);
    assert.equal(result, undefined, '空文件应返回 undefined');
  } finally {
    cleanup();
  }
});

void test('readJsonFile — 有效 JSON 正常解析', async () => {
  const { filePath, cleanup } = await createTmpFile(JSON.stringify({ key: 'value', n: 42 }));
  try {
    const result = await readJsonFile<{ key: string; n: number }>(filePath);
    assert.deepEqual(result, { key: 'value', n: 42 });
  } finally {
    cleanup();
  }
});

void test('readJsonFile — 损坏 JSON 抛出错误（含 filePath）', async () => {
  const { filePath, cleanup } = await createTmpFile('{ broken json,,, }');
  try {
    await assert.rejects(
      () => readJsonFile(filePath),
      (err: Error) => {
        assert.ok(err.message.includes(filePath), '错误消息应包含 filePath 便于定位');
        assert.ok(err.message.includes('Failed to parse JSON'), '应明确是解析失败');
        return true;
      },
      '损坏 JSON 应抛出而非返回 undefined'
    );
  } finally {
    cleanup();
  }
});

void test('readJsonFileSafe — 损坏 JSON 降级为 undefined（不抛出）', async () => {
  const { filePath, cleanup } = await createTmpFile('{ broken json,,, }');
  try {
    const result = await readJsonFileSafe(filePath);
    assert.equal(result, undefined, 'readJsonFileSafe 应将损坏降级为 undefined');
  } finally {
    cleanup();
  }
});

void test('readJsonFileSafe — 文件不存在仍返回 undefined', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'io-test-'));
  const cleanup = () => fs.rmSync(tmpDir, { recursive: true, force: true });
  try {
    const result = await readJsonFileSafe(path.join(tmpDir, 'missing.json'));
    assert.equal(result, undefined);
  } finally {
    cleanup();
  }
});
