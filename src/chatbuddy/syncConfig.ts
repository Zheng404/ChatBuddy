/**
 * 数据存储目录配置模块。
 *
 * 配置存储在存储目录内的 `meta/.sync-config.json` 文件中（独立于 Compass 状态数据），
 * 所有数据均存文件夹，不使用 VS Code globalState。
 *
 * 提供两种存储模式：
 * - `default`：使用 VS Code 默认的 globalStorage 目录（仅当前 IDE 可用）
 * - `shared`：使用用户目录下的 `~/.ChatBuddy` 文件夹（多 IDE 共享）
 *
 * 引导策略：始终先尝试读取 `~/.ChatBuddy/meta/.sync-config.json`，
 * 不存在则使用默认模式。这避免了"需要先读配置才能确定路径"的引导悖论。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type StorageMode = 'default' | 'shared';

export interface SyncConfig {
  storageMode: StorageMode;
}

const SYNC_CONFIG_FILE_NAME = '.sync-config.json';

/** 获取共享存储路径（固定为 ~/.ChatBuddy） */
export function getSharedStoragePath(): string {
  return path.join(os.homedir(), '.ChatBuddy');
}

/** 获取共享存储中的同步配置文件路径 */
export function getSharedSyncConfigPath(): string {
  return path.join(getSharedStoragePath(), 'meta', SYNC_CONFIG_FILE_NAME);
}

/** 创建默认存储配置 */
export function createDefaultSyncConfig(): SyncConfig {
  return { storageMode: 'default' };
}

/** 从文件系统读取同步配置。始终先尝试读取 ~/.ChatBuddy 中的配置文件 */
export async function readSyncConfig(): Promise<SyncConfig> {
  // 始终先尝试读取共享存储中的配置
  const sharedConfigPath = getSharedSyncConfigPath();
  try {
    const content = await fs.promises.readFile(sharedConfigPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed.storageMode === 'string' &&
        (parsed.storageMode === 'default' || parsed.storageMode === 'shared')) {
      // 兼容旧格式：enabled=true + sharedStoragePath → storageMode='shared'
      return { storageMode: parsed.storageMode };
    }
    if (parsed.enabled === true && typeof parsed.sharedStoragePath === 'string' && parsed.sharedStoragePath.trim()) {
      return { storageMode: 'shared' };
    }
  } catch (err) {
    // 配置文件不存在时静默使用默认模式；
    // 文件存在但内容损坏时输出警告，帮助用户排查问题
    if (err && (err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[ChatBuddy] Failed to parse sync config, falling back to default mode:', err);
    }
  }
  return createDefaultSyncConfig();
}

/** 写入同步配置到文件系统 */
export async function writeSyncConfig(
  config: SyncConfig,
  storageRootPath?: string
): Promise<void> {
  // 写入到目标存储路径的 meta/ 目录下
  const targetPath = config.storageMode === 'shared'
    ? getSharedStoragePath()
    : storageRootPath;

  if (!targetPath) { return; }

  const configDir = path.join(targetPath, 'meta');
  await fs.promises.mkdir(configDir, { recursive: true }).catch(() => {});
  const configPath = path.join(configDir, SYNC_CONFIG_FILE_NAME);

  // 原子写入
  const tempPath = `${configPath}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify({ storageMode: config.storageMode }, null, 2), 'utf-8');
  await fs.promises.rename(tempPath, configPath);
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

/** 检查目录中是否已有 Compass 数据（检查 meta/ 和 sessions/ 目录） */
export async function hasCompassData(dirPath: string): Promise<boolean> {
  try {
    const metaPath = path.join(dirPath, 'meta');
    await fs.promises.access(metaPath, fs.constants.R_OK);
    return true;
  } catch {
    // meta/ 不存在，继续检查 sessions/
  }
  try {
    const sessionsPath = path.join(dirPath, 'sessions');
    await fs.promises.access(sessionsPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查目录中是否有可用的 Compass 状态数据。
 * 比 hasCompassData 更严格：要求 state.core.json 存在且可解析。
 * 用于 initialize() 中判断是否应跳过初始 persist。
 */
export async function hasValidCompassState(dirPath: string): Promise<boolean> {
  try {
    const corePath = path.join(dirPath, 'meta', 'state.core.json');
    const content = await fs.promises.readFile(corePath, 'utf-8');
    const parsed = JSON.parse(content);
    // 检查是否包含基本结构（groups 和 assistants 数组）
    return !!parsed && typeof parsed === 'object' && Array.isArray(parsed.groups) && Array.isArray(parsed.assistants);
  } catch {
    return false;
  }
}
