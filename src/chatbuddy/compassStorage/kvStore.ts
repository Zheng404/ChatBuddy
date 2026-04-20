import { readJsonFile, removeFileIfExists, writeJsonAtomic } from './io';
import { CompassPaths } from './paths';

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

  public clear(): void {
    this.kv.clear();
  }

  public get(key: string): string | undefined {
    return this.kv.get(key);
  }

  public set(key: string, value: string): void {
    this.kv.set(key, value);
  }
}
