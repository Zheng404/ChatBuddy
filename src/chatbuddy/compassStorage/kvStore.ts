import { fileExists, readJsonFile, readTextFile, removeFileIfExists, writeJsonAtomic } from './io';
import { CompassPaths } from './paths';
import { CompassValidationResult } from './types';

export class CompassKvStore {
  private readonly kv = new Map<string, string>();

  public async load(paths: CompassPaths): Promise<void> {
    this.kv.clear();
    const payload = await readJsonFile<Record<string, unknown>>(paths.kvPath);
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
    if (!this.kv.size) {
      await removeFileIfExists(paths.kvPath);
      return;
    }
    const payload = Object.fromEntries([...this.kv.entries()].sort(([a], [b]) => a.localeCompare(b)));
    await writeJsonAtomic(paths.kvPath, payload);
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
    } catch {
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
  }
}
