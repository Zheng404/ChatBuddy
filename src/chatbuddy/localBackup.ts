/**
 * 本地备份核心逻辑。
 *
 * 提供本地文件系统备份的创建、列表、恢复、删除和自动清理功能。
 * 复用已有的 createBackupArchive / extractBackupPayloadFromArchive 归档能力。
 */
import * as fs from 'fs';
import * as path from 'path';

import { createBackupArchive, extractBackupPayloadFromArchive } from './backupArchive';
import { LOCAL_BACKUP } from './constants';
import type { BackupFileEntry, LocalBackupSettings } from './types';
import type { ChatStateRepository } from './stateRepository';

const BACKUP_FILE_PREFIX = 'chatbuddy-backup-';
const BACKUP_FILE_EXTENSION = '.zip';

/**
 * Create a local backup ZIP in the configured directory.
 * Returns the file name of the created backup.
 */
export async function createLocalBackup(
  repository: ChatStateRepository,
  directory: string
): Promise<string> {
  await ensureDirectory(directory);

  const fileName = buildTimestampedFileName();
  const filePath = path.join(directory, fileName);
  const backup = repository.exportBackupData();
  const archive = createBackupArchive(backup);

  const tmpPath = filePath + '.tmp';
  await fs.promises.writeFile(tmpPath, Buffer.from(archive));
  await fs.promises.rename(tmpPath, filePath);
  return fileName;
}

/**
 * List all backup files in the directory, sorted newest first.
 */
export async function listLocalBackups(directory: string): Promise<BackupFileEntry[]> {
  if (!directory) {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: BackupFileEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(BACKUP_FILE_PREFIX)) {
      continue;
    }
    if (!entry.name.endsWith(BACKUP_FILE_EXTENSION)) {
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(path.join(directory, entry.name));
    } catch {
      continue;
    }

    // 优先从文件名解析创建时间（避免 mtime 因文件复制/移动而改变）
    const createdAt = parseBackupTimestampFromFileName(entry.name) ?? stat.mtime.toISOString();

    results.push({
      fileName: entry.name,
      fileSize: stat.size,
      createdAt
    });
  }

  results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return results;
}

/**
 * 从备份文件名解析时间戳。
 * 文件名格式: chatbuddy-backup-YYYYMMDD-HHMMSS.zip
 * 返回 ISO 8601 字符串，解析失败返回 undefined。
 */
function parseBackupTimestampFromFileName(fileName: string): string | undefined {
  // 去掉扩展名: .zip
  let stem = fileName;
  if (stem.endsWith(BACKUP_FILE_EXTENSION)) {
    stem = stem.slice(0, -BACKUP_FILE_EXTENSION.length);
  }
  if (!stem.startsWith(BACKUP_FILE_PREFIX)) {
    return undefined;
  }
  const tsPart = stem.slice(BACKUP_FILE_PREFIX.length); // YYYYMMDD-HHMMSS
  if (tsPart.length !== 15 || tsPart[8] !== '-') {
    return undefined;
  }
  const year = parseInt(tsPart.slice(0, 4), 10);
  const month = parseInt(tsPart.slice(4, 6), 10) - 1;
  const day = parseInt(tsPart.slice(6, 8), 10);
  const hour = parseInt(tsPart.slice(9, 11), 10);
  const minute = parseInt(tsPart.slice(11, 13), 10);
  const second = parseInt(tsPart.slice(13, 15), 10);
  const date = new Date(year, month, day, hour, minute, second);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return undefined;
  }
  return localDateToTimestamp(date);
}

/**
 * Delete a specific backup file.
 */
export async function deleteLocalBackup(directory: string, fileName: string): Promise<void> {
  const filePath = resolveAndValidatePath(directory, fileName);
  await fs.promises.unlink(filePath);
}

/**
 * Restore from a specific local backup file.
 */
export async function restoreLocalBackup(
  repository: ChatStateRepository,
  directory: string,
  fileName: string
): Promise<void> {
  const filePath = resolveAndValidatePath(directory, fileName);
  const raw = await fs.promises.readFile(filePath);
  const archiveBytes: Uint8Array = new Uint8Array(raw);
  const parsed = await extractBackupPayloadFromArchive(archiveBytes);
  await repository.importBackupData(parsed);
}

/**
 * Clean expired backups based on maxCount and maxAgeDays settings.
 * Returns the number of deleted files.
 */
export async function cleanExpiredBackups(
  directory: string,
  maxCount: number,
  maxAgeDays: number
): Promise<number> {
  if (!directory) {
    return 0;
  }

  const backups = await listLocalBackups(directory);
  const now = Date.now();
  const toDelete = new Set<string>();

  // Clean by age (days)
  if (maxAgeDays > 0) {
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    for (const backup of backups) {
      const createdMs = new Date(backup.createdAt).getTime();
      if (now - createdMs > maxAgeMs) {
        toDelete.add(backup.fileName);
      }
    }
  }

  // Clean by count (keep only maxCount newest)
  if (maxCount > 0 && backups.length > maxCount) {
    for (let i = maxCount; i < backups.length; i++) {
      toDelete.add(backups[i].fileName);
    }
  }

  let deleted = 0;
  for (const fileName of toDelete) {
    try {
      await fs.promises.unlink(path.join(directory, fileName));
      deleted += 1;
    } catch {
      // File may have been removed concurrently; skip.
    }
  }

  return deleted;
}

const LOCK_FILE_NAME = '.chatbuddy-backup-lock';
const LOCK_TIMEOUT_MS = 60_000; // 1 minute

/**
 * Run a scheduled backup cycle: create + clean.
 * Uses a file-based lock to prevent duplicate backups when multiple IDEs share sync storage.
 * Skips creation if another IDE already made a backup within half the interval period.
 */
export async function runScheduledBackup(
  repository: ChatStateRepository,
  settings: LocalBackupSettings
): Promise<void> {
  if (!settings.enabled || !settings.directory) {
    return;
  }

  if (!await acquireBackupLock(settings.directory)) {
    return;
  }
  try {
    // 如果半个周期内已有其他 IDE 创建的备份，跳过本次
    if (await hasRecentBackup(settings.directory, settings.intervalHours)) {
      return;
    }
    await createLocalBackup(repository, settings.directory);
    await cleanExpiredBackups(settings.directory, settings.maxCount, settings.maxAgeDays);
  } finally {
    await releaseBackupLock(settings.directory);
  }
}

/**
 * 检查是否已有较新的备份（半个周期内）。
 * 用于多 IDE 场景下避免重复创建内容相同的备份。
 */
async function hasRecentBackup(directory: string, intervalHours: number): Promise<boolean> {
  const backups = await listLocalBackups(directory);
  if (backups.length === 0) { return false; }
  const newest = new Date(backups[0].createdAt).getTime();
  const halfIntervalMs = intervalHours * 0.5 * 60 * 60 * 1000;
  return (Date.now() - newest) < halfIntervalMs;
}

async function acquireBackupLock(directory: string): Promise<boolean> {
  const lockPath = path.join(directory, LOCK_FILE_NAME);
  await ensureDirectory(directory);

  // 使用 mkdir 原子操作获取锁（比 open('wx') + unlink 更安全）
  try {
    await fs.promises.mkdir(lockPath);
    const fd = await fs.promises.open(path.join(lockPath, 'stamp'), 'w');
    await fd.writeFile(String(Date.now()), 'utf-8');
    await fd.close();
    return true;
  } catch (openError) {
    if ((openError as NodeJS.ErrnoException)?.code !== 'EEXIST') {
      return false;
    }
  }

  // Lock directory exists — check if it's expired
  try {
    const content = await fs.promises.readFile(path.join(lockPath, 'stamp'), 'utf-8');
    const lockedAt = parseInt(content, 10);
    if (!isNaN(lockedAt) && Date.now() - lockedAt < LOCK_TIMEOUT_MS) {
      return false; // Another IDE holds the lock
    }
  } catch {
    return false;
  }

  // Lock is expired — use mkdir for atomic lock acquisition (避免 unlink+open TOCTOU 竞态)
  // mkdir 在所有文件系统上都是原子的：成功即获得锁，EEXIST 即被他人持有
  try {
    await fs.promises.mkdir(lockPath);
    // mkdir 成功，写入时间戳到标记文件
    const fd = await fs.promises.open(path.join(lockPath, 'stamp'), 'w');
    await fd.writeFile(String(Date.now()), 'utf-8');
    await fd.close();
    return true;
  } catch {
    return false;
  }
}

async function releaseBackupLock(directory: string): Promise<void> {
  try {
    await fs.promises.rm(path.join(directory, LOCK_FILE_NAME), { recursive: true });
  } catch {
    // Lock already removed
  }
}

/**
 * Calculate the interval in milliseconds for the auto-backup timer.
 */
export function getBackupIntervalMs(settings: LocalBackupSettings): number {
  if (!settings.enabled || !settings.directory) {
    return 0;
  }
  return Math.max(settings.intervalHours, LOCAL_BACKUP.MIN_INTERVAL_HOURS) * 60 * 60 * 1000;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildTimestampedFileName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stem = `${BACKUP_FILE_PREFIX}${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stem}${BACKUP_FILE_EXTENSION}`;
}

/**
 * 将本地时间 Date 对象转为与文件名一致的 ISO 8601 字符串（保留本地时区信息）。
 * 避免使用 toISOString() 导致 UTC 偏移不一致。
 */
function localDateToTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function ensureDirectory(directory: string): Promise<void> {
  await fs.promises.mkdir(directory, { recursive: true });
}

function validateFileName(fileName: string): void {
  if (!fileName.startsWith(BACKUP_FILE_PREFIX) || !fileName.endsWith(BACKUP_FILE_EXTENSION)) {
    throw new Error(`Invalid backup file name: ${fileName}`);
  }
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new Error(`Unsafe backup file name: ${fileName}`);
  }
}

/**
 * Resolve a file path within a directory and verify it doesn't escape the directory.
 * Throws if the resolved path is outside the target directory.
 */
export function resolveAndValidatePath(directory: string, fileName: string): string {
  validateFileName(fileName);
  const resolved = path.resolve(directory, fileName);
  const resolvedDir = path.resolve(directory);
  if (!resolved.startsWith(resolvedDir + path.sep) && resolved !== resolvedDir) {
    throw new Error(`Path traversal detected: ${fileName}`);
  }
  return resolved;
}
