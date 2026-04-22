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
export async function createLocalBackup(repository: ChatStateRepository, directory: string): Promise<string> {
  ensureDirectory(directory);

  const fileName = buildTimestampedFileName();
  const filePath = path.join(directory, fileName);
  const backup = repository.exportBackupData();
  const archive = createBackupArchive(backup);

  await fs.promises.writeFile(filePath, Buffer.from(archive));
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
    if (!entry.isFile() || !entry.name.startsWith(BACKUP_FILE_PREFIX) || !entry.name.endsWith(BACKUP_FILE_EXTENSION)) {
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(path.join(directory, entry.name));
    } catch {
      continue;
    }

    results.push({
      fileName: entry.name,
      fileSize: stat.size,
      createdAt: stat.mtime.toISOString()
    });
  }

  results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return results;
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
 */
export async function restoreLocalBackup(repository: ChatStateRepository, directory: string, fileName: string): Promise<void> {
  validateFileName(fileName);
  const filePath = path.join(directory, fileName);
  const raw = await fs.promises.readFile(filePath);
  const parsed = extractBackupPayloadFromArchive(new Uint8Array(raw));
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
  settings: LocalBackupSettings
): Promise<void> {
  if (!settings.enabled || !settings.directory) {
    return;
  }

  await createLocalBackup(repository, settings.directory);
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

function buildTimestampedFileName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${BACKUP_FILE_PREFIX}${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${BACKUP_FILE_EXTENSION}`;
}

function ensureDirectory(directory: string): void {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function validateFileName(fileName: string): void {
  if (!fileName.startsWith(BACKUP_FILE_PREFIX) || !fileName.endsWith(BACKUP_FILE_EXTENSION)) {
    throw new Error(`Invalid backup file name: ${fileName}`);
  }
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new Error(`Unsafe backup file name: ${fileName}`);
  }
}
