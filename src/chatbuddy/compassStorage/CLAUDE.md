# Compass 存储层 (Compass Storage Layer)

[根目录](../../../CLAUDE.md) > [业务核心层](../CLAUDE.md) > **compassStorage**

## 模块职责

Compass 是 ChatBuddy 的结构化存储系统，替代了原有的单文件 SQLite 数据库，采用**多文件 JSON/JSONL 格式**存储数据，具有更高的可靠性、可读性和可维护性。

**核心职责**：

1. **结构化存储**：将数据分散存储为多个专门的 JSON/JSONL 文件
2. **原子 I/O**：所有写操作通过临时文件 + 重命名实现原子性
3. **自动迁移**：启动时自动检测并从旧版 SQLite / 旧版 Compass 迁移
4. **数据验证**：读写时进行类型验证和规范化

---

## 存储结构

### 文件布局

```
.globalStorage/chatbuddy/
├── compass/
│   ├── migration.json          # 迁移标记
│   ├── state.core.json         # 核心状态（助手、分组、设置）
│   ├── state.index.json        # 会话索引（摘要列表）
│   ├── sessions/
│   │   ├── <session-id>.jsonl  # 单个会话的消息流（JSON Lines）
│   │   └── ...
│   └── settings.json           # 设置数据
└── (legacy)
    └── chatbuddy.sqlite        # 旧版 SQLite（迁移后保留）
```

### 核心文件格式

| 文件 | 格式 | 内容 |
|------|------|------|
| `state.core.json` | JSON | 助手列表、分组列表、全局设置 |
| `state.index.json` | JSON | 会话摘要索引（用于快速列表展示） |
| `sessions/*.jsonl` | JSONL | 单个会话的完整消息历史 |
| `settings.json` | JSON | 用户设置、提供商配置、MCP 配置 |
| `migration.json` | JSON | 迁移记录（版本、来源、时间） |

---

## 子模块职责

### 路径管理 (`paths.ts`)

- 定义 Compass 存储目录结构和文件路径
- 提供 `CompassPaths` 类管理所有路径
- 定义布局版本号 `COMPASS_LAYOUT_VERSION`

### I/O 操作 (`io.ts`)

- **原子写入**: `writeJsonAtomic()` — 先写临时文件再重命名
- **安全读取**: `readJsonFile()` / `readJsonlFile()` — 带错误回退
- **文件检查**: `fileExists()` — 异步存在性检查

### KV 存储 (`kvStore.ts`)

- 基于 JSON 文件的键值对存储
- 用于存储非结构化元数据
- 提供 `get()` / `set()` / `delete()` 接口

### 会话存储 (`sessionStore.ts`)

- 管理 `sessions/` 目录下的 `.jsonl` 文件
- 支持消息追加（高效，无需重写整个文件）
- 支持会话完整读取和删除

### 设置存储 (`settingsStore.ts`)

- 管理 `settings.json` 的读写
- 处理设置合并和默认值填充
- 支持版本化设置迁移
- **容错隔离**: `persist()` 中结构化文件与 API keys 文件独立 try-catch，一类失败不影响另一类
- `structuredWriteOk` 标志控制 commit 文件写入，结构化文件部分失败时跳过 commit 但仍写 API keys

### 迁移器 (`migrator.ts`)

- **检测逻辑**: 检查 `migration.json` 判断是否需要迁移
- **SQLite 迁移**: 使用 `sql.js` 读取旧版数据库
- **格式转换**: 将旧数据转换为 Compass 格式
- **验证**: 迁移后验证数据完整性

### 类型定义 (`types.ts`)

- 定义 Compass 存储的所有 TypeScript 类型
- 提供数据规范化工具函数（`toStringValue`、`toNumberValue` 等）
- 定义 `CompassMigrationRecord`、`CompassValidationResult` 等

---

## 关键设计决策

### 为什么用 JSON/JSONL 而不是 SQLite？

1. **可读性**: 纯文本格式，便于调试和数据检查
2. **版本控制友好**: 便于 diff 和手动修复
3. **无原生依赖**: sql.js 是 WASM 版本，体积大且启动慢
4. **会话追加高效**: JSONL 格式支持消息追加，无需重写整个文件

### 原子写入机制

```typescript
async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2));
  await fs.promises.rename(tempPath, filePath); // 原子操作
}
```

### 迁移策略

```
启动 → 检查 migration.json
  ├─ 存在且版本匹配 → 验证快照完整性 → 正常启动
  ├─ 存在但版本旧 → 执行格式升级 → 写入新标记
  └─ 不存在 → 检查 SQLite 存在 → 执行迁移 → 写入标记
```

---

## 对外接口

### 存储层入口 (`index.ts`)

```typescript
export { CompassPaths, COMPASS_LAYOUT_VERSION } from './paths';
export { readJsonFile, writeJsonAtomic, fileExists } from './io';
export { CompassKvStore } from './kvStore';
export { CompassSessionStore } from './sessionStore';
export { CompassSettingsStore } from './settingsStore';
export { CompassMigrator } from './migrator';
export * from './types';
```

---

## 相关文件清单

- `index.ts`: 存储层公共 API 聚合
- `paths.ts`: 路径管理与版本定义
- `io.ts`: 原子 I/O 操作
- `kvStore.ts`: 键值对存储
- `sessionStore.ts`: 会话消息存储
- `settingsStore.ts`: 设置数据存储
- `migrator.ts`: 数据迁移逻辑
- `types.ts`: 类型定义与数据规范化
