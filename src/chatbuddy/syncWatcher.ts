/**
 * 跨 IDE 文件变更检测模块。
 *
 * 使用 VS Code 原生的 `workspace.createFileSystemWatcher` 监听共享存储目录变更，
 * 检测到其他 IDE 的修改后触发回调通知。
 *
 * 设计要点：
 * - 不引入外部依赖（chokidar），使用 VS Code 原生 API
 * - 防抖处理：单次 persist 写入多个文件，合并为一次通知
 * - 生成中保护：流式响应期间不触发通知
 * - 仅监听文件名变更（create/change/delete），不读取内容
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

export type SyncChangeCategory = 'core' | 'settings' | 'sessions' | 'images';

export interface SyncWatcherCallbacks {
  /** 检测到外部变更时调用（已防抖） */
  onExternalChange: (categories: ReadonlySet<SyncChangeCategory>) => void;
  /** 查询当前是否正在生成消息 */
  getIsGenerating: () => boolean;
}

const DEBOUNCE_MS = 800;
const LAST_WRITE_FILE = 'meta/.last-write.json';

// 文件名到类别的映射
function categorizeFile(filePath: string, storageRoot: string): SyncChangeCategory | undefined {
  const rel = path.relative(storageRoot, filePath).replace(/\\/g, '/');
  if (rel.startsWith('meta/state.core.') || rel.startsWith('meta/ui.selection.') || rel.startsWith('meta/templates.')) {
    return 'core';
  }
  if (rel.startsWith('meta/settings.') || rel.startsWith('meta/providers.')) {
    return 'settings';
  }
  if (rel.startsWith('sessions/')) {
    return 'sessions';
  }
  if (rel.startsWith('images/')) {
    return 'images';
  }
  return undefined;
}

export class SyncWatcher implements vscode.Disposable {
  private readonly watchers: vscode.FileSystemWatcher[] = [];
  private pendingCategories = new Set<SyncChangeCategory>();
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingNotifyOnIdle = false;
  private flushInProgress = false;
  private readonly ideId = crypto.randomUUID();

  constructor(
    private readonly storageRoot: string,
    private readonly callbacks: SyncWatcherCallbacks
  ) {}

  start(): void {
    // 监听 meta/ 目录下的 JSON 文件
    const metaPattern = new vscode.RelativePattern(
      vscode.Uri.file(this.storageRoot),
      'meta/*.json'
    );
    const metaWatcher = vscode.workspace.createFileSystemWatcher(metaPattern);
    metaWatcher.onDidCreate((uri) => this.handleChange(uri.fsPath));
    metaWatcher.onDidChange((uri) => this.handleChange(uri.fsPath));
    metaWatcher.onDidDelete((uri) => this.handleChange(uri.fsPath));
    this.watchers.push(metaWatcher);

    // 监听 sessions/ 目录下的 JSONL 文件
    const sessionsPattern = new vscode.RelativePattern(
      vscode.Uri.file(this.storageRoot),
      'sessions/**/*.jsonl'
    );
    const sessionsWatcher = vscode.workspace.createFileSystemWatcher(sessionsPattern);
    sessionsWatcher.onDidCreate((uri) => this.handleChange(uri.fsPath));
    sessionsWatcher.onDidChange((uri) => this.handleChange(uri.fsPath));
    sessionsWatcher.onDidDelete((uri) => this.handleChange(uri.fsPath));
    this.watchers.push(sessionsWatcher);

    // 监听 sessions/index 文件
    const indexPattern = new vscode.RelativePattern(
      vscode.Uri.file(this.storageRoot),
      'sessions/index.compass.json'
    );
    const indexWatcher = vscode.workspace.createFileSystemWatcher(indexPattern);
    indexWatcher.onDidCreate((uri) => this.handleChange(uri.fsPath));
    indexWatcher.onDidChange((uri) => this.handleChange(uri.fsPath));
    this.watchers.push(indexWatcher);

    // 监听 images/ 目录
    const imagesPattern = new vscode.RelativePattern(
      vscode.Uri.file(this.storageRoot),
      'images/*'
    );
    const imagesWatcher = vscode.workspace.createFileSystemWatcher(imagesPattern);
    imagesWatcher.onDidCreate((uri) => this.handleChange(uri.fsPath));
    imagesWatcher.onDidDelete((uri) => this.handleChange(uri.fsPath));
    this.watchers.push(imagesWatcher);
  }

  private handleChange(filePath: string): void {
    // 忽略自写标记文件本身的变更
    const rel = path.relative(this.storageRoot, filePath).replace(/\\/g, '/');
    if (rel === LAST_WRITE_FILE) {
      return;
    }

    const category = categorizeFile(filePath, this.storageRoot);
    if (!category) { return; }

    this.pendingCategories.add(category);

    // 清除旧定时器，重新防抖
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.flushPending();
    }, DEBOUNCE_MS);
  }

  private async flushPending(): Promise<void> {
    if (this.pendingCategories.size === 0) { return; }
    if (this.flushInProgress) { return; }
    this.flushInProgress = true;

    try {
    // 检查自写标记：如果是本 IDE 写入的，则忽略
    if (await this.isSelfWrite()) {
      this.pendingCategories.clear();
      return;
    }

    const categories = new Set(this.pendingCategories);

    // 智能延迟策略：只有 sessions 变更在生成中才延迟
    // core/settings/images 变更低干扰，生成中也立即触发
    if (this.callbacks.getIsGenerating()) {
      const nonSessionCats = new Set(categories);
      nonSessionCats.delete('sessions');

      if (nonSessionCats.size > 0) {
        // 有非 session 变更：立即触发非 session 部分
        for (const cat of nonSessionCats) {
          categories.delete(cat);
        }
        this.callbacks.onExternalChange(nonSessionCats);
      }

      if (categories.has('sessions')) {
        // sessions 变更留在 pending 中，生成结束后再触发
        this.pendingNotifyOnIdle = true;
        // 只保留 sessions 在 pending 中
        this.pendingCategories.clear();
        this.pendingCategories.add('sessions');
        return;
      }

      // 所有类别都已处理
      this.pendingCategories.clear();
      return;
    }

    this.pendingCategories.clear();
    this.callbacks.onExternalChange(categories);
    } finally {
      this.flushInProgress = false;
      // 如果 flush 期间有新变更进入 pendingCategories，安排新一轮处理
      if (this.pendingCategories.size > 0) {
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = undefined;
          this.flushPending();
        }, DEBOUNCE_MS);
      }
    }
  }

  /**
   * 检查最近的写入是否来自本 IDE 实例。
   * 读取 .last-write.json 并比较 ideId。
   */
  private async isSelfWrite(): Promise<boolean> {
    const markerPath = path.join(this.storageRoot, LAST_WRITE_FILE);
    try {
      const content = await fs.promises.readFile(markerPath, 'utf-8');
      const marker = JSON.parse(content) as { ideId?: string; timestamp?: number };
      if (marker.ideId === this.ideId) {
        return true;
      }
    } catch {
      // 标记文件不存在或读取失败，视为非自写
    }
    return false;
  }

  /** 生成结束时调用，检查是否有待处理的变更通知 */
  notifyGeneratingEnded(): void {
    if (this.pendingNotifyOnIdle) {
      this.pendingNotifyOnIdle = false;
      this.flushPending();
    }
  }

  /**
   * 写入自写标记文件，用于其他 IDE 实例识别这是本 IDE 的写入。
   * 应在每次 persist 成功后调用。
   */
  async writeSelfWriteMarker(writtenFiles: string[]): Promise<void> {
    const markerPath = path.join(this.storageRoot, LAST_WRITE_FILE);
    const marker = {
      ideId: this.ideId,
      timestamp: Date.now(),
      writtenFiles
    };
    try {
      await fs.promises.mkdir(path.dirname(markerPath), { recursive: true });
      // 原子写入：先写临时文件再重命名，防止崩溃导致标记文件损坏
      const tempPath = `${markerPath}.tmp`;
      await fs.promises.writeFile(tempPath, JSON.stringify(marker, null, 2), 'utf-8');
      await fs.promises.rename(tempPath, markerPath);
    } catch {
      // 标记文件写入失败不影响主流程
    }
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.pendingNotifyOnIdle = false;
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers.length = 0;
    this.pendingCategories.clear();
  }
}
