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
import { decryptBackup, encryptBackup, isEncryptedBackup, ENCRYPTED_FILE_SUFFIX } from './localBackupEncryption';
import type { BackupFileEntry, LocalBackupSettings } from './types';
import type { ChatStateRepository } from './stateRepository';

const BACKUP_FILE_PREFIX = 'chatbuddy-backup-';
const BACKUP_FILE_EXTENSION = '.zip';
const BACKUP_ENCRYPTED_EXTENSION = ENCRYPTED_FILE_SUFFIX;

/**
 * Create a local backup ZIP in the configured directory.
 * If `encryptionPassword` is provided, the archive is encrypted before writing.
 * Returns the file name of the created backup.
 */
export async function createLocalBackup(
  repository: ChatStateRepository,
  directory: string,
  encryptionPassword?: string
): Promise<string> {
  await ensureDirectory(directory);

  const useEncryption = !!encryptionPassword;
  const fileName = buildTimestampedFileName(useEncryption);
  const filePath = path.join(directory, fileName);
  const backup = repository.exportBackupData();
  const archive = createBackupArchive(backup);
  const finalBytes = useEncryption ? await encryptBackup(archive, encryptionPassword!) : archive;

  await fs.promises.writeFile(filePath, Buffer.from(finalBytes));
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
    if (!entry.name.endsWith(BACKUP_FILE_EXTENSION) && !entry.name.endsWith(BACKUP_ENCRYPTED_EXTENSION)) {
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
 * 文件名格式: chatbuddy-backup-YYYYMMDD-HHMMSS.zip[.enc]
 * 返回 ISO 8601 字符串，解析失败返回 undefined。
 */
function parseBackupTimestampFromFileName(fileName: string): string | undefined {
  // 去掉扩展名: .zip 或 .enc.zip
  let stem = fileName;
  if (stem.endsWith(BACKUP_ENCRYPTED_EXTENSION)) {
    stem = stem.slice(0, -BACKUP_ENCRYPTED_EXTENSION.length);
  } else if (stem.endsWith(BACKUP_FILE_EXTENSION)) {
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
  return date.toISOString();
}

/**
 * Delete a specific backup file.
 */
export async function deleteLocalBackup(directory: string, fileName: string): Promise<void> {
  validateFileName(fileName);
  await fs.promises.unlink(path.join(directory, fileName));
}

/**
 * Restore from a specific local backup file.
 * If the file is encrypted, `decryptionPassword` must be provided.
 */
export async function restoreLocalBackup(
  repository: ChatStateRepository,
  directory: string,
  fileName: string,
  decryptionPassword?: string
): Promise<void> {
  validateFileName(fileName);
  const filePath = path.join(directory, fileName);
  const raw = await fs.promises.readFile(filePath);
  let archiveBytes: Uint8Array = new Uint8Array(raw);
  if (isEncryptedBackup(archiveBytes)) {
    if (!decryptionPassword) {
      throw new Error('Encrypted backup requires a password');
    }
    archiveBytes = await decryptBackup(archiveBytes, decryptionPassword);
  }
  const parsed = extractBackupPayloadFromArchive(archiveBytes);
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

/**
 * Run a scheduled backup cycle: create + clean.
 */
export async function runScheduledBackup(
  repository: ChatStateRepository,
  settings: LocalBackupSettings,
  encryptionPassword?: string
): Promise<void> {
  if (!settings.enabled || !settings.directory) {
    return;
  }

  let password: string | undefined;
  if (settings.encryptionEnabled) {
    if (!encryptionPassword) {
      console.warn('[ChatBuddy] Scheduled backup skipped: encryption enabled but no password set.');
      return;
    }
    password = encryptionPassword;
  }
  await createLocalBackup(repository, settings.directory, password);
  await cleanExpiredBackups(settings.directory, settings.maxCount, settings.maxAgeDays);
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

function buildTimestampedFileName(encrypted = false): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stem = `${BACKUP_FILE_PREFIX}${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return encrypted ? `${stem}${BACKUP_ENCRYPTED_EXTENSION}` : `${stem}${BACKUP_FILE_EXTENSION}`;
}

async function ensureDirectory(directory: string): Promise<void> {
  await fs.promises.mkdir(directory, { recursive: true });
}

function validateFileName(fileName: string): void {
  if (!fileName.startsWith(BACKUP_FILE_PREFIX) ||
      (!fileName.endsWith(BACKUP_FILE_EXTENSION) && !fileName.endsWith(BACKUP_ENCRYPTED_EXTENSION))) {
    throw new Error(`Invalid backup file name: ${fileName}`);
  }
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new Error(`Unsafe backup file name: ${fileName}`);
  }
}
