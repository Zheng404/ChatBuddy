# ChatBuddy 存储文档

> 最后更新：2026-04-28

本文档描述 ChatBuddy 的数据持久化机制，包括 Compass 结构化存储格式、文件布局、迁移策略和备份恢复。

---

## 目录

- [存储演进](#存储演进)
- [Compass 存储架构](#compass-存储架构)
- [文件布局](#文件布局)
- [核心模块](#核心模块)
- [迁移机制](#迁移机制)
- [备份与恢复](#备份与恢复)
- [数据验证](#数据验证)
- [故障恢复](#故障恢复)

---

## 存储演进

ChatBuddy 的存储经历了三代演进：

| 版本 | 存储方式 | 状态 | 说明 |
|------|----------|------|------|
| v1 | VS Code `globalState` | 已废弃 | VS Code 的 Memento 存储，4MB 限制 |
| v2 | SQLite (sql.js) | 已废弃 | 单文件 SQLite 数据库，通过 sql.js 操作 |
| v3 | **Compass 结构化存储** | 当前 | 多文件 JSON + JSONL 结构 |

---

## Compass 存储架构

Compass 采用**多文件结构化存储**设计，将不同类型的数据分离到独立的文件中，解决了 VS Code `globalState` 的 4MB 限制问题。

### 设计原则

1. **原子写入**：所有写操作通过 "写临时文件 → 重命名" 两步完成，防止数据损坏
2. **分离敏感数据**：API Key 单独存储，与状态数据分离
3. **向后兼容**：支持从旧版 SQLite 自动迁移
4. **可验证**：每次加载时验证数据完整性

### 存储根目录

```
{ExtensionContext.globalStorageUri.fsPath}/
├── meta/                          ← 元数据和状态文件
│   ├── state.core.json            ← 核心状态（分组 + 助手）
│   ├── ui.selection.json          ← UI 选择状态
│   ├── settings.general.json      ← 通用设置
│   ├── settings.model-config.json ← 模型配置（Provider + 模型列表）
│   ├── settings.default-models.json ← 默认模型绑定
│   ├── settings.mcp.json          ← MCP 设置
│   ├── providers.api-keys.json    ← Provider API Key（敏感数据）
│   ├── kv.compass.json            ← 键值存储（兼容性数据）
│   ├── state.commit.json          ← 提交标记（验证用）
│   └── chatbuddy.migration.compass.json ← 迁移记录
│
├── images/                        ← 图片文件存储（base64 数据）
│   └── {sessionId}_{messageId}_{index}.{ext} ← 单张图片文件
│
└── sessions/                      ← 会话数据
    ├── index.compass.json         ← 会话索引
    └── {assistantId}/
        └── {sessionId}.jsonl      ← 会话消息（每行一个 JSON 对象）
```

---

## 文件布局

### 结构化状态文件

状态被拆分为 6 个独立的 JSON 文件：

#### `state.core.json`

包含应用的核心实体数据：

```json
{
  "groups": [
    {
      "id": "group_default",
      "name": "默认",
      "kind": "default",
      "createdAt": 1713500000000,
      "updatedAt": 1713500000000
    }
  ],
  "assistants": [
    {
      "id": "asst_xxx",
      "name": "通用助手",
      "groupId": "group_default",
      "systemPrompt": "",
      "greeting": "",
      "questionPrefix": "",
      "modelRef": "provider_xxx|model_xxx",
      "temperature": 0.7,
      "topP": 1,
      "maxTokens": 4000,
      "contextCount": 10,
      "presencePenalty": 0,
      "frequencyPenalty": 0,
      "streaming": true,
      "enabledMcpServerIds": [],
      "pinned": false,
      "isDeleted": false,
      "createdAt": 1713500000000,
      "updatedAt": 1713500000000,
      "lastInteractedAt": 1713500000000
    }
  ]
}
```

#### `ui.selection.json`

包含用户的 UI 选择状态：

```json
{
  "selectedAssistantId": "asst_xxx",
  "selectedSessionIdByAssistant": {
    "asst_xxx": "sess_xxx"
  },
  "sessionPanelCollapsed": false,
  "collapsedGroupIds": []
}
```

#### `settings.general.json`

通用聊天设置：

```json
{
  "temperature": 0.7,
  "topP": 1,
  "maxTokens": 4000,
  "presencePenalty": 0,
  "frequencyPenalty": 0,
  "timeoutMs": 60000,
  "streamingDefault": true,
  "locale": "auto",
  "sendShortcut": "enter",
  "chatTabMode": "single"
}
```

#### `settings.model-config.json`

Provider 和模型配置（不含 API Key）：

```json
{
  "providers": [
    {
      "id": "provider_xxx",
      "kind": "openai",
      "name": "OpenAI",
      "apiKey": "",
      "baseUrl": "https://api.openai.com/v1",
      "apiType": "chat_completions",
      "enabled": true,
      "models": [
        {
          "id": "gpt-4o",
          "name": "GPT-4o",
          "source": "fetched"
        }
      ]
    }
  ]
}
```

#### `settings.default-models.json`

默认模型绑定：

```json
{
  "defaultModels": {
    "assistant": { "providerId": "xxx", "modelId": "xxx" },
    "titleSummary": { "providerId": "xxx", "modelId": "xxx" },
    "titleSummaryPrompt": ""
  }
}
```

#### `settings.mcp.json`

MCP 服务器配置：

```json
{
  "mcp": {
    "servers": [
      {
        "id": "mcp_xxx",
        "name": "文件系统",
        "enabled": true,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        "cwd": "",
        "env": [],
        "url": "",
        "headers": [],
        "timeoutMs": 60000,
        "remotePassthroughEnabled": false
      }
    ],
    "maxToolRounds": 10
  }
}
```

### 会话存储

#### `sessions/index.compass.json`

会话索引文件，存储所有会话的元数据：

```json
{
  "sessions": [
    {
      "id": "sess_xxx",
      "assistantId": "asst_xxx",
      "title": "未命名会话",
      "titleSource": "default",
      "createdAt": 1713500000000,
      "updatedAt": 1713500000000,
      "messageCount": 5,
      "preview": "最后一条消息预览..."
    }
  ]
}
```

#### `sessions/{assistantId}/{sessionId}.jsonl`

会话消息以 JSON Lines 格式存储，每行一个消息对象：

```jsonl
{"id":"msg_1","role":"user","content":"你好","timestamp":1713500000000}
{"id":"msg_2","role":"assistant","content":"你好！有什么可以帮你的？","timestamp":1713500001000,"model":"gpt-4o"}
```

消息格式支持以下可选字段：
- `model` — 响应该消息的模型 ID
- `reasoning` — 推理过程内容
- `toolRounds` — 工具调用回合（序列化为 JSON 字符串存储）
- `images` — 图片附件数组，每个元素包含 `base64`（运行时填充）、`mimeType` 和可选的 `path`（持久化时 base64 被清空，仅保留 `path` 指向 `images/` 目录中的文件）
- `files` — 文件附件数组，每个元素包含 `name`、`content` 和可选的 `language`

### 提交标记文件

#### `state.commit.json`

用于验证结构化状态完整性的标记文件：

```json
{
  "name": "compass-structured-state",
  "layoutVersion": 3,
  "generation": 42,
  "writtenAt": "2026-04-21T10:00:00.000Z"
}
```

- `layoutVersion` — 存储布局版本号（当前为 3）
- `generation` — 单调递增的写入世代号
- `writtenAt` — ISO 8601 时间戳

### API Key 存储

#### `providers.api-keys.json`

Provider API Key 单独存储（与状态分离）：

```json
{
  "provider_xxx": "sk-xxxxxxxx"
}
```

### 迁移记录

#### `chatbuddy.migration.compass.json`

记录存储迁移历史：

```json
{
  "name": "compass",
  "layoutVersion": 3,
  "source": "sqlite",
  "migratedAt": "2026-04-01T00:00:00.000Z",
  "legacyPath": "/path/to/chatbuddy.sqlite"
}
```

`source` 可能的值：
- `fresh` — 全新安装，无历史数据
- `sqlite` — 从 SQLite 数据库迁移
- `existing-compass` — 从旧版 Compass 格式迁移
- `existing-structured` — 已有结构化格式数据

---

## 核心模块

### `CompassPaths` (`paths.ts`)

定义所有 Compass 存储文件的路径常量，通过 `createCompassPaths(globalStoragePath)` 生成路径对象。

### `CompassSettingsStore` (`settingsStore.ts`)

管理结构化状态文件的读写，核心职责：

- **加载**：从 6 个 JSON 文件并行加载，验证结构
- **持久化**：原子写入 6 个文件 + 提交标记
- **转换**：`PersistedStateLite` ↔ `StructuredStateDocument` 双向转换
- **兼容层**：支持旧版单文件 JSON 状态（`legacyStatePayload`）
- **API Key 管理**：单独读写 `providers.api-keys.json`

### `CompassSessionStore` (`sessionStore.ts`)

管理会话数据的读写，核心职责：

- **加载**：读取索引文件 + 所有 `.jsonl` 会话文件
- **持久化**：原子写入索引 + 清理孤儿文件
- **CRUD**：会话的创建、读取、更新、删除、搜索
- **消息操作**：追加、更新、截断、删除消息
- **验证**：检查索引完整性、文件一致性

### `CompassKvStore` (`kvStore.ts`)

简单的键值存储，用于兼容性数据：

- 数据存储在 `kv.compass.json` 中
- 仅支持字符串值
- 用于存储少量非结构化数据

### `CompassMigrator` (`migrator.ts`)

负责存储迁移的决策和执行：

```
migrateIfNeeded()
    │
    ├── 读取迁移标记
    │
    ├── 有当前版本标记？
    │   ├── 是 → 严格验证快照 → 清理旧 SQLite
    │   └── 否 → 继续
    │
    ├── 宽松验证快照
    │   ├── 无效 → 尝试从 SQLite 恢复
    │   └── 有效 → 继续
    │
    ├── 检测到结构化格式？
    │   ├── 是 → 持久化 → 写标记
    │   └── 否 → 继续
    │
    ├── 有旧版 Compass payload？
    │   ├── 是 → 迁移到结构化 → 持久化 → 写标记
    │   └── 否 → 继续
    │
    ├── 有 SQLite 数据库？
    │   ├── 是 → 加载数据 → 持久化 → 写标记 (source=sqlite)
    │   └── 否 → 继续
    │
    ├── 有内存数据？
    │   ├── 是 → 持久化 → 写标记 (source=existing-compass)
    │   └── 否 → 写标记 (source=fresh)
    │
    └── 完成
```

### IO 工具 (`io.ts`)

Compass 存储的原子 I/O 工具集：

| 函数 | 说明 |
|------|------|
| `writeTextAtomic()` | 先写 `.tmp` 文件，再 `rename` 到目标路径 |
| `writeJsonAtomic()` | `writeTextAtomic()` 的 JSON 封装 |
| `readJsonFile()` | 读取 JSON 文件，ENOENT 返回 `undefined`，解析失败返回 `undefined` |
| `readTextFile()` | 读取文本文件，ENOENT 返回 `undefined` |
| `fileExists()` | 检查文件是否存在 |
| `ensureDir()` | 递归创建目录 |
| `removeFileIfExists()` | 安全删除文件（忽略 ENOENT） |
| `listFilesRecursively()` | 递归列出匹配后缀的文件 |
| `moveDirectoryContents()` | 安全移动目录内容（跳过已存在文件） |
| `removeEmptyDirectoriesRecursively()` | 递归清理空目录 |

---

## 迁移机制

### 从 SQLite 迁移

当检测到 `chatbuddy.sqlite` 文件存在时：

1. 使用 sql.js 加载 SQLite 数据库
2. 查询 `sessions_meta`、`messages`、`kv` 三个表
3. 将数据导入到 `CompassSessionStore` 和 `CompassKvStore`
4. 将 KV 中的状态 JSON 解析并转换为结构化格式
5. 持久化到 Compass 文件
6. 删除 SQLite 数据库文件
7. 写入迁移标记

### 从旧版 Compass 迁移

当检测到旧版 Compass 单文件状态（`state.compass.json`）时：

1. 解析旧版 JSON
2. 转换为 `PersistedStateLite`
3. 通过 `persistedStateLiteToStructuredStateDocument()` 转换为结构化文档
4. 持久化到多个结构化文件
5. 写入迁移标记

---

## 备份与恢复

### 备份格式

备份是一个 ZIP 压缩文件，内部结构：

```
chatbuddy-backup-2026-04-21-10-00-00.zip
└── chatbuddy.backup.compass
    ├── schema: "chatbuddy.backup.compass"
    ├── version: 2
    ├── exportedAt: "2026-04-21T10:00:00.000Z"
    └── storage:
        ├── layout: "compass"
        ├── layoutVersion: 3
        ├── structuredState: { ...StructuredStateDocument... }
        ├── providerApiKeys: { "providerId": "key" }
        ├── sessions: [ ...ChatSession[]... ]
        └── kv: { "key": "value" }
```

### 导出流程

1. `repository.exportBackupData()` 收集所有数据
2. `createBackupArchive()` 将数据压缩为 ZIP
3. 用户选择保存路径，写入文件

### 导入流程

1. 用户选择 ZIP 文件
2. `extractBackupPayloadFromArchive()` 解压并解析 JSON
3. `repository.importBackupData()` 验证并导入
   - 验证 schema 和 version
   - 导入结构化状态
   - 导入会话数据
   - 导入 API Key
4. 触发 `refreshAll()` 刷新所有视图

### 旧版 JSON 导入

支持直接导入旧版单文件 JSON 备份（非 ZIP），用于兼容早期版本。

---

## 数据验证

### 启动时验证

每次扩展激活时，`CompassMigrator` 执行以下验证：

1. **迁移标记检查**：确认存储版本是否匹配
2. **结构化状态完整性**：所有 6 个状态文件是否齐全
3. **提交标记验证**：`state.commit.json` 是否存在且格式正确
4. **会话索引验证**：`index.compass.json` 是否为有效 JSON，会话是否有 `id` 和 `assistantId`
5. **会话文件验证**：每个索引中的会话对应的 `.jsonl` 文件是否存在，内容是否为有效 JSONL
6. **KV 验证**：`kv.compass.json` 是否为有效的字符串键值对象

### 验证失败处理

如果验证失败且存在 SQLite 数据库：
- 自动回退到 SQLite 数据库
- 从 SQLite 重新加载数据
- 再次尝试持久化到 Compass

如果验证失败且无 SQLite 数据库：
- 抛出错误，阻止扩展激活

---

## 故障恢复

### 场景 1：结构化文件部分损坏

如果某个结构化状态文件损坏（如被截断的 JSON）：
- 启动验证会检测到结构不完整
- 如果有 SQLite 备份，自动回退恢复
- 如果无备份，需要用户手动导入备份

### 场景 2：会话索引丢失

如果 `index.compass.json` 丢失但会话文件存在：
- 验证失败，报告 "Session index is missing while session files still exist"
- 触发 SQLite 回退（如果存在）

### 场景 3：孤儿会话文件

如果存在未被索引引用的 `.jsonl` 文件：
- 验证失败，报告 "Found orphan session file not referenced by the index"
- `persist()` 时会自动清理孤儿文件

### 场景 4：写入过程中断电/崩溃

由于所有写操作都是原子写入（先写 `.tmp` 再重命名）：
- 写入中的 `.tmp` 文件不会影响已有数据
- 下次启动时，损坏的 `.tmp` 文件会被忽略
- 数据保持一致性

---

## 版本兼容性

| 布局版本 | 说明 |
|----------|------|
| 1 | 初始 Compass 格式（单文件状态 + JSONL 会话） |
| 2 | 引入结构化拆分 |
| 3 | 当前版本，引入 `state.commit.json` 提交标记 |

如果检测到比当前支持的版本更新的 `layoutVersion`，拒绝加载并提示用户升级扩展。
