/**
 * 数据存储迁移工具模块。
 *
 * 处理默认存储与共享存储之间的双向数据迁移。
 * 安全原则：不删除原始数据，只做复制。
 */
import * as fs from 'fs';
import * as path from 'path';

import { ensureDir } from './compassStorage/io';

export interface MigrationResult {
  success: boolean;
  reason?: string;
  filesCopied?: number;
  skipped?: number;
}

/** 递归复制目录内容，覆盖已存在的目标文件（避免新旧混合产生不一致状态） */
async function copyDirectoryContents(
  src: string,
  dest: string,
  counter: { count: number },
  onProgress?: (copied: number, currentFile: string) => void
): Promise<void> {
  await ensureDir(dest);
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryContents(srcPath, destPath, counter, onProgress);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcPath, destPath);
      counter.count++;
      onProgress?.(counter.count, entry.name);
    }
  }
}

/** Compass 数据子目录列表 */
const COMPASS_SUBDIRS = ['meta', 'sessions', 'images'] as const;

/**
 * 通用数据迁移：将源目录的 Compass 数据复制到目标目录。
 * 支持双向迁移（默认→共享 或 共享→默认）。
 */
export interface MigrationProgress {
  filesCopied: number;
  currentFile: string;
}

export async function migrateStorage(
  sourcePath: string,
  targetPath: string,
  onProgress?: (progress: MigrationProgress) => void
): Promise<MigrationResult> {
  // 校验源目录存在
  try {
    await fs.promises.access(sourcePath, fs.constants.R_OK);
  } catch {
    return { success: false, reason: 'Source storage directory does not exist or is not readable' };
  }

  // 确保目标目录存在
  try {
    await ensureDir(targetPath);
  } catch {
    return { success: false, reason: 'Failed to create target storage directory' };
  }

  const counter = { count: 0 };

  try {
    for (const subdir of COMPASS_SUBDIRS) {
      const srcDir = path.join(sourcePath, subdir);
      const destDir = path.join(targetPath, subdir);
      try {
        await fs.promises.access(srcDir, fs.constants.R_OK);
        await copyDirectoryContents(srcDir, destDir, counter, (copied, fileName) => {
          onProgress?.({ filesCopied: copied, currentFile: fileName });
        });
      } catch {
        // 子目录可能不存在（首次安装）
      }
    }

    // 写入迁移标记到源目录
    const markerPath = path.join(sourcePath, '.migration-backup');
    try {
      await fs.promises.writeFile(markerPath, JSON.stringify({
        migratedAt: new Date().toISOString(),
        targetPath,
        filesCopied: counter.count
      }, null, 2));
    } catch {
      // 标记写入失败不影响迁移结果
    }

    return { success: true, filesCopied: counter.count };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, reason: `Migration failed: ${msg}` };
  }
}

/**
 * @deprecated 使用 migrateStorage 替代
 * 保留旧函数签名以兼容现有调用
 */
export async function migrateToSharedStorage(
  localPath: string,
  sharedPath: string
): Promise<MigrationResult> {
  return migrateStorage(localPath, sharedPath);
}

/** 验证存储目录中的数据完整性 */
export async function validateStorageData(storagePath: string): Promise<{ valid: boolean; reason?: string; corruptedFiles?: string[] }> {
  const metaPath = path.join(storagePath, 'meta');

  try {
    await fs.promises.access(metaPath, fs.constants.R_OK);
  } catch {
    return { valid: false, reason: 'Meta directory not found' };
  }

  // 检查关键 JSON 文件是否可解析
  const criticalFiles = [
    'state.core.json',
    'settings.general.json'
  ];

  const corrupted: string[] = [];
  for (const fileName of criticalFiles) {
    const filePath = path.join(metaPath, fileName);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      JSON.parse(content);
    } catch {
      corrupted.push(fileName);
    }
  }

  if (corrupted.length > 0) {
    return { valid: false, reason: `Corrupted files: ${corrupted.join(', ')}`, corruptedFiles: corrupted };
  }

  return { valid: true };
}

/**
 * @deprecated 使用 validateStorageData 替代
 */
export const validateSharedData = validateStorageData;
