# ChatBuddy 贡献指南

> 最后更新：2026-06-18

本文档帮助开发者快速搭建 ChatBuddy 的开发环境并参与贡献。

---

## 目录

- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [开发 workflow](#开发-workflow)
- [调试](#调试)
- [代码规范](#代码规范)
- [测试](#测试)
- [提交规范](#提交规范)
- [常见问题](#常见问题)

---

## 环境要求

- **Node.js**: 20.x 或更高
- **VS Code**: 1.120.0 或更高（用于调试和测试）
- **Git**: 任意现代版本

---

## 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/Zheng404/ChatBuddy.git
cd ChatBuddy

# 2. 安装依赖
npm install

# 3. 编译 TypeScript
npm run compile

# 4. 在 VS Code 中打开项目
code .
```

---

## 项目结构

```
ChatBuddy/
├── docs/                       ← 项目文档
│   ├── ARCHITECTURE.md
│   ├── DEVELOPMENT.md
│   ├── STORAGE.md
│   ├── WEBVIEW_PROTOCOL.md
│   ├── CONTRIBUTING.md
│   └── adr/                    ← 架构决策记录
│
├── src/                        ← TypeScript 源码
│   ├── extension.ts            ← 扩展入口，依赖注入组装
│   │
│   ├── extension/              ← 适配层（命令注册、侧边栏 WebviewView、面板控制器）
│   │   ├── commands.ts         ← 命令注册聚合
│   │   ├── panelControllers.ts ← 面板控制器工厂
│   │   ├── sidebarViewProviders.ts ← 侧边栏 WebviewViewProvider 工厂
│   │   ├── activationTypes.ts  ← 激活阶段共享类型
│   │   ├── dataActions.ts      ← 数据导入/导出/重置动作
│   │   ├── settingsCommands.ts
│   │   ├── navigationCommands.ts
│   │   ├── assistantTreeCommands.ts
│   │   ├── assistantManagementCommands.ts
│   │   ├── sessionCommands.ts
│   │   ├── localeMenuCommands.ts
│   │   ├── shared.ts           ← ExtensionContext 接口与导出辅助
│   │   └── localeAwareManifestData.json
│   │
│   ├── chatbuddy/              ← 业务核心层
│   │   ├── types.ts            ← 全局类型定义
│   │   ├── constants.ts        ← 常量
│   │   ├── i18n.ts             ← 国际化入口
│   │   ├── i18n/               ← 本地化字符串
│   │   │   ├── strings.en.ts
│   │   │   ├── strings.zh-CN.ts
│   │   │   └── runtimeStrings.ts
│   │   │
│   │   ├── stateRepository.ts          ← 状态管理主入口
│   │   ├── stateRepositoryAssistantService.ts
│   │   ├── stateRepositorySessionService.ts
│   │   ├── stateRepositoryPersistenceService.ts
│   │   ├── stateRepositoryImportExport.ts
│   │   ├── stateClone.ts
│   │   ├── stateHelpers.ts
│   │   ├── stateSanitizers.ts
│   │   ├── chatStorage.ts
│   │   │
│   │   ├── chatController.ts           ← 聊天控制器主入口
│   │   ├── chatControllerGenerationService.ts
│   │   ├── chatControllerPanelManager.ts
│   │   ├── chatControllerPayload.ts
│   │   ├── chatControllerToolOrchestrator.ts
│   │   ├── chatControllerWebviewRouter.ts
│   │   ├── chatControllerMcpOperations.ts ← MCP 操作代理
│   │   ├── chatControllerStateCache.ts    ← 生成期状态缓存
│   │   ├── chatUtils.ts
│   │   │
│   │   ├── providerClient.ts           ← Provider 客户端主入口
│   │   ├── providerClientTypes.ts
│   │   ├── providerClientParsers.ts
│   │   ├── providerClientRequestBuilders.ts
│   │   ├── providerClientModelFetchers.ts
│   │   ├── providerClientMedia.ts
│   │   ├── providerClientErrors.ts
│   │   │
│   │   ├── mcpRuntime.ts               ← MCP 运行时
│   │   ├── mcpTypes.ts                 ← MCP 类型定义
│   │   ├── mcpUtils.ts                 ← MCP 工具函数
│   │   │
│   │   ├── modelCatalog.ts             ← 模型目录
│   │   ├── modelCapabilities.ts
│   │   ├── modelCapabilityPatterns.ts
│   │   ├── modelCapabilityRegistry.ts
│   │   │
│   │   ├── webview.ts                  ← WebView HTML 组装
│   │   ├── webviewChatHtml.ts
│   │   ├── webviewChatStyles.ts
│   │   ├── webviewChatBaseCss.ts       ← 聊天基础样式
│   │   ├── webviewChatComposerCss.ts   ← 输入框样式
│   │   ├── webviewChatMarkdownCss.ts   ← Markdown 样式
│   │   ├── webviewChatSearchModalCss.ts ← 搜索模态框样式
│   │   ├── webviewChatToolsCss.ts      ← 工具样式
│   │   ├── webviewChatScript.ts
│   │   ├── webviewChatScriptEvents.ts
│   │   ├── webviewChatScriptMarkdown.ts
│   │   ├── webviewChatScriptUi.ts
│   │   ├── webviewBaseTheme.ts
│   │   ├── webviewFormTheme.ts         ← 表单主题
│   │   ├── webviewShared.ts
│   │   │
│   │   ├── settingsCenterPanel.ts      ← 设置中心面板
│   │   ├── settingsCenterStyles.ts
│   │   ├── settingsCenterBaseCss.ts    ← 设置中心基础样式
│   │   ├── settingsCenterAboutCss.ts   ← 关于页面样式
│   │   ├── settingsCenterMcpCss.ts     ← MCP 页面样式
│   │   ├── settingsCenterModalCss.ts   ← 模态框样式
│   │   ├── settingsCenterProviderCss.ts ← Provider 页面样式
│   │   ├── settingsHtmlGenerator.ts    ← 设置 HTML 生成器
│   │   ├── settingsMessageHandler.ts   ← 设置消息处理器
│   │   ├── settingsTypes.ts            ← 设置类型定义
│   │   ├── settingsCenterJs/           ← 设置中心前端 JS
│   │   │   ├── index.ts
│   │   │   ├── shared.ts
│   │   │   ├── stateSync.ts
│   │   │   ├── messageHandler.ts
│   │   │   ├── eventListeners.ts       ← 事件监听器入口
│   │   │   ├── eventListeners/         ← 事件监听器子目录
│   │   │   │   ├── general.ts
│   │   │   │   ├── layout.ts
│   │   │   │   ├── mcp.ts
│   │   │   │   ├── modals.ts
│   │   │   │   ├── modelManager.ts
│   │   │   │   ├── nav.ts
│   │   │   │   ├── providerEditor.ts
│   │   │   │   ├── templates.ts
│   │   │   │   └── dataManagement.ts
│   │   │   ├── general.ts
│   │   │   ├── modelConfig.ts
│   │   │   ├── modelConfigActions.ts
│   │   │   ├── modelConfigModals.ts
│   │   │   ├── modelConfigModelsRenderer.ts
│   │   │   ├── modelConfigProviderRenderer.ts
│   │   │   ├── modelConfigRenderers.ts
│   │   │   ├── modelConfigState.ts
│   │   │   ├── defaultModels.ts
│   │   │   ├── mcp.ts
│   │   │   ├── mcpModal.ts
│   │   │   ├── dataManagement.ts
│   │   │   ├── templates.ts
│   │   │   ├── notice.ts
│   │   │   └── about.ts
│   │   │
│   │   ├── compassStorage/             ← Compass 存储层
│   │   │   ├── index.ts
│   │   │   ├── paths.ts
│   │   │   ├── io.ts
│   │   │   ├── types.ts
│   │   │   ├── settingsStore.ts
│   │   │   ├── sessionStore.ts
│   │   │   ├── sessionStoreLegacy.ts
│   │   │   ├── kvStore.ts
│   │   │   └── migrator.ts
│   │   │
│   │   ├── utils/              ← 工具函数
│   │   │   ├── index.ts
│   │   │   ├── id.ts
│   │   │   ├── guard.ts
│   │   │   ├── error.ts
│   │   │   ├── math.ts
│   │   │   ├── fs.ts
│   │   │   ├── html.ts
│   │   │   ├── csp.ts
│   │   │   ├── template.ts
│   │   │   ├── retry.ts
│   │   │   ├── provider.ts
│   │   │   ├── locale.ts
│   │   │   └── logger.ts
│   │   │
│   │   ├── sidebarViewBase.ts          ← 侧边栏 WebviewView 抽象基类
│   │   ├── sidebarViewTypes.ts         ← 侧边栏通信消息联合类型
│   │   ├── sidebarViewStyles.ts        ← 侧边栏共享样式（VS Code CSS 变量）
│   │   ├── sidebarViewHtml.ts          ← 侧边栏 HTML 骨架
│   │   ├── sidebarViewSorters.ts       ← 侧边栏排序逻辑
│   │   ├── sidebarViewSettings.ts      ← 设置侧边栏 Webview View Provider
│   │   ├── sidebarViewAssistants.ts    ← 助手侧边栏 Webview View Provider（含回收站模式）
│   │   ├── sidebarViewSessions.ts      ← 会话侧边栏 Webview View Provider
│   │   ├── sidebarViewJs/              ← 侧边栏前端 JS
│   │   │   ├── index.ts
│   │   │   ├── shared.ts
│   │   │   ├── assistants.ts
│   │   │   ├── sessions.ts
│   │   │   ├── settings.ts
│   │   │   ├── contextMenu.ts
│   │   │   ├── searchBox.ts
│   │   │   └── treeList.ts
│   │   ├── assistantEditorPanel.ts     ← 助手编辑器面板
│   │   ├── assistantEditorJs.ts        ← 助手编辑器前端 JS
│   │   ├── assistantEditorStyles.ts    ← 助手编辑器样式
│   │   ├── assistantEditorTypes.ts     ← 助手编辑器类型
│   │   ├── backupArchive.ts
│   │   ├── localBackup.ts             ← 本地备份
│   │   ├── security.ts
│   │   ├── codicon.ts
│   │   ├── codiconUtils.ts
│   │   ├── panelIcon.ts
│   │   ├── streamAccumulator.ts
│   │   ├── toastTheme.ts
│   │   └── schemas.ts
│   │
│   └── test/                   ← 测试文件
│       ├── setup.ts
│       ├── unit/              ← 单元测试
│       │   ├── chat/
│       │   ├── provider/
│       │   ├── state/
│       │   ├── storage/
│       │   ├── mcp/
│       │   ├── extension/
│       │   └── utils/
│       ├── integration/       ← 集成测试
│       ├── benchmark/         ← 性能基准测试
│       └── fixtures/          ← 测试夹具
│
├── scripts/                    ← 构建脚本
│   ├── generateLocaleAwareManifest.cjs
│   ├── validateChangelogVersion.cjs
│   └── extractReleaseNotes.cjs
│
├── media/                      ← 图标资源
├── img/                        ← 文档截图
├── out/                        ← TypeScript 编译输出
├── package.json                ← 扩展清单
├── tsconfig.json               ← TypeScript 配置
└── eslint.config.mjs           ← ESLint 9 flat config
```

---

## 开发 workflow

### 编译与监听

```bash
# 一次性编译
npm run compile

# 监听模式（开发时推荐）
npm run watch

# 带 lint 的完整构建
npm run test
```

### 运行扩展

在 VS Code 中按 `F5` 启动 **Extension Development Host**，这是一个独立的 VS Code 窗口，加载当前扩展。

或者通过命令行：
```bash
# 需要先编译
npm run compile

# 然后使用 VS Code CLI 启动
# （需要在 VS Code 中手动按 F5）
```

### 扩展开发 Host 中的数据

Extension Development Host 使用独立的 globalStorage 目录，不会污染你的主 VS Code 数据：

```
~/.config/Code - OSS/User/globalStorage/Zheng404.chatbuddy/
```

开发时生成的数据（助手、会话、设置）存储在这里，可以随时删除以重置状态。

---

## 调试

### 主进程调试

1. 在 `src/extension.ts` 或任何 `src/extension/*.ts` 文件中设置断点
2. 按 `F5` 启动 Extension Development Host
3. 断点会在 Extension Host 进程中命中

### WebView 调试

1. 在 Extension Development Host 中打开 ChatBuddy 聊天面板
2. 按 `Ctrl+Shift+P` → 搜索 "Developer: Open Webview Developer Tools"
3. 在 DevTools 中查看 WebView 的 Console 和 Elements

### 设置中心调试

与 WebView 调试方式相同，打开设置中心后使用 Webview Developer Tools。

### 常用断点位置

| 文件 | 行号附近 | 用途 |
|------|----------|------|
| `extension.ts` | `activate()` | 扩展启动流程 |
| `chatController.ts` | `sendMessage()` | 消息发送入口 |
| `providerClient.ts` | `chat()` | Provider 请求入口 |
| `stateRepository.ts` | `initialize()` | 状态初始化 |

---

## 代码规范

### TypeScript 配置

项目使用严格模式：

```json
{
  "strict": true,
  "module": "Node16",
  "moduleResolution": "node16",
  "target": "ES2020",
  "forceConsistentCasingInFileNames": true
}
```

### ESLint

项目使用 ESLint 9 flat config（`eslint.config.mjs`）：

```bash
# 检查代码风格
npm run lint

# 自动修复
npx eslint src --fix
```

### 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 类 | PascalCase | `ChatStateRepository` |
| 接口 | PascalCase | `ChatStatePayload` |
| 类型别名 | PascalCase | `ProviderModelOption` |
| 函数 | camelCase | `buildChatStatePayload()` |
| 常量 | UPPER_SNAKE_CASE | `COMPASS_LAYOUT_VERSION` |
| 私有成员 | 下划线前缀（可选） | `private _version` |

### 文件组织

- 每个文件导出**一个**主要类或一组相关函数
- 工具函数按领域分组到 `utils/` 子目录
- 设置中心前端代码放在 `settingsCenterJs/` 子目录
- 测试文件与源码分离，放在 `src/test/`

---

## 测试

### 运行测试

```bash
# 运行 lint + 编译 + 单元测试
npm test

# 仅运行单元测试（脚本会自动前置 compile，无需手动编译）
npm run test:unit

# 仅运行 lint
npm run lint
```

### 测试文件说明

测试文件按域分目录组织在 `src/test/` 下：

```
src/test/
├── unit/                    ← 单元测试
│   ├── chat/                ← 聊天控制器相关
│   ├── provider/            ← Provider 客户端相关
│   ├── state/               ← 状态仓库相关
│   ├── storage/             ← Compass 存储层相关
│   ├── mcp/                 ← MCP 运行时相关
│   ├── extension/           ← 命令层相关
│   └── utils/               ← 工具函数相关
├── integration/             ← 集成测试
├── benchmark/               ← 性能基准测试
└── fixtures/                ← 测试夹具
```

| 子目录 | 代表测试文件 | 覆盖范围 |
|--------|--------------|----------|
| `unit/chat/` | `chatController.behavior.test.ts`、`chatControllerGenerationService.test.ts`、`chatControllerPayload.test.ts`、`chatControllerToolOrchestrator.test.ts`、`streamAccumulator.test.ts` | 聊天控制器、消息生成、工具编排、流式累加 |
| `unit/provider/` | `providerClient.stream.test.ts`、`providerClientParsers.test.ts`、`providerClientRequestBuilders.test.ts`、`provider.test.ts`、`providerFailover.test.ts`、`modelCapabilityPatterns.test.ts` | Provider 客户端、流式解析、故障转移、模型能力推断 |
| `unit/state/` | `stateRepositoryAssistantService.test.ts`、`stateRepositoryPersistenceService.test.ts`、`stateRepositoryBackup.test.ts`、`stateClone.test.ts`、`stateSanitizers.test.ts`、`apiKeyPersistence.test.ts` | 状态仓库、持久化、备份、API Key 存储 |
| `unit/storage/` | `chatStorage.test.ts`、`backupArchive.test.ts`、`sessionStoreLoad.test.ts`、`sessionStoreSearch.test.ts` | Compass 存储层、会话读写、ZIP 备份 |
| `unit/mcp/` | `mcpRuntime.test.ts`、`mcpServerGroups.test.ts` | MCP 运行时、服务器分组 |
| `unit/extension/` | `assistantManagementCommands.test.ts`、`sessionCommands.test.ts` | 命令层行为 |
| `unit/utils/` | `retry.test.ts`、`template.test.ts` | 工具函数 |

运行 `npm run test:unit` 查看实时测试统计。

### 添加新测试

```ts
// src/test/myFeature.test.ts
import assert from 'assert';
import { myFunction } from '../chatbuddy/myModule';

describe('myFeature', () => {
  it('should do something', () => {
    const result = myFunction('input');
    assert.strictEqual(result, 'expected');
  });
});
```

---

## 提交规范

项目使用 [Conventional Commits](https://www.conventionalcommits.org/) 风格：

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

常用类型：

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 Bug |
| `refactor` | 重构（不影响功能） |
| `docs` | 文档更新 |
| `test` | 测试相关 |
| `chore` | 构建/工具链 |

示例：

```
feat(provider): add support for custom headers

Allow users to configure custom HTTP headers per provider
for authentication or rate-limiting purposes.

fix(chat): handle empty tool call arguments gracefully

refactor(storage): extract session persistence logic

docs: add architecture documentation for Compass storage
```

### 提交模板格式

```
<type>(<scope>): <subject>
│        │         │
│        │         └─ Summary: 使用现在时态（50 字符以内）
│        │            - 英文首字母大写
│        │            - 结尾不加句号
│        │
│        └─── Scope: 受影响的模块或区域
│               - 例如: chat, settings, storage, mcp, ui, provider
│               - 可选：无特定范围时可省略
│
└──────── Type: 从下方列表中选择
               - feat: 新功能
               - fix: Bug 修复
               - docs: 文档更新
               - style: 代码格式调整（不影响功能）
               - refactor: 代码重构
               - perf: 性能优化
               - test: 测试相关
               - build: 构建系统变更
               - ci: CI/CD 变更
               - chore: 其他任务

Body (可选): 解释 WHAT 和 WHY，不是 HOW
- 使用项目符号列出多项变更
- 每行不超过 72 字符
- 使用英文

Footer (可选):
Closes #123
Refs #456
BREAKING CHANGE: 新的 API 接口
```

### 预提交检查

提交前建议运行：

```bash
npm run lint
npm run compile
npm run test:unit
```

---

## 常见问题

### Q: 编译时报 "Cannot find module '@modelcontextprotocol/client'"

A: `@modelcontextprotocol/client` 是 ESM-only 包，TypeScript 编译时会跳过类型检查（`skipLibCheck: true`）。确保已运行 `npm install`。运行时通过动态 `import()` 加载，不需要 CommonJS 兼容。

### Q: Extension Development Host 中看不到 ChatBuddy 面板

A: 检查：
1. 编译是否成功（`npm run compile` 无错误）
2. 是否按 `F5` 正确启动了 Extension Development Host
3. 查看 Extension Development Host 的 Output 面板是否有错误日志

### Q: WebView 中样式不生效

A: WebView 的 CSS 通过字符串拼接内联到 HTML 中。修改 `webviewChatStyles.ts` 后需要重新编译并重启 Extension Development Host。

### Q: 如何清除开发环境的测试数据？

A: 删除 Extension Development Host 的 globalStorage：

```bash
# Linux
rm -rf ~/.config/Code\ -\ OSS/User/globalStorage/Zheng404.chatbuddy/

# macOS
rm -rf ~/Library/Application\ Support/Code/User/globalStorage/Zheng404.chatbuddy/

# Windows
# %APPDATA%\Code\User\globalStorage\Zheng404.chatbuddy\
```

### Q: 添加新的 AI Provider 需要改哪些文件？

A: 参见 [ARCHITECTURE.md](./ARCHITECTURE.md) 的 "引入新 Provider 的步骤" 章节。

### Q: 如何生成多语言 manifest？

A: 项目使用脚本生成支持动态语言的 `package.json`：

```bash
npm run generate:manifest
```

这会基于 `package.json` 模板和 `src/extension/localeAwareManifestData.json` 生成最终的 manifest。

---

## 相关文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 架构设计
- [STORAGE.md](./STORAGE.md) — 存储机制
- [WEBVIEW_PROTOCOL.md](./WEBVIEW_PROTOCOL.md) — WebView 通信协议
