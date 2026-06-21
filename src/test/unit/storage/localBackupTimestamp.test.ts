/**
 * localBackup 时间戳解析回归测试。
 *
 * 回归场景：`parseBackupTimestampFromFileName()` 返回无时区后缀的 ISO 字符串，
 * 不同 JS 引擎对「无时区 ISO 字符串」解析规则不一致（date-only 走 UTC，
 * date-time 走本地时间），导致 `cleanExpiredBackups()` / `hasRecentBackup()`
 * 中 `new Date(createdAt).getTime()` 在某些环境下产生 ±N 小时偏移，进而误删
 * 未过期备份或跳过应清理的备份。
 *
 * 修复后：`parseBackupTimestampFromFileName()` 返回带 `Z` 后缀的 UTC ISO 字符串，
 * `new Date(createdAt).getTime()` 精确还原本地时间分量对应的绝对时间点。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { listLocalBackups } from '../../../chatbuddy/localBackup';

const BACKUP_FILE_PREFIX = 'chatbuddy-backup-';
const BACKUP_FILE_EXTENSION = '.zip';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 复刻 buildTimestampedFileName 的本地时间分量生成逻辑 */
function buildFileNameFromLocalDate(local: Date): string {
  const stem =
    `${BACKUP_FILE_PREFIX}${local.getFullYear()}` +
    `${pad(local.getMonth() + 1)}${pad(local.getDate())}-` +
    `${pad(local.getHours())}${pad(local.getMinutes())}${pad(local.getSeconds())}` +
    BACKUP_FILE_EXTENSION;
  return stem;
}

async function createTmpDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'chatbuddy-backup-ts-test-'));
}

void test('listLocalBackups — createdAt 为带 Z 后缀的 UTC ISO 字符串', async () => {
  const dir = await createTmpDir();
  try {
    const local = new Date(2024, 5, 21, 14, 30, 0); // 本地时间 2024-06-21 14:30:00
    const fileName = buildFileNameFromLocalDate(local);
    await fs.promises.writeFile(path.join(dir, fileName), Buffer.from(''));

    const entries = await listLocalBackups(dir);
    assert.equal(entries.length, 1, '应列出 1 个备份');
    const createdAt = entries[0].createdAt;

    // 必须带 Z 后缀（UTC），无时区偏移歧义
    assert.ok(
      createdAt.endsWith('Z'),
      `createdAt 应以 Z 结尾（UTC），实际: ${createdAt}`
    );
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

void test('listLocalBackups — new Date(createdAt).getTime() 与本地 Date 完全一致', async () => {
  const dir = await createTmpDir();
  try {
    const local = new Date(2024, 5, 21, 14, 30, 45);
    const fileName = buildFileNameFromLocalDate(local);
    await fs.promises.writeFile(path.join(dir, fileName), Buffer.from(''));

    const entries = await listLocalBackups(dir);
    assert.equal(entries.length, 1);

    const parsedMs = new Date(entries[0].createdAt).getTime();
    const expectedMs = local.getTime();
    assert.equal(
      parsedMs,
      expectedMs,
      `new Date(createdAt).getTime() 应等于本地时间分量的绝对时间戳，` +
        `实际 ${parsedMs}，期望 ${expectedMs}（差异 ${parsedMs - expectedMs}ms）`
    );
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

void test('listLocalBackups — 多个备份按 createdAt 降序排列（字典序 == 时间序）', async () => {
  const dir = await createTmpDir();
  try {
    const older = new Date(2023, 0, 1, 0, 0, 0);
    const newer = new Date(2024, 11, 31, 23, 59, 59);
    const middle = new Date(2024, 5, 21, 14, 30, 0);

    for (const d of [older, newer, middle]) {
      await fs.promises.writeFile(path.join(dir, buildFileNameFromLocalDate(d)), Buffer.from(''));
    }

    const entries = await listLocalBackups(dir);
    assert.equal(entries.length, 3);

    const times = entries.map((e) => new Date(e.createdAt).getTime());
    assert.ok(times[0] > times[1], `第一个应最新：${times[0]} > ${times[1]}`);
    assert.ok(times[1] > times[2], `最后一个应最旧：${times[1]} > ${times[2]}`);

    assert.deepEqual(
      times,
      [newer.getTime(), middle.getTime(), older.getTime()],
      '应按时间降序排列'
    );
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

void test('listLocalBackups — 文件名时间戳无效时回退到 mtime', async () => {
  const dir = await createTmpDir();
  try {
    // 不符合 YYYYMMDD-HHMMSS 格式的文件名，应回退到 stat.mtime.toISOString()
    const badName = `${BACKUP_FILE_PREFIX}invalid${BACKUP_FILE_EXTENSION}`;
    await fs.promises.writeFile(path.join(dir, badName), Buffer.from(''));

    const entries = await listLocalBackups(dir);
    assert.equal(entries.length, 1);
    // mtime 也是 ISO 格式，带 Z
    assert.ok(entries[0].createdAt.endsWith('Z'), `mtime 回退也应为 ISO UTC：${entries[0].createdAt}`);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
