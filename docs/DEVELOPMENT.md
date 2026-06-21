# ChatBuddy 开发指南

> 最后更新：2026-06-18

本文档是 ChatBuddy VS Code 扩展的**一站式开发参考**。

## 快速参考

项目上下文和编码规范已迁移到 **`AGENTS.md`**（根目录），这是 AI 辅助开发的主要上下文文件。

## 文档索引

| 文档 | 路径 | 说明 |
|------|------|------|
| **项目上下文** | [`AGENTS.md`](../AGENTS.md) | 架构、编码规范、常见任务、已知问题 |
| **架构详细文档** | [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 模块分层、数据流、依赖关系 |
| **存储格式文档** | [`STORAGE.md`](./STORAGE.md) | Compass 存储结构与迁移机制 |
| **WebView 通信协议** | [`WEBVIEW_PROTOCOL.md`](./WEBVIEW_PROTOCOL.md) | Extension Host ↔ WebView 消息格式 |
| **贡献指南** | [`CONTRIBUTING.md`](./CONTRIBUTING.md) | 开发环境搭建、编码规范、提交规范、测试 |
| **更新日志** | [`CHANGELOG.md`](../CHANGELOG.md) | 版本历史与变更记录 |

## 快速开始

```bash
# 克隆并初始化
git clone https://github.com/Zheng404/ChatBuddy.git
cd ChatBuddy
npm install
npm run compile

# 在 VS Code 中按 F5 启动 Extension Development Host
```

## 开发命令

| 命令 | 说明 |
|------|------|
| `npm run compile` | 编译 TypeScript（先清理 `out/` 再编译） |
| `npm run watch` | 监听模式（开发时推荐） |
| `npm run test` | 运行 lint + 编译 + 单元测试 |
| `npm run test:unit` | 仅运行单元测试（脚本会自动前置 `compile`，无需手动编译） |
| `npm run test:coverage` | 覆盖率报告（Node.js 原生 `--experimental-test-coverage`，文本输出） |
| `npm run test:coverage:ci` | CI 覆盖率阈值检查（lines=40/functions=40/branches=30） |
| `npm run test:watch` | 监听模式测试（nodemon） |
| `npm run benchmark` | 性能基准测试 |
| `npm run lint` | ESLint 检查（ESLint 9 flat config） |
| `npm run package` | 打包为 .vsix |
| `npm run publish:vscode` | 发布到 VS Code Marketplace |
| `npm run publish:openvsx` | 发布到 Open VSX |
| `npm run publish:all` | 发布到所有市场 |
| `npm run generate:manifest` | 生成多语言 manifest |
| `npm run check:changelog` | 验证 Changelog 版本号 |
| `npm run extract:release-notes` | 提取发布说明 |

## 故障排查

详见 [`AGENTS.md`](../AGENTS.md) 的「已知问题与注意事项」章节。

常见快速修复：

- **侧边栏视图不刷新** → 使用 `refreshAll()` 触发刷新，不要直接操作 Webview View Provider
- **侧边栏 Webview 样式异常** → 检查 `sidebarViewStyles.ts` 中的 VS Code CSS 变量，重新编译并重启 Extension Development Host
- **WebView CSS 未生效** → 重新编译并重启 Extension Development Host
- **开发数据重置** → 删除 `~/.config/Code/User/globalStorage/Zheng404.chatbuddy/`
- **MCP 连接失败** → 检查 MCP 服务器配置，确保命令路径正确

## 调试技巧

### 主进程调试

1. 在 `src/extension.ts` 或任何 TypeScript 文件中设置断点
2. 按 `F5` 启动 Extension Development Host
3. 断点会在 Extension Host 进程中命中

### WebView 调试

1. 在 Extension Development Host 中打开 ChatBuddy 聊天面板
2. 按 `Ctrl+Shift+P` → 搜索 "Developer: Open Webview Developer Tools"
3. 在 DevTools 中查看 WebView 的 Console 和 Elements

### 侧边栏 Webview 调试

侧边栏 4 个 view（设置/助手/回收站/会话）均为自定义 Webview View，调试方式与聊天面板一致：

1. 在 Extension Development Host 中打开目标侧边栏 view
2. 按 `Ctrl+Shift+P` → 搜索 "Developer: Open Webview Developer Tools"
3. 在 DevTools 中查看对应 view 的 Console 和 Elements

侧边栏前端 JS 位于 `src/chatbuddy/sidebarViewJs/`，Host 端逻辑位于 `src/chatbuddy/sidebarView*.ts`。

### 常用断点位置

| 文件 | 用途 |
|------|------|
| `extension.ts` → `activate()` | 扩展启动流程 |
| `chatController.ts` → `sendMessage()` | 消息发送入口 |
| `providerClient.ts` → `chat()` | Provider 请求入口 |
| `stateRepository.ts` → `initialize()` | 状态初始化 |
| `mcpRuntime.ts` → `connect()` | MCP 连接建立 |

## 开发环境数据

Extension Development Host 使用独立的 globalStorage 目录，不会污染主 VS Code 数据：

```
~/.config/Code/User/globalStorage/Zheng404.chatbuddy/
```

开发时生成的数据（助手、会话、设置）存储在这里，可以随时删除以重置状态。
