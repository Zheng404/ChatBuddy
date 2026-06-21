/**
 * Compass 存储原子 I/O 工具模块。
 *
 * 提供文件系统层面的原子写操作（先写 `.tmp` 再重命名）、
 * 安全读操作（ENOENT 返回 undefined）、目录操作和递归文件列表。
 *
 * 所有写函数保证要么完全写入，要么不修改目标文件，防止数据损坏。
 */
import * as fs from 'fs';
import * as path from 'path';

import { warn } from '../utils';

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch (err) {
    // ENOENT 表示文件确实不存在，返回 false 是合法的「不存在」语义。
    // 其他错误（EACCES 权限不足、ENOTDIR 等）表示真实检查失败，必须向上传播——
    // 否则调用方会误判为「文件不存在」并触发不必要的迁移/重置流程。
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

export async function readTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch (readError) {
    if ((readError as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return undefined;
    }
    throw readError;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  const content = await readTextFile(filePath);
  if (!content || !content.trim()) {
    // 文件不存在（readTextFile 在 ENOENT 时返回 undefined）或文件为空，
    // 这是合法的「无数据」语义，返回 undefined。
    return undefined;
  }
  try {
    return JSON.parse(content) as T;
  } catch (parseError) {
    // 文件存在但 JSON 已损坏——必须抛出，让调用方区分「文件不存在」（合法降级）
    // 与「文件已损坏」（需触发恢复/告警）。错误消息包含完整 filePath 便于定位。
    const reason = parseError instanceof Error ? parseError.message : String(parseError);
    throw new Error(`[Compass] Failed to parse JSON file: ${filePath} (${reason})`);
  }
}

/**
 * 读取 JSON 文件，损坏时降级为 undefined 并记录 error 日志。
 *
 * 适用于「文件损坏等价于文件缺失」的降级场景（如结构化状态文件加载）——
 * 后续的一致性校验/migrator 恢复流程会处理缺失情况。
 * 与 `readJsonFile` 的区别：此函数不会抛出解析错误，但通过 error 级别日志
 * 让损坏可被感知，避免静默降级导致问题难以诊断。
 */
export async function readJsonFileSafe<T>(filePath: string): Promise<T | undefined> {
  try {
    return await readJsonFile<T>(filePath);
  } catch (err) {
    console.error(`[ChatBuddy] Failed to read JSON file, treating as missing: ${filePath}`, err);
    return undefined;
  }
}

export async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, content, 'utf-8');
  await fs.promises.rename(tempPath, filePath);
}

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  let json: string;
  try {
    json = JSON.stringify(data, null, 2);
  } catch (stringifyError) {
    throw new Error(`[Compass] Failed to serialize JSON for ${filePath}: ${stringifyError instanceof Error ? stringifyError.message : String(stringifyError)}`);
  }
  await writeTextAtomic(filePath, json);
}

export async function appendTextFile(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  // 使用 'a' 模式（追加）写入。
  // 注意：对于超过 PIPE_BUF（Linux 通常 4096 字节）的写入，
  // 内核不保证原子性，多进程并发追加可能导致交错。
  // 当前场景（JSONL 会话消息追加）为单进程顺序写入，不存在此风险。
  const fd = await fs.promises.open(filePath, 'a');
  try {
    await fd.writeFile(content, 'utf-8');
  } finally {
    await fd.close();
  }
}


/** 检查目录中是否已有 Compass 数据（检查 meta/ 和 sessions/ 目录） */
export async function hasCompassData(dirPath: string): Promise<boolean> {
  try {
    await fs.promises.access(path.join(dirPath, 'meta'), fs.constants.R_OK);
    return true;
  } catch (err) {
    warn('Error checking meta directory:', err);
  }
  try {
    await fs.promises.access(path.join(dirPath, 'sessions'), fs.constants.R_OK);
    return true;
  } catch (err) {
    warn('Error checking sessions directory:', err);
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
    return !!parsed && typeof parsed === 'object' && Array.isArray(parsed.groups) && Array.isArray(parsed.assistants);
  } catch (err) {
    warn('Error validating compass state:', err);
    return false;
  }
}


export async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (removeError) {
    if ((removeError as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw removeError;
    }
  }
}

export async function readBase64File(filePath: string): Promise<string | undefined> {
  try {
    const data = await fs.promises.readFile(filePath);
    return data.toString('base64');
  } catch (readError) {
    if ((readError as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return undefined;
    }
    throw readError;
  }
}

export async function writeBase64File(filePath: string, base64: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, base64, 'base64');
  await fs.promises.rename(tempPath, filePath);
}

export async function listFilesRecursively(dirPath: string, suffix: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursively(entryPath, suffix);
      result.push(...nested);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) {
      result.push(entryPath);
    }
  }
  return result;
}

export async function moveDirectoryContents(sourceDirPath: string, targetDirPath: string): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(sourceDirPath, { withFileTypes: true });
  } catch (readError) {
    if ((readError as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return;
    }
    throw readError;
  }

  await ensureDir(targetDirPath);

  for (const entry of entries) {
    const sourcePath = path.join(sourceDirPath, entry.name);
    const targetPath = path.join(targetDirPath, entry.name);

    if (entry.isDirectory()) {
      let targetStats: fs.Stats | undefined;
      try {
        targetStats = await fs.promises.stat(targetPath);
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          throw statError;
        }
      }

      if (!targetStats) {
        await fs.promises.rename(sourcePath, targetPath);
        continue;
      }
      if (!targetStats.isDirectory()) {
        continue;
      }

      await moveDirectoryContents(sourcePath, targetPath);
      continue;
    }

    if (await fileExists(targetPath)) {
      continue;
    }
    await fs.promises.rename(sourcePath, targetPath);
  }

  await removeEmptyDirectoriesRecursively(sourceDirPath);
}

/**
 * 清理孤立的 .tmp 临时文件。
 *
 * 原子写入使用「先写 .tmp 再 rename」模式。若进程在 rename 之前崩溃，
 * 磁盘上会残留 .tmp 文件。此函数递归扫描 rootDir，删除满足以下条件的 .tmp 文件：
 * - 对应的目标文件（去掉 .tmp 后缀）已存在（说明写入已完成或目标已被新写入覆盖）
 * - 文件年龄超过 ageThresholdMs（毫秒，默认 60 秒），避免删除正在写入的文件
 *
 * 返回清理的文件数量。
 */
export async function cleanOrphanTempFiles(rootDir: string, ageThresholdMs = 60_000): Promise<number> {
  let cleaned = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
  } catch (readError) {
    if ((readError as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return 0;
    }
    throw readError;
  }

  const now = Date.now();
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      cleaned += await cleanOrphanTempFiles(entryPath, ageThresholdMs);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.tmp')) {
      try {
        const stat = await fs.promises.stat(entryPath);
        const age = now - stat.mtimeMs;
        // 仅删除：目标文件已存在 且 文件足够旧（不在活跃写入中）
        if (age >= ageThresholdMs) {
          const targetPath = entryPath.slice(0, -'.tmp'.length);
          if (await fileExists(targetPath)) {
            await fs.promises.unlink(entryPath);
            cleaned++;
          }
        }
      } catch (err) {
        warn('Error cleaning orphan temp file:', err);
      }
    }
  }
  return cleaned;
}

export async function removeEmptyDirectoriesRecursively(rootDirPath: string): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(rootDirPath, { withFileTypes: true });
  } catch (readError) {
    if ((readError as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return;
    }
    throw readError;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const entryPath = path.join(rootDirPath, entry.name);
    await removeEmptyDirectoriesRecursively(entryPath);
  }

  const remaining = await fs.promises.readdir(rootDirPath);
  if (remaining.length > 0) {
    return;
  }

  await fs.promises.rmdir(rootDirPath).catch((removeError: NodeJS.ErrnoException) => {
    if (removeError.code !== 'ENOENT' && removeError.code !== 'ENOTEMPTY') {
      throw removeError;
    }
  });
}

/** 快照目录名（相对于 meta/） */
const SNAPSHOT_DIR_NAME = '.snapshot';
/** 最大保留快照数 */
const MAX_SNAPSHOTS = 3;

/**
 * 在 persist 前创建 state.core.json 的快照备份。
 * 快照保存到 `meta/.snapshot/state.core.{generation}.json`，保留最近 N 代。
 * 用于崩溃恢复时从已知良好状态还原。
 */
export async function createPrePersistSnapshot(
  metaPath: string,
  stateCorePath: string,
  generation: number
): Promise<void> {
  // 仅在当前 state.core.json 存在时创建快照
  if (!(await fileExists(stateCorePath))) {
    return;
  }

  const snapshotDir = path.join(metaPath, SNAPSHOT_DIR_NAME);
  await ensureDir(snapshotDir);

  const snapshotPath = path.join(snapshotDir, `state.core.${generation}.json`);
  try {
    await fs.promises.copyFile(stateCorePath, snapshotPath);
  } catch (err) {
    warn('Error creating pre-persist snapshot:', err);
  }

  // 清理旧快照，保留最近 MAX_SNAPSHOTS 个
  await pruneOldSnapshots(snapshotDir);
}

/**
 * 从快照恢复 state.core.json。
 * 按 generation 降序尝试，返回第一个成功读取的内容。
 */
export async function restoreFromSnapshot<T>(metaPath: string): Promise<T | undefined> {
  const snapshotDir = path.join(metaPath, SNAPSHOT_DIR_NAME);
  if (!(await fileExists(snapshotDir))) {
    return undefined;
  }

  // 列出所有快照文件，按文件名降序排列（generation 越大越新）
  let entries: string[];
  try {
    entries = (await fs.promises.readdir(snapshotDir))
      .filter((name) => name.startsWith('state.core.') && name.endsWith('.json'))
      .sort((a, b) => extractSnapshotGeneration(b) - extractSnapshotGeneration(a));
  } catch (err) {
    warn('Error listing snapshot files:', err);
    return undefined;
  }

  for (const entry of entries) {
    // readJsonFile 现在会在 JSON 损坏时抛出（含 filePath）。
    // 单个损坏快照不应中断整个恢复流程——catch 后继续尝试更老的快照。
    let data: T | undefined;
    try {
      data = await readJsonFile<T>(path.join(snapshotDir, entry));
    } catch (err) {
      warn(`Error reading snapshot ${entry}, trying older snapshots:`, err);
      continue;
    }
    if (data) {
      console.warn(`[Compass] Restored state.core from snapshot: ${entry}`);
      return data;
    }
  }

  return undefined;
}

/** 从快照文件名提取 generation 数值 */
function extractSnapshotGeneration(name: string): number {
  const match = name.match(/^state\.core\.(\d+)\.json$/);
  return match ? parseInt(match[1], 10) : -1;
}

/** 清理旧快照，保留最近 MAX_SNAPSHOTS 个 */
async function pruneOldSnapshots(snapshotDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = (await fs.promises.readdir(snapshotDir))
      .filter((name) => name.startsWith('state.core.') && name.endsWith('.json'))
      .sort((a, b) => extractSnapshotGeneration(a) - extractSnapshotGeneration(b));
  } catch (err) {
    warn('Error pruning old snapshots:', err);
    return;
  }

  while (entries.length > MAX_SNAPSHOTS) {
    const oldest = entries.shift()!;
    await fs.promises.unlink(path.join(snapshotDir, oldest)).catch((err) => warn('Failed to delete old snapshot:', err));
  }
}
