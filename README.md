# ChatBuddy - VS Code AI Assistant Extension

<p align="center">
  <img src="media/chatbuddy.png" alt="ChatBuddy Logo" width="180">
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README_zh-CN.md">中文</a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=Zheng404.chatbuddy">
    <img src="https://img.shields.io/badge/VS%20Code%20Marketplace-Install-blue.svg" alt="VS Code Marketplace">
  </a>
  <a href="https://open-vsx.org/extension/Zheng404/chatbuddy">
    <img src="https://img.shields.io/badge/Open%20VSX-Install-orange.svg" alt="Open VSX">
  </a>
  <img src="https://img.shields.io/badge/VS%20Code-1.120.0+-blue.svg" alt="VS Code Version">
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License">
</p>

A powerful, multi-assistant AI chat extension for VS Code. Chat with any OpenAI-compatible API, manage multiple assistants, organize sessions, and extend capabilities via MCP — all without leaving your editor.

---

## Features

- **Multi-Assistant Management** — Create, organize, and switch between multiple AI assistants with independent system prompts, models, and parameters.
- **Multi-Provider Support** — Works with OpenAI, Gemini, OpenRouter, Ollama, and any custom OpenAI-compatible endpoint.
- **Session Management** — Every assistant has its own session history. Rename, search, export, or clear sessions anytime.
- **MCP Integration** — Connect to MCP servers (stdio, SSE, HTTP) to extend AI capabilities with external tools, resources, and prompts.
- **Streaming Responses** — Real-time streaming output with typing effect. Interrupt generation at any time.
- **Multimodal Chat** — Paste images directly into the chat, with KaTeX math rendering and Mermaid diagram support.
- **Tool Calling** — Local function tools + MCP remote tools with user confirmation for dangerous actions.
- **Model Capability Inference** — Auto-detects model type (chat, image, video, audio, embedding, rerank) and capabilities (vision, reasoning, tools, webSearch).
- **Bilingual UI** — Full Chinese and English support with runtime language switching.
- **Custom Sidebar Views** — Assistants, sessions, recycle bin, and settings are rendered as custom Webview Views for richer layouts and interactions.
- **Data Backup & Migration** — Export/import structured ZIP backups. Automatic migration from legacy SQLite storage.

---

## Quick Start

### Install

| Platform | Method |
|----------|--------|
| VS Code | Search "ChatBuddy" in the Extensions Marketplace, or [install online](https://marketplace.visualstudio.com/items?itemName=Zheng404.chatbuddy) |
| VSCodium / Cursor | [Install from Open VSX](https://open-vsx.org/extension/Zheng404/chatbuddy) |
| Manual | Download `.vsix` from [GitHub Releases](https://github.com/Zheng404/ChatBuddy/releases) |

### Configure

1. Open the **ChatBuddy** panel in the VS Code sidebar (look for the robot icon).
2. Click **Model Config** in the Settings view to add your AI provider and API key.
3. Create a new assistant in the Assistants view.
4. Start chatting!

---

## Provider Compatibility

ChatBuddy is a **generic OpenAI-compatible API client**. It works with any API endpoint that implements the OpenAI protocol — just enter your base URL and API key.

- **API formats**: Supports both `chat/completions` and `responses` endpoints. Configurable per provider.
- **Model auto-fetch**: Automatically retrieves model lists from providers that expose a `/models` endpoint.

---

## Screenshots

<table>
  <tr>
    <td width="50%"><b>Chat Interface</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Assistant.png" width="100%"></td>
    <td width="50%"><b>Provider Setup</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Provider%20Setup.png" width="100%"></td>
  </tr>
  <tr>
    <td width="50%"><b>Model Management</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Model%20Management.png" width="100%"></td>
    <td width="50%"><b>Default Models</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Default%20Models.png" width="100%"></td>
  </tr>
  <tr>
    <td width="50%"><b>MCP Settings</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/MCP%20Settings.png" width="100%"></td>
    <td width="50%"><b>Assistant Profile</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Assistant%20Profile.png" width="100%"></td>
  </tr>
  <tr>
    <td width="50%"><b>Data Management</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Data%20Management.png" width="100%"></td>
    <td width="50%"><b>Local Backup</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Local%20Backup.png" width="100%"></td>
  </tr>
  <tr>
    <td width="50%"><b>Other Settings</b><br><img src="https://github.com/Zheng404/ChatBuddy/raw/HEAD/img/Other%20Settings.png" width="100%"></td>
    <td width="50%"></td>
  </tr>
</table>

---

## Development

> For detailed development documentation, see the [`docs/`](./docs) directory.

- [Project Context (AGENTS.md)](./AGENTS.md) — Architecture, conventions, common tasks
- [Development Guide](./docs/DEVELOPMENT.md) — Quick reference and documentation index
- [Architecture Overview](./docs/ARCHITECTURE.md) — Detailed architecture and data flow
- [Storage Format & Migration](./docs/STORAGE.md) — Compass storage and migration
- [WebView Communication Protocol](./docs/WEBVIEW_PROTOCOL.md) — Extension Host ↔ WebView protocol
- [Contributing Guide](./docs/CONTRIBUTING.md) — Development setup and contribution guidelines

```bash
# Clone and setup
git clone https://github.com/Zheng404/ChatBuddy.git
cd ChatBuddy
npm install
npm run compile

# Press F5 in VS Code to launch the Extension Development Host
```

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release history.

---

## License

This project is licensed under the [MIT](LICENSE) License.

## Credits

- [LinuxDO](https://linux.do)
- [V2EX](https://www.v2ex.com)
- [ZCF](https://github.com/UfoMiao/zcf)
