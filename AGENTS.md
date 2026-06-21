# ChatBuddy

ChatBuddy 是一个 VS Code 扩展，提供多助手 AI 聊天功能。支持 OpenAI 兼容 API、MCP 工具调用、流式响应和多模态聊天。

## 技术栈

- **语言**: TypeScript ^5.3.0，严格模式
- **运行时**: Node.js >= 20.x，VS Code Extension Host
- **模块系统**: Node16 / ESM（`"module": "Node16"`）
- **UI**: VS Code WebView API（无外部 HTML 文件，全部代码生成）
- **存储**: Compass 结构化存储（JSON + JSONL），不使用 SQLite
- **测试**: Node.js 原生测试运行器（`node --test`），运行 `npm run test:unit` 查看实时统计

## 架构

采用**分层架构**，业务核心层与 VS Code API 解耦：

```
VS Code API
    ↑
extension/ — 适配层（命令注册、侧边栏 WebviewView、面板控制器）
    ↑
chatbuddy/ — 业务核心层（状态、聊天、提供商、MCP、存储、渲染）
```

### 核心模块

| 模块 | 文件 | 职责 |
|------|------|------|
| **状态管理** | `stateRepository.ts` + 3 个子服务 | 单一状态源 `ChatStateRepository`，带版本缓存 |
| **聊天控制器** | `chatController.ts` + 7 个子模块 | 消息路由、流式响应、工具调用编排 |
| **提供商客户端** | `providerClient.ts` + 6 个子模块 | OpenAI 兼容 API，支持故障转移链 |
| **MCP 运行时** | `mcpRuntime.ts` | MCP 服务器连接（stdio/SSE/HTTP），ESM-only |
| **存储层** | `compassStorage/` | 多文件 JSON/JSONL 结构化存储，原子写入 |
| **渲染层** | `webview*.ts` | WebView HTML/CSS/JS 代码生成 |
| **侧边栏视图** | `sidebarView*.ts` + `sidebarViewJs/` | 4 个侧边栏 WebviewViewProvider（设置/助手/回收站/会话） |
| **设置中心** | `settingsCenter*.ts` | 设置面板 + 助手编辑器 |
| **国际化** | `i18n/` | 中英双语，运行时切换 |
| **工具函数** | `utils/` | 纯函数优先，零外部依赖 |

### 关键约束

- **禁止循环依赖**: `ChatStateRepository` 不依赖 `ChatController`（单向依赖）
- **状态刷新**: 所有视图刷新必须通过 `refreshAll()` 触发，禁止直接操作侧边栏 WebviewView Provider
- **WebView 安全**: 严格 CSP 策略，不使用 `eval` 或 `innerHTML`，所有用户输入必须 `escapeHtml`
- **原子写入**: Compass 存储所有写操作通过 `.tmp` + `rename` 实现
- **MCP 加载**: `@modelcontextprotocol/client` 是 ESM-only，必须通过动态 `import()` 加载

## 目录结构

```
src/
├── extension.ts              # 扩展入口，依赖注入组装
├── extension/                # 适配层
│   ├── commands.ts           # 命令注册聚合
│   ├── panelControllers.ts   # 面板控制器
│   ├── sidebarViewProviders.ts # 侧边栏 WebviewViewProvider 工厂
│   └── *Commands.ts          # 各域命令模块
├── chatbuddy/                # 业务核心层
│   ├── types.ts              # 全局类型定义
│   ├── constants.ts          # 常量
│   ├── schemas.ts            # Zod 模式
│   ├── stateRepository.ts    # 状态仓库主入口
│   ├── stateRepository*.ts   # 3 个领域子服务 + 导入导出 + 辅助工具
│   ├── chatController.ts     # 聊天控制器主入口
│   ├── chatController*.ts    # 7 个子模块（含 Webview 路由、MCP 操作、状态缓存）
│   ├── providerClient.ts     # 提供商客户端主入口
│   ├── providerClient*.ts    # 6 个子模块（类型、请求构建、响应解析、模型获取、媒体处理、HTTP 错误）
│   ├── mcpRuntime.ts         # MCP 运行时
│   ├── mcpTypes.ts           # MCP 类型定义
│   ├── mcpUtils.ts           # MCP 工具函数
│   ├── modelCatalog.ts       # 模型目录
│   ├── modelCapability*.ts   # 模型能力推断
│   ├── webview*.ts           # WebView 渲染（8+ 文件 + CSS 模块）
│   ├── settingsCenter*.ts    # 设置中心
│   ├── settingsCenterJs/     # 设置中心前端 JS（21 个根目录条目，含 eventListeners/ 子目录，共 29 个 TS 文件）
│   ├── compassStorage/       # Compass 存储层（9 文件）
│   ├── i18n/                 # 国际化（3 文件）
│   ├── utils/                # 工具函数（14 文件）
│   ├── sidebarViewBase.ts    # 侧边栏 WebviewView 抽象基类（ready 握手/状态推送）
│   ├── sidebarViewTypes.ts   # 侧边栏通信消息联合类型
│   ├── sidebarViewStyles.ts  # 侧边栏共享样式（VS Code CSS 变量）
│   ├── sidebarViewHtml.ts    # 侧边栏 HTML 骨架组装
│   ├── sidebarViewSorters.ts # 侧边栏排序逻辑
│   ├── sidebarViewSettings.ts # 设置侧边栏 WebviewViewProvider
│   ├── sidebarViewAssistants.ts # 助手侧边栏 WebviewViewProvider（含回收站模式）
│   ├── sidebarViewSessions.ts # 会话侧边栏 WebviewViewProvider
│   ├── sidebarViewJs/        # 侧边栏前端 JS（index/assistants/sessions/settings/contextMenu/searchBox/treeList/shared）
│   └── ...
└── test/                     # 测试文件
    ├── unit/                 # 单元测试（按域分子目录）
    ├── integration/          # 集成测试
    ├── benchmark/            # 性能基准测试
    └── fixtures/             # 测试夹具
```

## 编码规范

### 命名

| 类型 | 规范 | 示例 |
|------|------|------|
| 类 | PascalCase | `ChatStateRepository` |
| 接口/类型别名 | PascalCase | `ChatStatePayload` |
| 函数 | camelCase | `buildChatStatePayload()` |
| 常量 | UPPER_SNAKE_CASE | `COMPASS_LAYOUT_VERSION` |

### 文件组织

- 每个文件导出一个主要类或一组相关函数
- 工具函数按领域分组到 `utils/` 子目录
- 测试文件与源码分离，放在 `src/test/`

### 类型安全

- 严格 TypeScript 模式（`strict: true`）
- 使用 Zod 进行运行时验证（`schemas.ts`）
- 充分利用类型守卫（`utils/guard.ts`）

## 常见任务

### 添加新 Provider

1. `types.ts` 的 `ProviderKind` 添加新类型
2. `providerClientRequestBuilders.ts` 添加请求体构造
3. `providerClientParsers.ts` 添加响应解析
4. `providerClientModelFetchers.ts` 添加模型列表获取
5. `modelCapabilityRegistry.ts` 注册已知模型能力

### 添加新字符串（i18n）

1. `types.ts` 的 `RuntimeStrings` 接口添加字段
2. `i18n/strings.en.ts` 添加英文翻译
3. `i18n/strings.zh-CN.ts` 添加中文翻译

### 修改状态

- 通过 `ChatStateRepository` 的方法修改
- 修改后调用 `bump()` 使版本缓存失效
- 调用 `refreshAll()` 触发视图刷新
- 不要直接操作侧边栏 WebviewView Provider

### 修改 WebView

- 聊天界面：修改 `webviewChat*.ts` 文件
- 设置中心：修改 `settingsCenter*.ts` 或 `settingsCenterJs/` 文件
- 侧边栏视图：修改 `sidebarView*.ts` 和 `sidebarViewJs/*.ts` 文件
- 样式通过字符串模板内联到 HTML 中
- 重新编译后需重启 Extension Development Host

### 添加测试

```ts
import assert from 'assert';
import { myFunction } from '../chatbuddy/myModule';

describe('myFeature', () => {
  it('should do something', () => {
    const result = myFunction('input');
    assert.strictEqual(result, 'expected');
  });
});
```

## 关键依赖

| 包 | 用途 | 注意 |
|----|------|------|
| `@modelcontextprotocol/client` | MCP 客户端 | ESM-only，动态 `import()` |
| `katex` | 数学公式渲染 | WebView 内联加载 |
| `mermaid` | 图表渲染 | WebView 内联加载 |
| `zod` | 运行时类型验证 | — |
| `sql.js` | 旧版 SQLite 迁移 | 仅迁移用，不用于主存储 |
| `pdf-parse` | PDF 文本提取 | — |
| `mammoth` | DOCX 文本提取 | — |
| `jszip` | ZIP 备份压缩 | — |
| `@cfworker/json-schema` | JSON Schema 验证 | — |

## 已知问题与注意事项

- **MCP ESM**: 不能直接 `import` MCP 客户端库，必须用 `await import()`
- **WebView 重注入**: 脚本重注入时不能使用顶层 `return`，改用 `vscode.postMessage`
- **超时竞态**: 中断生成时先 `setAbortReason` 再 `abort()`
- **持久化竞态**: `persistDirty` 标志防止并发状态变更丢失
- **MCP 删除竞态**: `recentlyDeletedMcpServerIds` 防止 WebView 重新引入已删除 server
- **文件附件 token 溢出**: 减小「上下文数」设置（默认 16→4-8）
- **开发数据重置**: 删除 `~/.config/Code/User/globalStorage/Zheng404.chatbuddy/`

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat(provider): add support for custom headers
fix(chat): handle empty tool call arguments gracefully
refactor(storage): extract session persistence logic
docs: add architecture documentation for Compass storage
```

## 发布前检查

```bash
npm run lint
npm run compile
npm run test:unit
npm run check:changelog
```

## 文档实时更新原则

**重要：文档是代码的一部分，必须与代码同步更新。**

### 何时更新文档

| 场景 | 需要更新的文档 |
|------|----------------|
| 新增文件/模块 | AGENTS.md、CONTRIBUTING.md、ARCHITECTURE.md |
| 修改文件职责 | ARCHITECTURE.md、相关文档 |
| 新增/修改命令 | DEVELOPMENT.md（scripts 列表） |
| 新增 API/消息类型 | WEBVIEW_PROTOCOL.md |
| 修改存储结构 | STORAGE.md |
| 发现已知问题 | AGENTS.md（已知问题章节） |

### 更新检查清单

每次代码变更后，检查：

1. **目录结构** — 新文件是否在文档中列出？
2. **模块职责** — 职责变化是否反映在架构文档中？
3. **文件数量** — AGENTS.md 中的数字是否准确？
4. **命令列表** — package.json scripts 变化是否更新？
5. **更新日期** — 修改的文档日期是否更新为 `> 最后更新：YYYY-MM-DD`
