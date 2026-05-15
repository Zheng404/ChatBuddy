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

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
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
    return undefined;
  }
  try {
    return JSON.parse(content) as T;
  } catch (parseError) {
    console.warn(`[Compass] Failed to parse JSON file: ${filePath}`, parseError);
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
  await writeTextAtomic(filePath, JSON.stringify(data, null, 2));
}

export async function appendTextFile(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.promises.appendFile(filePath, content, 'utf-8');
}

/**
 * 获取文件的修改时间（mtime），单位毫秒。
 * 文件不存在返回 -1，出错抛出异常。
 */
export async function getFileMtime(filePath: string): Promise<number> {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.mtimeMs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return -1;
    }
    throw err;
  }
}

/**
 * 读取 JSON 文件并返回数据及其修改时间。
 * 文件不存在或解析失败返回 data: undefined, mtime: -1。
 */
export async function readJsonFileWithMtime<T>(filePath: string): Promise<{ data: T | undefined; mtime: number }> {
  const mtime = await getFileMtime(filePath);
  if (mtime < 0) {
    return { data: undefined, mtime: -1 };
  }
  const data = await readJsonFile<T>(filePath);
  return { data, mtime };
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
