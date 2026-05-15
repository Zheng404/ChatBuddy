/**
 * 数据存储目录配置模块。
 *
 * 配置存储在 IDE 的 `globalState`（独立于 Compass 存储）中，
 * 避免"设置存在 Compass 中，但 Compass 路径依赖设置"的引导悖论。
 *
 * 提供两种存储模式：
 * - `default`：使用 VS Code 默认的 globalStorage 目录（仅当前 IDE 可用）
 * - `shared`：使用用户目录下的 `~/.ChatBuddy` 文件夹（多 IDE 共享）
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type StorageMode = 'default' | 'shared';

export interface SyncConfig {
  storageMode: StorageMode;
}

const GLOBAL_STATE_KEY = 'chatbuddy.sync.config';

/** 获取共享存储路径（固定为 ~/.ChatBuddy） */
export function getSharedStoragePath(): string {
  return path.join(os.homedir(), '.ChatBuddy');
}

/** 创建默认存储配置 */
export function createDefaultSyncConfig(): SyncConfig {
  return { storageMode: 'default' };
}

/** 从 IDE globalState 读取存储配置，兼容旧版格式 */
export function readSyncConfig(globalState: { get?: (key: string) => unknown } | undefined | null): SyncConfig {
  if (!globalState?.get) {
    return createDefaultSyncConfig();
  }
  const raw = globalState.get(GLOBAL_STATE_KEY);
  if (!raw || typeof raw !== 'object') {
    return createDefaultSyncConfig();
  }
  const obj = raw as Record<string, unknown>;

  // 兼容新格式：storageMode 字段
  if (typeof obj.storageMode === 'string' && (obj.storageMode === 'default' || obj.storageMode === 'shared')) {
    return { storageMode: obj.storageMode };
  }

  // 兼容旧格式：enabled=true + sharedStoragePath → storageMode='shared'
  if (obj.enabled === true && typeof obj.sharedStoragePath === 'string' && obj.sharedStoragePath.trim()) {
    return { storageMode: 'shared' };
  }

  return createDefaultSyncConfig();
}

/** 写入存储配置到 IDE globalState */
export function writeSyncConfig(
  globalState: { update: (key: string, value: unknown) => Thenable<void> },
  config: SyncConfig
): Thenable<void> {
  return globalState.update(GLOBAL_STATE_KEY, {
    storageMode: config.storageMode
  });
}

/** 解析最终存储路径 */
export function resolveStoragePath(
  syncConfig: SyncConfig,
  defaultPath: string
): { path: string; usingShared: boolean } {
  if (syncConfig.storageMode === 'shared') {
    return { path: getSharedStoragePath(), usingShared: true };
  }

  return { path: defaultPath, usingShared: false };
}

/** 确保目录存在且可写 */
export async function ensureStorageDir(dirPath: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
    // 限制根目录权限为仅当前用户可访问（共享存储含 API Key 等敏感数据）
    // 子目录（meta/sessions/images）由父目录 0o700 自动保护，无需单独设置
    await fs.promises.chmod(dirPath, 0o700).catch(() => {});

    // 测试写入权限
    const testFile = path.join(dirPath, '.chatbuddy-write-test');
    await fs.promises.writeFile(testFile, 'ok');
    await fs.promises.unlink(testFile);

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg };
  }
}

/** 检查目录中是否已有 Compass 数据 */
export async function hasCompassData(dirPath: string): Promise<boolean> {
  try {
    const metaPath = path.join(dirPath, 'meta');
    await fs.promises.access(metaPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
