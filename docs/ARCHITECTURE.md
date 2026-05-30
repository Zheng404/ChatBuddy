# ChatBuddy 架构文档

> 最后更新：2026-05-30

本文档描述 ChatBuddy VS Code 扩展的整体架构、模块分层和数据流。

---

## 目录

- [概览](#概览)
- [模块分层](#模块分层)
- [数据流](#数据流)
- [核心模块详解](#核心模块详解)
- [WebView 渲染体系](#webview-渲染体系)
- [存储体系](#存储体系)
- [依赖关系](#依赖关系)

---

## 概览

ChatBuddy 是一个 VS Code 侧边栏扩展，提供多助手 AI 聊天功能。架构遵循**分层设计**原则，核心层与 VS Code API 解耦，通过适配层（`src/extension/`）进行桥接。

```
┌─────────────────────────────────────────────────────────────┐
│                      VS Code 宿主环境                         │
│  (TreeView, WebViewPanel, Commands, globalStorage, Events)  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│              扩展适配层 (src/extension/)                      │
│  - 命令注册（settingsCommands, sessionCommands 等）           │
│  - 共享上下文类型 (shared.ts)                                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│              扩展入口 (src/extension.ts)                      │
│  - activate/deactivate 生命周期                              │
│  - 依赖注入图的构建与组装                                     │
│  - TreeProvider / TreeView / PanelController 的实例化       │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│              业务核心层 (src/chatbuddy/)                      │
│  - 状态管理 (stateRepository)                               │
│  - 聊天控制器 (chatController)                              │
│  - 提供商客户端 (providerClient)                            │
│  - MCP 运行时 (mcpRuntime)                                  │
│  - WebView 渲染 (webview*)                                  │
│  - 设置中心 (settingsCenter*)                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 模块分层

### 1. 扩展入口层 (`src/extension.ts`)

`activate()` 函数是扩展的启动入口，负责：

1. **全局异常兜底**：注册 `unhandledRejection` 处理器，静默忽略 VS Code 生命周期中的良性错误
2. **依赖注入**：按顺序创建 Repository → ProviderClient → McpRuntime → ChatController
3. **视图构建**：创建 4 个 TreeProvider 和对应的 TreeView
4. **面板控制器**：初始化 SettingsCenterPanelController 和 AssistantEditorPanelController
5. **命令注册**：将所有命令注册到 VS Code 命令系统
6. **订阅管理**：通过 `context.subscriptions` 统一管理资源释放

关键类型：
- `ActivationTreeProviders` — 助手树、回收站树、会话树
- `ActivationTreeViews` — 4 个 TreeView 实例
- `PanelControllers` — 设置中心和助手编辑器面板控制器

### 2. 命令层 (`src/extension/`)

命令按功能域拆分为多个模块，每个模块导出一个 `register*Commands()` 函数：

| 模块 | 职责 |
|------|------|
| `settingsCommands.ts` | 打开设置、模型配置、默认模型、MCP、关于页面 |
| `navigationCommands.ts` | 打开助手聊天、树视图操作 |
| `assistantTreeCommands.ts` | 助手树的搜索、折叠、展开 |
| `assistantManagementCommands.ts` | 助手的创建、编辑、删除、置顶、分组管理 |
| `sessionCommands.ts` | 会话的创建、重命名、删除、导出、清空 |
| `localeMenuCommands.ts` | 中英文菜单别名命令注册 |

所有命令共享一个 `ExtensionContext` 接口，通过解构获取依赖：
```ts
interface ExtensionContext {
  repository: ChatStateRepository;
  chatController: ChatController;
  settingsCenterPanelController: SettingsCenterPanelController;
  assistantEditorPanelController: AssistantEditorPanelController;
  assistantsTreeProvider: AssistantsTreeProvider;
  sessionsTreeProvider: SessionsTreeProvider;
  refreshAll: () => void;
  updateTreeMessage: () => void;
  getRuntimeLocale: () => RuntimeLocale;
  getRuntimeStrings: () => RuntimeStrings;
}
```

### 3. 业务核心层 (`src/chatbuddy/`)

#### 3.1 状态管理

**`ChatStateRepository`** (`stateRepository.ts`)

单一状态源（Single Source of Truth），管理 `PersistedStateLite`：

```
PersistedStateLite
├── groups: AssistantGroup[]       ← 分组（默认、自定义、回收站）
├── assistants: AssistantProfile[] ← 助手列表
├── selectedAssistantId?: string   ← 当前选中的助手
├── selectedSessionIdByAssistant   ← 每个助手当前选中的会话
├── sessionPanelCollapsed: boolean ← 会话面板折叠状态
├── collapsedGroupIds: string[]    ← 折叠的分组 ID
└── settings: ChatBuddySettings    ← 全局设置
```

Repository 内部通过**服务拆分**管理不同领域：
- `AssistantStateService` — 助手 CRUD、分组管理、软删除/恢复
- `SessionStateService` — 会话 CRUD、消息操作
- `StatePersistenceService` — 状态持久化（读写 Compass 存储）

状态读取带**版本缓存**：`getState()` 在版本未变化时返回缓存副本，避免重复深拷贝。

#### 3.2 聊天控制器

**`ChatController`** (`chatController.ts`)

核心协调器，聚合 3 个子服务：

| 子服务 | 文件 | 职责 |
|--------|------|------|
| `ChatGenerationService` | `chatControllerGenerationService.ts` | 消息发送、流式响应、标题生成 |
| `ChatPanelManager` | `chatControllerPanelManager.ts` | WebView 面板生命周期管理 |
| `ToolCallOrchestrator` | `chatControllerToolOrchestrator.ts` | MCP/函数工具调用编排 |

ChatController 本身不处理业务细节，只负责：
- WebView 消息路由（`routeChatControllerWebviewMessage`）
- 状态载荷构建（`chatControllerPayload.ts`）
- 面板状态同步（`setActivePanelChangeCallback`）

**超时机制**：`ChatGenerationService` 和 `ToolCallOrchestrator` 在发起 AI 请求时设置全局超时（默认无限制，`timeoutMs=0`，用户可在设置中心配置）。超时仅在**首次响应等待**阶段生效——首个流式 token 到达后清除全局超时计时器，后续由 `consumeSseResponse` 的 `readWithTimeout` 检测连接中断。超时触发时先 `setAbortReason('timeout')` 再 `abort()`，确保错误处理读到正确的中止原因。当 `timeoutMs` 为 0 时，跳过超时计时器创建，请求不会因超时中断。

#### 3.3 提供商客户端

**`OpenAICompatibleClient`** (`providerClient.ts`)

统一的 OpenAI 兼容 API 客户端，支持：

| 提供商 | API 类型 | 特点 |
|--------|----------|------|
| OpenAI | chat_completions / responses | 原生支持 |
| Gemini | chat_completions / gemini | 代理适配 + 原生 API |
| OpenRouter | chat_completions | 统一路由 |
| Ollama | chat_completions | 本地模型，自动模型列表获取 |
| 自定义 | chat_completions | 任意兼容端点 |

请求构建器（`providerClientRequestBuilders.ts`）负责将内部配置转换为不同 API 的请求体。
响应解析器（`providerClientParsers.ts`）处理流式和非流式响应。

#### 3.4 MCP 运行时

**`McpRuntime`** (`mcpRuntime.ts`)

MCP (Model Context Protocol) 客户端运行时，负责：
- 服务器连接管理（stdio / SSE / streamableHttp 三种传输）
- 工具发现与调用
- 资源读取与 Prompt 获取
- 连接清理（`pruneConnections`）

MCP 模块是 ESM-only，通过动态 `import()` 在运行时加载。

---

## 数据流

### 用户发送消息的完整数据流

```
用户输入
    │
    ▼
┌──────────────┐     WebView message     ┌──────────────┐
│  Chat WebView │ ──(sendMessage)────────>│ ChatController│
└──────────────┘                          └──────┬───────┘
                                                 │
    ┌────────────────────────────────────────────┤
    │                                            ▼
    │                              ┌─────────────────────────┐
    │                              │   ChatGenerationService  │
    │                              │  - resolveProviderConfig │
    │                              │  - buildProviderMessages │
    │                              │  - startStream / complete│
    │                              └──────┬──────────────────┘
    │                                     │
    │         stream chunks               │
    │    <───────────────────────────────┤
    │                                     │
    │                              ┌──────▼──────┐
    │                              │ ProviderClient│
    │                              │  (fetch API)  │
    │                              └──────┬──────┘
    │                                     │
    ▼                                     ▼
┌──────────────────────────────────────────────────────┐
│              ChatStateRepository                      │
│  - appendMessage()                                    │
│  - updateLastAssistantMessage() (streaming)           │
│  - SessionStateService                                │
└──────────────────┬───────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────┐
│              StatePersistenceService                  │
│  - persist() → CompassSessionStore.persist()          │
│  - persistSecrets() → CompassSettingsStore.persist()  │
└──────────────────┬───────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────┐
│              Compass Storage (文件系统)               │
│  - sessions/index.compass.json                        │
│  - sessions/{assistantId}/{sessionId}.jsonl          │
└──────────────────────────────────────────────────────┘

                   │
                   │ 状态变更触发
                   ▼
            ┌─────────────┐
            │ refreshAll() │ → TreeView 刷新 + WebView state 推送
            └─────────────┘
```

### 持久化可靠性机制

`StatePersistenceService` 内置多项可靠性保障：

| 机制 | 说明 |
|------|------|
| **persistDirty 标志** | `persistScheduled` 去重期间累积变更，完成后自动重触发，防止更新丢失 |
| **API keys 独立写入** | 结构化文件与 API keys 文件分别 try-catch，互不影响 |
| **竞态保护** | `recentlyDeletedProviderIds` / `recentlyDeletedMcpServerIds` 防止 WebView 竞态重建 |

### WebView 状态同步流

```
ChatController
    │
    ├───> buildChatStatePayload() ──> ChatStatePayload
    │                                    │
    │                                    ├── groups, assistants, sessions
    │                                    ├── selectedAssistant, selectedSession
    │                                    ├── modelOptions, mcpServers
    │                                    └── locale, strings, streaming, isGenerating
    │
    ├───> panel.webview.postMessage({ type: 'state', payload })
    │
    └───> 流式过程中定时推送（throttled）
```

---

## 核心模块详解

### TreeProvider 体系

**`AssistantsTreeProvider`** (`assistantsView.ts`)

助手树数据提供器，同时服务于两个 TreeView：
- **主视图** (`assistantsView`) — 显示活跃助手（默认分组 + 自定义分组）
- **回收站视图** (`recycleBinView`) — 显示已删除的助手

节点类型：
- `group` — 分组节点（可展开/折叠）
- `assistant` — 助手节点（活跃或已删除）

**`SessionsTreeProvider`** (`sessionsView.ts`)

会话树数据提供器，显示当前选中助手的所有会话。支持搜索过滤。

### 设置中心

**`SettingsCenterPanelController`** (`settingsCenterPanel.ts`)

设置面板控制器，管理一个 WebViewPanel，内部通过 iframe 或单页应用方式渲染多个设置页面：

| 页面 | 对应 JS 模块 | 功能 |
|------|-------------|------|
| 模型配置 | `settingsCenterJs/modelConfig.ts` | Provider CRUD、模型获取 |
| 默认模型 | `settingsCenterJs/defaultModels.ts` | 默认助手模型、标题总结模型 |
| MCP | `settingsCenterJs/mcp.ts` | MCP 服务器管理 |
| 通用设置 | `settingsCenterJs/general.ts` | 快捷键、语言、超时等 |
| 公告 | `settingsCenterJs/notice.ts` | 更新日志渲染 |
| 关于 | `settingsCenterJs/about.ts` | 版本信息 |

设置中心与 Extension Host 通过 `postMessage` 双向通信。

### 助手编辑器

**`AssistantEditorPanelController`** (`assistantEditorPanel.ts`)

助手创建/编辑面板，提供表单编辑助手的所有属性：系统提示词、问候语、模型选择、温度等。

---

## WebView 渲染体系

ChatBuddy 使用 VS Code WebView API 渲染聊天界面。HTML 通过代码组装生成（无外部 HTML 文件）。

### 渲染流水线

```
getChatWebviewHtml()
    ├── getNonce() + buildCsp()           ← CSP 安全策略
    ├── getCodiconStyleText()             ← VS Code 图标字体
    ├── getChatPanelCss()                 ← 聊天面板样式
    ├── getChatBodyHtml()                 ← HTML body 结构
    └── getChatScript()                   ← JS 逻辑
            ├── webviewChatScript.ts      ← 主脚本：状态管理、消息路由
            ├── webviewChatScriptEvents.ts ← 事件处理：点击、滚动、粘贴
            ├── webviewChatScriptMarkdown.ts ← Markdown 渲染：代码高亮、KaTeX、Mermaid
            └── webviewChatScriptUi.ts    ← UI 交互：输入框、工具栏、模态框
```

### 依赖的外部库

| 库 | 用途 | 加载方式 |
|----|------|----------|
| KaTeX | 数学公式渲染 | `node_modules` 内联加载 |
| Mermaid | 流程图/时序图 | `node_modules` 内联加载 |
| Codicon | VS Code 图标字体 | 内联 CSS |

---

## 存储体系

详见 [STORAGE.md](./STORAGE.md)。

---

## 依赖关系

### 模块依赖方向

```
extension.ts (顶层组装)
    ├── extension/*.ts (命令层)
    └── chatbuddy/*.ts (业务核心)
        ├── compassStorage/ (存储)
        ├── i18n/ (国际化)
        ├── settingsCenterJs/ (设置面板前端)
        └── utils/ (工具函数)
```

### 核心禁止循环依赖

- `ChatStateRepository` 不依赖 `ChatController`
- `ChatController` 依赖 `ChatStateRepository`（单向）
- `ProviderClient` 不依赖任何上层模块
- `McpRuntime` 不依赖任何上层模块
- `CompassStorage` 不依赖任何上层模块

### 引入新 Provider 的步骤

1. 在 `types.ts` 的 `ProviderKind` 中添加新类型
2. 在 `providerClientRequestBuilders.ts` 中添加请求体构造逻辑
3. 在 `providerClientParsers.ts` 中添加响应解析逻辑
4. 在 `providerClientModelFetchers.ts` 中添加模型列表获取逻辑（如支持）
5. 在 `modelCapabilityRegistry.ts` 中注册已知模型能力

---

## 相关文档

- [AGENTS.md](../AGENTS.md) — 项目上下文、编码规范、常见任务、已知问题
- [DEVELOPMENT.md](./DEVELOPMENT.md) — 快速参考与文档索引
- [STORAGE.md](./STORAGE.md) — Compass 存储格式与迁移机制
- [WEBVIEW_PROTOCOL.md](./WEBVIEW_PROTOCOL.md) — WebView 通信协议
- [CONTRIBUTING.md](./CONTRIBUTING.md) — 开发环境搭建与贡献指南
