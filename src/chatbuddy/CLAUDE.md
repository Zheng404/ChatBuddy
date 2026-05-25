# 业务核心层 (Business Core Layer)

[根目录](../../CLAUDE.md) > **src/chatbuddy**

## 模块职责

业务核心层是 ChatBuddy 的核心业务逻辑层，完全独立于 VS Code API，负责：

1. **状态管理**: 单一状态源（`ChatStateRepository`），管理所有运行时状态
2. **聊天控制**: 消息发送、流式响应、工具调用编排
3. **提供商客户端**: OpenAI 兼容 API 调用、模型列表获取
4. **MCP 运行时**: MCP 服务器连接、工具/资源/Prompt 管理
5. **存储抽象**: Compass 结构化存储、迁移、I/O 操作
6. **WebView 渲染**: 聊天界面 HTML/CSS/JS 生成
7. **设置管理**: 设置中心、助手编辑器、模型配置
8. **国际化**: 中英文字符串、运行时语言切换

**核心原则**:
- **VS Code 解耦**: 本层不依赖 VS Code API，便于测试和复用
- **分层清晰**: 每个模块专注于单一职责
- **类型安全**: 充分利用 TypeScript 类型系统
- **可测试性**: 所有核心逻辑可独立测试

---

## 模块结构

### 核心模块

| 模块 | 文件 | 职责 | 依赖 |
|------|------|------|------|
| **状态仓库** | `stateRepository.ts` | 单一状态源、助手/会话 CRUD | `compassStorage/` |
| **聊天控制器** | `chatController.ts` | 消息路由、流式响应 | `stateRepository`, `providerClient`, `mcpRuntime` |
| **提供商客户端** | `providerClient.ts` | OpenAI 兼容 API 调用、故障转移链 | 无 |
| **MCP 运行时** | `mcpRuntime.ts` | MCP 服务器连接管理 | 无（ESM-only） |

### 存储层

| 模块 | 文件 | 职责 |
|------|------|------|
| **存储抽象** | `compassStorage/index.ts` | 存储层公共 API 聚合 |
| **路径管理** | `compassStorage/paths.ts` | 文件系统路径定义 |
| **I/O 操作** | `compassStorage/io.ts` | 原子读写、文件操作 |
| **KV 存储** | `compassStorage/kvStore.ts` | 键值对存储 |
| **会话存储** | `compassStorage/sessionStore.ts` | 会话数据存储 |
| **设置存储** | `compassStorage/settingsStore.ts` | 设置数据存储 |
| **迁移器** | `compassStorage/migrator.ts` | 数据迁移逻辑 |

### 渲染层

| 模块 | 文件 | 职责 |
|------|------|------|
| **WebView 主入口** | `webview.ts` | WebView 统一入口 |
| **聊天 HTML** | `webviewChatHtml.ts` | 聊天界面 HTML 生成 |
| **聊天脚本** | `webviewChatScript.ts` | 聊天界面主脚本 |
| **事件处理** | `webviewChatScriptEvents.ts` | 点击、滚动、粘贴事件 |
| **Markdown 渲染** | `webviewChatScriptMarkdown.ts` | 代码高亮、KaTeX、Mermaid |
| **UI 交互** | `webviewChatScriptUi.ts` | 输入框、工具栏、模态框 |
| **样式** | `webviewChatStyles.ts` | 聊天界面样式 |
| **基础样式** | `webviewChatBaseCss.ts` | 消息卡片、文件附件等基础布局样式 |
| **工具 CSS** | `webviewChatToolsCss.ts` | 工具栏样式 |
| **搜索模态框 CSS** | `webviewChatSearchModalCss.ts` | 搜索模态框样式 |

### 设置中心

| 模块 | 文件 | 职责 |
|------|------|------|
| **设置面板控制器** | `settingsCenterPanel.ts` | 设置面板生命周期管理 |
| **消息处理器** | `settingsMessageHandler.ts` | 设置中心消息路由 |
| **HTML 生成器** | `settingsHtmlGenerator.ts` | 设置 HTML 生成 |
| **样式** | `settingsCenterStyles.ts` | 设置中心样式 |
| **JS 逻辑** | `settingsCenterJs/` | 设置中心前端逻辑 |
| **助手编辑器** | `assistantEditorPanel.ts` | 助手编辑面板 |

### 国际化

| 模块 | 文件 | 职责 |
|------|------|------|
| **i18n 主模块** | `i18n.ts` | 国际化入口 |
| **运行时字符串** | `i18n/runtimeStrings.ts` | 运行时字符串获取 |
| **英文字符串** | `i18n/strings.en.ts` | 英文翻译 |
| **中文字符串** | `i18n/strings.zh-CN.ts` | 中文翻译 |

### 工具函数

| 模块 | 文件 | 职责 |
|------|------|------|
| **工具聚合** | `utils/index.ts` | 工具函数导出 |
| **日志** | `utils/logger.ts` | 日志工具 |
| **重试** | `utils/retry.ts` | 指数退避重试 |
| **模板** | `utils/template.ts` | 模板字符串解析 |
| **守卫** | `utils/guard.ts` | 类型守卫 |
| **数学** | `utils/math.ts` | 数学工具 |
| **ID 生成** | `utils/id.ts` | 唯一 ID 生成 |
| **HTML 工具** | `utils/html.ts` | HTML 转义 |
| **CSP 工具** | `utils/csp.ts` | CSP 策略构建 |
| **错误处理** | `utils/error.ts` | 错误工具 |

---

## 入口与启动

### 状态仓库初始化

**`ChatStateRepository`** 是业务核心层的入口点，负责初始化所有状态：

```typescript
const repository = new ChatStateRepository(context);
await repository.initialize();
```

**初始化流程**:
1. **加载持久化状态**: 从 Compass 存储加载 `PersistedStateLite`
2. **迁移处理**: 自动从旧版 SQLite 迁移到 Compass 格式
3. **服务初始化**: 初始化 `AssistantStateService`、`SessionStateService`、`StatePersistenceService`
4. **版本缓存**: 初始化状态缓存机制

### 聊天控制器初始化

```typescript
const chatController = new ChatController(
  repository,
  providerClient,
  mcpRuntime,
  context.extensionUri
);
```

**子服务初始化**:
- `ChatGenerationService`: 消息发送、流式响应
- `ChatPanelManager`: WebView 面板生命周期管理
- `ToolCallOrchestrator`: 工具调用编排

---

## 对外接口

### 状态仓库 (`ChatStateRepository`)

提供状态读取、助手/会话 CRUD、持久化操作。详见 `stateRepository.ts`。

### 聊天控制器 (`ChatController`)

提供面板管理、设置应用、WebView 消息路由。详见 `chatController.ts`。

### 提供商客户端 (`OpenAICompatibleClient`)

提供非流式/流式 API 调用、模型列表获取。详见 `providerClient.ts`。

### MCP 运行时 (`McpRuntime`)

提供服务器探测、工具调用、资源读取、Prompt 获取、连接管理。详见 `mcpRuntime.ts`。

---

## 关键依赖与配置

### 内部依赖关系

```
stateRepository
    ├── compassStorage/ (存储层)
    ├── stateClone (状态克隆)
    ├── stateSanitizers (状态清理)
    └── stateHelpers (状态辅助)

chatController
    ├── stateRepository (状态管理)
    ├── providerClient (API 调用)
    ├── mcpRuntime (工具调用)
    ├── webview* (渲染)
    └── i18n/ (国际化)

providerClient
    ├── providerClientRequestBuilders (请求构建)
    ├── providerClientParsers (响应解析)
    ├── providerClientModelFetchers (模型获取)
    └── modelCatalog (模型目录)

mcpRuntime
    ├── mcpTypes (类型定义)
    ├── mcpUtils (工具函数)
    └── @modelcontextprotocol/client (MCP 客户端库)
```

### 外部依赖

- **sql.js**: 旧版 SQLite 数据库读取（迁移用）
- **zod**: 运行时类型验证
- **katex**: 数学公式渲染
- **mermaid**: 图表渲染
- **@modelcontextprotocol/client**: MCP 客户端库（ESM-only）

---

## 数据模型

核心类型定义在 `types.ts` 中：`AssistantProfile`、`ChatSessionDetail`、`ChatMessage`、`ChatMessageImage`、`ChatMessageFile`、`ChatBuddySettings`、`ProviderProfile`、`McpServerProfile` 等。详细字段定义请参阅源文件。

---

## 测试与质量

`src/test/` 目录包含 21 个测试文件，覆盖所有核心模块（状态管理、聊天控制器、提供商客户端、MCP 运行时、存储、工具函数等）。

运行 `npm run test:coverage` 查看覆盖率报告。

---

## 常见问题 (FAQ)

### Q1: 为什么业务核心层不依赖 VS Code API？

为了提高可测试性和可复用性。不依赖 VS Code API 可以在 Node.js 环境中直接运行单元测试，无需模拟 VS Code 环境。

### Q2: 如何添加新的 Provider？

1. 在 `types.ts` 的 `ProviderKind` 中添加新类型
2. 在 `providerClientRequestBuilders.ts` 中添加请求体构造逻辑
3. 在 `providerClientParsers.ts` 中添加响应解析逻辑
4. 在 `providerClientModelFetchers.ts` 中添加模型列表获取逻辑（如支持）
5. 在 `modelCapabilityRegistry.ts` 中注册已知模型能力

---

## 相关文件清单

### 核心模块

- `stateRepository.ts`: 状态仓库
- `chatController.ts`: 聊天控制器
- `providerClient.ts`: 提供商客户端
- `mcpRuntime.ts`: MCP 运行时
- `types.ts`: 核心类型定义
- `constants.ts`: 常量定义
- `schemas.ts`: Zod 模式定义

### 存储层

- `compassStorage/index.ts`: 存储层入口
- `compassStorage/paths.ts`: 路径管理
- `compassStorage/io.ts`: I/O 操作
- `compassStorage/kvStore.ts`: KV 存储
- `compassStorage/sessionStore.ts`: 会话存储
- `compassStorage/settingsStore.ts`: 设置存储
- `compassStorage/migrator.ts`: 迁移器
- `compassStorage/types.ts`: 存储层类型

### 渲染层

- `webview.ts`: WebView 入口
- `webviewChatHtml.ts`: 聊天 HTML
- `webviewChatScript.ts`: 聊天脚本
- `webviewChatScriptEvents.ts`: 事件处理
- `webviewChatScriptMarkdown.ts`: Markdown 渲染
- `webviewChatScriptUi.ts`: UI 交互
- `webviewChatStyles.ts`: 聊天样式

### 设置中心

- `settingsCenterPanel.ts`: 设置面板
- `settingsMessageHandler.ts`: 消息处理
- `settingsHtmlGenerator.ts`: HTML 生成
- `settingsCenterStyles.ts`: 设置样式
- `settingsCenterJs/`: 设置 JS 逻辑
- `assistantEditorPanel.ts`: 助手编辑器

### 工具函数

- `utils/index.ts`: 工具导出
- `utils/logger.ts`: 日志
- `utils/retry.ts`: 重试
- `utils/template.ts`: 模板
- `utils/guard.ts`: 守卫
- `utils/math.ts`: 数学
- `utils/id.ts`: ID 生成
- `utils/html.ts`: HTML 工具
- `utils/csp.ts`: CSP 工具
- `utils/error.ts`: 错误处理
