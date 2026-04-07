import * as fs from 'fs';

/**
 * 读取文件内容为字符串
 * @param filePath 文件路径
 * @returns 文件内容字符串
 */
export async function readFile(filePath: string): Promise<string> {
  const content = await fs.promises.readFile(filePath);
  return content.toString('utf-8');
}

/**
 * 写入字符串内容到文件
 * @param filePath 文件路径
 * @param content 要写入的内容
 */
export async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.promises.writeFile(filePath, Buffer.from(content, 'utf-8'));
}

/**
 * 检查文件是否存在
 * @param filePath 文件路径
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
