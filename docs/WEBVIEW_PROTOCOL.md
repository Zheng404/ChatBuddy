# ChatBuddy WebView 通信协议

> 最后更新：2026-06-14

本文档描述 ChatBuddy 中 Extension Host 与 WebView 之间的双向消息协议。

ChatBuddy 使用三套独立的 WebView 通信协议：
1. **聊天面板协议** — `ChatController` ↔ 聊天 WebView
2. **设置中心协议** — `SettingsCenterPanelController` ↔ 设置中心 WebView
3. **侧边栏协议** — `BaseSidebarViewProvider` ↔ 4 个侧边栏 Webview View（settings / assistants / recycleBin / sessions）

---

## 目录

- [聊天面板协议](#聊天面板协议)
  - [WebView → Extension (Inbound)](#webview--extension-inbound)
  - [Extension → WebView (Outbound)](#extension--webview-outbound)
  - [状态载荷 (ChatStatePayload)](#状态载荷-chatstatepayload)
  - [完整通信流程](#完整通信流程)
- [设置中心协议](#设置中心协议)
- [侧边栏 Webview 通信协议](#侧边栏-webview-通信协议)
- [安全机制](#安全机制)

---

## 聊天面板协议

聊天 WebView 通过 `vscode-webview:` URI 方案加载，由 `getChatWebviewHtml()` 生成 HTML。通信通过 `WebviewPanel.webview.postMessage()` 和 `window.addEventListener('message')` 实现。

### WebView → Extension (Inbound)

WebView 向 Extension Host 发送的消息类型：

| 消息类型 | 参数 | 说明 |
|----------|------|------|
| `ready` | 无 | WebView 加载完成，请求初始状态 |
| `createSession` | 无 | 创建新会话 |
| `selectSession` | `sessionId: string` | 切换到指定会话 |
| `renameSession` | `sessionId: string, title: string` | 重命名会话 |
| `deleteSession` | `sessionId: string` | 删除会话 |
| `setSessionTempModel` | `modelRef: string` | 临时切换当前会话的模型 |
| `toggleSessionPanel` | 无 | 切换会话侧边栏折叠状态 |
| `regenerateReply` | 无 | 重新生成最后一条助手回复 |
| `regenerateFromMessage` | `messageId: string` | 从指定消息重新生成 |
| `copyMessage` | `messageId: string` | 复制指定消息内容到剪贴板 |
| `deleteMessage` | `messageId: string` | 删除指定消息 |
| `editMessage` | `messageId: string, newContent: string, regenerate?: boolean` | 编辑消息内容 |
| `clearSession` | 无 | 清空当前会话的所有消息 |
| `setStreaming` | `enabled: boolean` | 切换流式输出开关 |
| `sendMessage` | `content: string, images?: Array<{ base64: string, mimeType: string }>, files?: Array<{ name: string, content: string, language?: string }>` | 发送用户消息（支持图片和文件） |
| `continueToolCalls` | 无 | 确认继续执行挂起的工具调用 |
| `cancelToolCalls` | 无 | 取消挂起的工具调用 |
| `listMcpResources` | 无 | 请求列出所有 MCP 资源 |
| `listMcpPrompts` | 无 | 请求列出所有 MCP Prompts |
| `readMcpResource` | `serverId: string, uri: string` | 读取指定 MCP 资源 |
| `getMcpPrompt` | `serverId: string, name: string, args: Record<string, string>` | 获取指定 MCP Prompt |
| `stopGeneration` | 无 | 停止当前生成 |

### Extension → WebView (Outbound)

Extension Host 向 WebView 发送的消息类型：

| 消息类型 | 载荷 | 说明 |
|----------|------|------|
| `state` | `payload: ChatStatePayload` | 完整状态更新 |
| `error` | `message: string` | 错误提示 |
| `mcpResources` | `items: McpResourceEntry[], message?: string` | MCP 资源列表 |
| `mcpPrompts` | `items: McpPromptEntry[], message?: string` | MCP Prompt 列表 |
| `mcpInsert` | `content: string, message?: string` | 插入 MCP 内容到输入框 |
| `prefillComposer` | `content: string` | 预填充输入框内容 |
| `toast` | `message: string, tone?: 'success' \| 'error' \| 'info'` | 显示 Toast 通知 |

### 状态载荷 (ChatStatePayload)

`state` 消息携带的完整状态对象，是 WebView 渲染的唯一数据源：

```ts
interface ChatStatePayload {
  // === 核心数据 ===
  groups: AssistantGroup[];              // 所有分组
  assistants: AssistantProfile[];        // 所有助手
  selectedAssistant?: AssistantProfile;  // 当前选中的助手
  selectedAssistantId?: string;

  // === 会话数据 ===
  sessions: ChatSessionSummary[];        // 当前助手的会话列表
  selectedSessionId?: string;
  selectedSession?: ChatSessionDetail;   // 当前会话完整数据（含消息）

  // === UI 状态 ===
  sessionPanelCollapsed: boolean;        // 会话面板是否折叠
  locale: RuntimeLocale;                 // 当前语言
  strings: RuntimeStrings;               // 本地化字符串表

  // === 模型信息 ===
  providerLabel: string;                 // 当前 Provider 显示名称
  modelLabel: string;                    // 当前模型显示名称
  modelOptions: ProviderModelOption[];   // 所有可用模型选项
  sessionTempModelRef: string;           // 当前会话临时模型

  // === 交互状态 ===
  sendShortcut: ChatSendShortcut;        // 发送快捷键模式
  streaming: boolean;                    // 是否启用流式
  isGenerating: boolean;                // 是否正在生成中
  canChat: boolean;                     // 是否可以发送消息

  // === MCP 状态 ===
  mcpServers: McpServerSummary[];        // MCP 服务器列表
  awaitingToolContinuation: boolean;     // 是否等待工具调用确认
  pendingToolCallCount: number;          // 挂起的工具调用数量
  toolRoundLimit: number;               // 最大工具调用轮数

  // === 错误状态 ===
  readOnlyReason?: string;              // 只读模式原因
  error?: string;                       // 当前错误信息
}
```

### 完整通信流程

#### 场景 1：初始加载

```
WebView                         Extension Host
   │                                  │
   │  1. 加载完成                     │
   │ ────────── ready ──────────────>│
   │                                  │
   │                                  │  2. 构建 ChatStatePayload
   │                                  │
   │  3. 推送初始状态                 │
   │ <───────── state ──────────────│
   │                                  │
   │  4. 渲染界面                     │
```

#### 场景 2：发送消息（非流式）

```
WebView                         Extension Host
   │                                  │
   │  1. 用户点击发送                 │
   │ ─────── sendMessage ───────────>│
   │                                  │
   │                                  │  2. ChatGenerationService
   │                                  │     - 添加用户消息到 Repository
   │                                  │     - 调用 ProviderClient
   │                                  │     - 获取完整响应
   │                                  │     - 添加助手消息到 Repository
   │                                  │
   │  3. 推送更新后的状态             │
   │ <───────── state ──────────────│
   │                                  │
   │  4. 渲染新消息                   │
```

#### 场景 3：发送消息（流式）

```
WebView                         Extension Host
   │                                  │
   │  1. 用户点击发送                 │
   │ ─────── sendMessage ───────────>│
   │                                  │
   │  2. 立即推送状态（isGenerating=true）
   │ <───────── state ──────────────│
   │                                  │
   │                                  │  3. ChatGenerationService
   │                                  │     - 添加用户消息
   │                                  │     - 开始流式请求
   │                                  │
   │  4. 定时推送状态（throttled）   │
   │ <───────── state ──────────────│  (每 STREAM_STATE_POST_INTERVAL_MS)
   │                                  │
   │  5. 流式过程中更新最后助手消息   │
   │                                  │
   │  6. 流结束，推送最终状态        │
   │ <───────── state ──────────────│
   │                                  │
   │  7. 渲染完整回复                 │
```

#### 场景 4：工具调用

```
WebView                         Extension Host
   │                                  │
   │  1. 用户发送消息                 │
   │ ─────── sendMessage ───────────>│
   │                                  │
   │                                  │  2. Provider 返回 toolCalls
   │                                  │
   │  3. 推送状态（awaitingToolContinuation=true）
   │ <───────── state ──────────────│
   │                                  │
   │  4. 显示工具调用确认 UI          │
   │                                  │
   │  5. 用户点击继续                 │
   │ ────── continueToolCalls ──────>│
   │                                  │
   │                                  │  6. ToolCallOrchestrator
   │                                  │     - 执行所有工具调用
   │                                  │     - 获取结果
   │                                  │     - 再次调用 Provider
   │                                  │
   │  7. 推送最终状态                 │
   │ <───────── state ──────────────│
```

#### 场景 5：MCP 资源/Prompt 交互

```
WebView                         Extension Host
   │                                  │
   │  1. 用户请求列出资源             │
   │ ───── listMcpResources ────────>│
   │                                  │
   │                                  │  2. McpRuntime.listResources()
   │                                  │
   │  3. 返回资源列表                 │
   │ <────── mcpResources ──────────│
   │                                  │
   │  4. 用户选择资源                 │
   │ ────── readMcpResource ────────>│
   │                                  │
   │                                  │  5. McpRuntime.readResource()
   │                                  │
   │  6. 返回资源内容                 │
   │ <─────── mcpInsert ────────────│
   │                                  │
   │  7. 将内容插入输入框             │
```

---

## 设置中心协议

设置中心使用独立的 WebViewPanel，通信协议与聊天面板不同。

### WebView → Extension

设置中心的消息通过 `messageHandler.ts` 处理，主要消息类型：

| 消息类型 | 说明 |
|----------|------|
| `settings:ready` | WebView 加载完成 |
| `settings:update` | 更新设置（通用/模型/MCP） |
| `settings:exportData` | 导出数据备份 |
| `settings:importData` | 导入数据备份 |
| `settings:importLegacyData` | 导入旧版 JSON 备份 |
| `settings:resetData` | 重置所有数据 |
| `settings:fetchModels` | 从 Provider 获取模型列表 |
| `settings:testConnection` | 测试 Provider 连接 |
| `settings:openExternal` | 打开外部链接 |
| `settings:showError` | 显示错误信息 |

### Extension → WebView

| 消息类型 | 说明 |
|----------|------|
| `settings:state` | 推送完整设置状态 |
| `settings:providers` | 推送 Provider 列表 |
| `settings:models` | 推送模型列表 |
| `settings:connectionResult` | 连接测试结果 |
| `settings:toast` | 显示 Toast |
| `settings:close` | 关闭设置面板 |

---

## 侧边栏 Webview 通信协议

4 个侧边栏 view（settings / assistants / recycleBin / sessions）均为自定义 Webview View，通过统一的轻量协议与 Extension Host 通信。所有 view 继承自抽象基类 `BaseSidebarViewProvider<TState, TMessage>`（`sidebarViewBase.ts`），消息联合类型定义在 `sidebarViewTypes.ts`。

### 协议特点

- **ready 握手**：Webview 加载完成后发送 `{type:'ready'}`，Host 收到后才推送状态；未 ready 时 `postState()` 静默丢弃，避免首屏竞态。
- **全量状态推送**：Host 通过 `{type:'state', payload}` 推送完整状态，各 view 的 `TState` 接口由各自的 provider 文件定义。
- **命令转发**：右键菜单等操作通过 `{type:'invokeCommand', command, args}` 回传 Host，Host 端命令 handler 统一为 id-based 签名。

### Webview → Host (Inbound)

| 消息类型 | 参数 | 说明 |
|----------|------|------|
| `ready` | 无 | Webview 加载完成，Host 收到后开始推送状态 |
| `invokeCommand` | `command: string, args?: unknown[]` | 转发右键菜单等命令到 Host（id-based） |
| `toggleGroupCollapse` | `groupId: string, collapsed: boolean` | 切换分组折叠状态 |
| `search` | `keyword: string` | 搜索过滤（助手/会话） |

### Host → Webview (Outbound)

| 消息类型 | 载荷 | 说明 |
|----------|------|------|
| `state` | `payload: TState` | 全量状态更新（未 ready 时静默丢弃） |
| `clearSearch` | 无 | 显式清空搜索框（reset / import 场景） |

### 通信流程

```
Webview View                        Extension Host
    │                                     │
    │  1. 加载完成                        │
    │ ────────── ready ─────────────────>│
    │                                     │
    │                                     │  2. ready 标志置位
    │                                     │     构建该 view 的 TState
    │                                     │
    │  3. 推送初始状态                    │
    │ <───────── state ─────────────────│
    │                                     │
    │  4. 用户操作（搜索/折叠/命令）      │
    │ ── search / toggleGroupCollapse ──>│
    │ ── invokeCommand ─────────────────>│
    │                                     │
    │  5. 状态变更后 refreshAll() 触发    │
    │ <───────── state ─────────────────│
    │                                     │
    │  6. reset/import 时清空搜索        │
    │ <───────── clearSearch ───────────│
```

### TypeScript 类型定义

```ts
// Host → Webview 出站消息
type SidebarOutbound<TState> =
  | { type: 'state'; payload: TState }
  | { type: 'clearSearch' };

// Webview → Host 入站消息
type SidebarInbound =
  | { type: 'ready' }
  | { type: 'invokeCommand'; command: string; args?: unknown[] }
  | { type: 'toggleGroupCollapse'; groupId: string; collapsed: boolean }
  | { type: 'search'; keyword: string };

// 侧边栏 view 种类标识
type SidebarViewKind = 'assistants' | 'sessions' | 'recycleBin' | 'settings';
```

> 参考源码：`src/chatbuddy/sidebarViewTypes.ts`、`src/chatbuddy/sidebarViewBase.ts`。

---

## 安全机制

### Content Security Policy (CSP)

聊天 WebView 使用严格的 CSP：

```
default-src 'none';
script-src {webview.cspSource} 'nonce-{nonce}';
style-src {webview.cspSource} 'unsafe-inline';
font-src {webview.cspSource};
img-src {webview.cspSource} data: blob:;
```

- 所有脚本必须携带正确的 `nonce`
- 内联样式允许（KaTeX 渲染需要）
- 图片支持 `data:` URI（Base64 图片）和 `blob:` URI

### 消息验证

Extension Host 接收 WebView 消息时不做额外验证（信任边界内），但：
- 所有用户输入在业务层进行校验和清理
- 工具调用需要用户显式确认（`confirmDangerousAction`）
- MCP 资源/Prompt 操作无副作用，不需要确认

### 状态隔离

每个 WebViewPanel 独立维护状态：
- `ChatController` 支持多面板（每个助手可有一个独立面板）
- 面板关闭时，会话数据已持久化到 Compass 存储，不会丢失
- `sessionTempModelRefBySession` 按会话隔离，切换会话时重置
