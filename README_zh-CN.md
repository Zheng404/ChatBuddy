# ChatBuddy - VS Code AI 助手扩展

<p align="center">
  <img src="media/chatbuddy.png" alt="ChatBuddy Logo" width="180">
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README_zh-CN.md">中文</a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=Zheng404.chatbuddy">
    <img src="https://img.shields.io/badge/VS%20Code%20应用商店-安装-blue.svg" alt="VS Code 应用商店">
  </a>
  <a href="https://open-vsx.org/extension/Zheng404/chatbuddy">
    <img src="https://img.shields.io/badge/Open%20VSX-安装-orange.svg" alt="Open VSX">
  </a>
  <img src="https://img.shields.io/badge/VS%20Code-1.120.0+-blue.svg" alt="VS Code 版本">
  <img src="https://img.shields.io/badge/许可证-MIT-green.svg" alt="许可证">
</p>

一款功能强大的 VS Code 多助手 AI 聊天扩展。支持任意 OpenAI 兼容 API，管理多个助手，组织会话，并通过 MCP 扩展能力 —— 无需离开编辑器。

---

## 功能特性

- **多助手管理** — 创建、组织和切换多个 AI 助手，每个助手拥有独立的系统提示词、模型和参数。
- **多提供商支持** — 兼容 OpenAI、Gemini、OpenRouter、Ollama 及任意自定义 OpenAI 兼容端点。
- **会话管理** — 每个助手拥有独立的会话历史。支持重命名、搜索、导出和清空会话。
- **MCP 集成** — 连接 MCP 服务器（stdio、SSE、HTTP），通过外部工具、资源和 Prompt 扩展 AI 能力。
- **流式响应** — 实时流式输出，带有打字机效果。随时可中断生成。
- **多模态聊天** — 直接粘贴图片到聊天中，支持 KaTeX 数学公式渲染和 Mermaid 图表。
- **工具调用** — 本地函数工具 + MCP 远程工具，危险操作需用户确认。
- **模型能力推断** — 自动检测模型类型（chat、image、video、audio、embedding、rerank）和能力（vision、reasoning、tools、webSearch）。
- **双语界面** — 完整的中英文支持，运行时语言切换。
- **自定义侧边栏视图** — 助手、会话、回收站、设置均以自定义 Webview View 渲染，提供更丰富的布局与交互。
- **数据备份与迁移** — 导出/导入结构化 ZIP 备份，自动从旧版 SQLite 存储迁移。

---

## 快速开始

### 安装

| 平台 | 方式 |
|------|------|
| VS Code | 在扩展应用商店搜索 "ChatBuddy"，或[在线安装](https://marketplace.visualstudio.com/items?itemName=Zheng404.chatbuddy) |
| VSCodium / Cursor | [从 Open VSX 安装](https://open-vsx.org/extension/Zheng404/chatbuddy) |
| 手动安装 | 从 [GitHub Releases](https://github.com/Zheng404/ChatBuddy/releases) 下载 `.vsix` 文件 |

### 配置

1. 打开 VS Code 侧边栏的 **ChatBuddy** 面板（寻找机器人图标）。
2. 在设置视图中点击 **模型配置**，添加 AI 提供商和 API 密钥。
3. 在助手视图中新建一个助手。
4. 开始对话！

---

## 提供商兼容性

ChatBuddy 是一款**通用 OpenAI 兼容 API 客户端**。只要 API 端点实现了 OpenAI 协议，填入 base URL 和 API Key 即可使用。

- **API 格式**：支持 `chat/completions` 和 `responses` 两种接口，可为每个提供商独立配置。
- **模型自动获取**：对提供 `/models` 接口的提供商，可自动拉取模型列表。

---

## 功能截图

<table>
  <tr>
    <td width="50%"><b>聊天界面</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Assistant.png" width="100%"></td>
    <td width="50%"><b>提供商配置</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Provider%20Setup.png" width="100%"></td>
  </tr>
  <tr>
    <td width="50%"><b>模型管理</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Model%20Management.png" width="100%"></td>
    <td width="50%"><b>默认模型</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Default%20Models.png" width="100%"></td>
  </tr>
  <tr>
    <td width="50%"><b>MCP 设置</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/MCP%20Settings.png" width="100%"></td>
    <td width="50%"><b>助手配置</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Assistant%20Profile.png" width="100%"></td>
  </tr>
  <tr>
    <td width="50%"><b>数据管理</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Data%20Management.png" width="100%"></td>
    <td width="50%"><b>本地备份</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Local%20Backup.png" width="100%"></td>
  </tr>
  <tr>
    <td width="50%"><b>其他设置</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Other%20Settings.png" width="100%"></td>
    <td width="50%"></td>
  </tr>
</table>

---

## 开发文档

> 详细的开发文档请查看 [`docs/`](./docs) 目录。

- [项目上下文 (AGENTS.md)](./AGENTS.md) — 架构、编码规范、常见任务
- [开发指南](./docs/DEVELOPMENT.md) — 快速参考与文档索引
- [架构概览](./docs/ARCHITECTURE.md) — 详细架构设计与数据流
- [存储格式与迁移机制](./docs/STORAGE.md) — Compass 存储结构与迁移机制
- [WebView 通信协议](./docs/WEBVIEW_PROTOCOL.md) — Extension Host ↔ WebView 消息格式
- [贡献指南](./docs/CONTRIBUTING.md) — 开发环境搭建与贡献规范

```bash
# 克隆并初始化
git clone https://github.com/Zheng404/ChatBuddy.git
cd ChatBuddy
npm install
npm run compile

# 在 VS Code 中按 F5 启动 Extension Development Host
```

---

## 更新日志

详见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 许可证

本项目采用 [MIT](LICENSE) 许可证。

## 感谢

- [LinuxDO](https://linux.do)
- [V2EX](https://www.v2ex.com)
- [ZCF](https://github.com/UfoMiao/zcf)
