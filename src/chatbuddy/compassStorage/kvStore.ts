/**
 * Compass 键值存储模块。
 *
 * 提供简单的字符串键值对持久化存储，数据保存在 `kv.compass.json` 中。
 * 主要用于兼容少量非结构化数据的存储需求。
 */
import { fileExists, readJsonFile, readTextFile, removeFileIfExists, writeJsonAtomic } from './io';
import { CompassPaths } from './paths';
import { CompassValidationResult } from './types';
import { warn } from '../utils';

export class CompassKvStore {
  private readonly kv = new Map<string, string>();
  private dirty = false;

  public async load(paths: CompassPaths): Promise<void> {
    this.kv.clear();
    this.dirty = false;
    // kv 文件损坏（JSON 解析失败）时降级为空 kv，避免单个文件损坏导致整个加载失败。
    // readJsonFile 在 ENOENT 时返回 undefined（合法），仅在文件损坏时抛出。
    let payload: Record<string, unknown> | undefined;
    try {
      payload = await readJsonFile<Record<string, unknown>>(paths.kvPath);
    } catch (err) {
      warn('kv.compass.json is corrupted, falling back to empty kv map:', err);
      payload = undefined;
    }
    if (!payload || typeof payload !== 'object') {
      return;
    }
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string') {
        this.kv.set(key, value);
      }
    }
  }

  public async persist(paths: CompassPaths): Promise<void> {
    try {
      if (!this.kv.size) {
        await removeFileIfExists(paths.kvPath);
        return;
      }
      const payload = Object.fromEntries([...this.kv.entries()].sort(([a], [b]) => a.localeCompare(b)));
      await writeJsonAtomic(paths.kvPath, payload);
    } finally {
      this.dirty = false;
    }
  }

  public hasData(): boolean {
    return this.kv.size > 0;
  }

  public async validateSnapshot(paths: CompassPaths): Promise<CompassValidationResult> {
    if (!(await fileExists(paths.kvPath))) {
      return { valid: true };
    }

    const raw = await readTextFile(paths.kvPath);
    if (!raw || !raw.trim()) {
      return { valid: false, reason: `KV snapshot is empty: ${paths.kvPath}` };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      warn('Error parsing KV snapshot:', err);
      return { valid: false, reason: `KV snapshot is not valid JSON: ${paths.kvPath}` };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { valid: false, reason: `KV snapshot must be a JSON object: ${paths.kvPath}` };
    }

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        return { valid: false, reason: `KV snapshot contains a non-string value for key "${key}"` };
      }
    }

    return { valid: true };
  }

  public clear(): void {
    this.kv.clear();
  }

  public listAll(): Record<string, string> {
    return Object.fromEntries([...this.kv.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  public replaceAll(entries: Record<string, string>): void {
    this.kv.clear();
    this.dirty = true;
    for (const [key, value] of Object.entries(entries)) {
      const normalizedKey = key.trim();
      if (!normalizedKey) {
        continue;
      }
      this.kv.set(normalizedKey, value);
    }
  }

  public get(key: string): string | undefined {
    return this.kv.get(key);
  }

  public set(key: string, value: string): void {
    this.kv.set(key, value);
    this.dirty = true;
  }

  public isDirty(): boolean {
    return this.dirty;
  }
}
