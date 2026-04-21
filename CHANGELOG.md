# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, but kept intentionally simple for this project.

## [0.3.0] - 2026-04-21

### English

#### Added

- Added multimodal chat: paste images directly into the chat input, sent as base64 to vision-capable models.
- Added in-message search: search within the current session's messages.
- Added session search: filter the session list by keyword.
- Added code copy: one-click copy button on every code block in assistant replies.
- Added edit & regenerate: edit any past user message and optionally regenerate the assistant reply from that point.
- Added prompt variables: `{{currentFile}}`, `{{selection}}`, `{{language}}`, `{{fileName}}`, `{{fileDir}}`, `{{lineNumber}}`, `{{lineCount}}`, `{{activeEditorLanguage}}` are auto-resolved before sending.
- Added About page to the Settings Center.
- Added structured ZIP backup: export and import all data (assistants, sessions, settings, API keys) as a single compressed archive.

#### Changed

- Refactored storage layer to Compass structured format: state, settings, and sessions are now stored as independent JSON/JSONL files instead of a single SQLite database.
- Improved askAI flow stability when triggered from the editor context menu.

#### Fixed

- Hardened persistence recovery: corrupt or incomplete storage snapshots are now automatically detected and recovered from legacy SQLite when available.
- Hardened session ownership checks to prevent cross-assistant session leaks.
- Hardened Compass storage snapshot validation with atomic I/O and commit markers.
- Fixed session search keyword escaping issues.

### 中文

#### 新增

- 新增多模态聊天：直接粘贴图片到聊天输入框，以 Base64 格式发送给支持 vision 的模型。
- 新增消息内搜索：在当前会话的消息内容中搜索关键词。
- 新增会话搜索：按关键词过滤会话列表。
- 新增代码复制：助手回复中的每个代码块增加一键复制按钮。
- 新增编辑与重新生成：可编辑任意历史用户消息，并选择从该位置重新生成助手回复。
- 新增 Prompt 变量：`{{currentFile}}`、`{{selection}}`、`{{language}}`、`{{fileName}}`、`{{fileDir}}`、`{{lineNumber}}`、`{{lineCount}}`、`{{activeEditorLanguage}}` 在发送前自动解析替换。
- 设置中心新增「关于」页面。
- 新增结构化 ZIP 备份：将助手、会话、设置、API 密钥等全部数据导出为单个压缩包，支持导入恢复。

#### 变更

- 重构存储层为 Compass 结构化格式：状态、设置和会话现在以独立的 JSON/JSONL 文件存储，替代原有的单文件 SQLite 数据库。
- 改进从编辑器右键菜单触发「问 AI」流程的稳定性。

#### 修复

- 加固持久化恢复机制：可自动检测损坏或不完整的存储快照，并在存在旧版 SQLite 时自动回退恢复。
- 加固会话所有权校验，防止跨助手会话泄漏。
- 加固 Compass 存储快照验证，增加原子 I/O 和提交标记保护。
- 修复会话搜索关键词转义问题。

## [0.2.4] - 2026-04-17

### English

#### Added

- Added model kind & capability inference system: automatically resolves model type (chat, image, video, audio, embedding, rerank) and capabilities (vision, reasoning, tools, webSearch) from a built-in registry.
- Added model type selector dropdown to the model edit modal.
- Added model kind and capability display (`[kind | cap1, cap2]`) in all model selection dropdowns across the app.
- Added user-only persistence for model overrides: only manually edited kind/capabilities are saved; runtime-inferred values are never stored to DB.
- Added capability editing support for ALL models including fetched/online models (with model ID editing disabled for fetched models).
- Added ~175 SiliconCloud models to the capability registry with accurate types and capabilities sourced from the official platform.
- Added 30+ GLM models to the registry based on Zhipu official documentation.

#### Changed

- Refactored model capability editor from pill-toggle buttons to proper checkbox controls.
- Improved model type suffix matching regex patterns for better fuzzy registry lookups.
- All model types (including chat) are now shown in dropdown meta labels; previously chat was omitted.

#### Fixed

- Fixed benign unhandled promise rejections from VSCode webview lifecycle events.

### 中文

#### 新增

- 新增模型类型与能力自动推断系统：从内置注册表自动解析模型类型（chat、image、video、audio、embedding、rerank）和能力（vision、reasoning、tools、webSearch）。
- 新增模型编辑弹窗中的模型类型下拉选择器。
- 新增全应用模型下拉列表中的类型与能力展示（`[类型 | 能力1, 能力2]` 格式）。
- 新增用户手动覆盖的持久化机制：仅保存用户编辑的模型类型/能力，运行时推断值不会被写入数据库。
- 新增所有模型（包括在线模型）的能力编辑支持（在线模型禁止编辑模型 ID）。
- 新增约 175 个硅基流动平台模型的能力注册表条目，类型和能力数据来源于官方平台。
- 新增 30+ 个智谱 GLM 模型注册表条目，基于智谱官方文档。

#### 变更

- 重构模型能力编辑器，从胶囊按钮改为标准勾选框控件。
- 改进模型类型后缀匹配的正则表达式，提升模糊查找准确率。
- 所有模型类型（包括 chat）均在下拉列表中展示，此前 chat 类型被省略。

#### 修复

- 修复 VSCode webview 生命周期事件导致的良性未处理 Promise 拒绝。

## [0.2.3] - 2026-04-16

### English

#### Added

- Added horizontal top tab bar navigation for settings, replacing the left sidebar layout.
- Added config/models sub-tabs in provider editor for clearer separation.
- Added provider name as editable title in config page.
- Added API key visibility toggle button.
- Added provider empty state placeholder when no providers exist.

#### Changed

- Moved provider enable toggle from list card to config sub-page header.
- Renamed "供应商" to "提供商" across all Chinese strings.
- Redesigned model section names: Custom Models / Remote Models.
- Replaced hardcoded CSS values with design tokens (--radius-*, --color-*) for consistent theming.
- Removed all inline styles from settings HTML; added utility classes (.input-row, .header-row).
- Removed unused CSS rules and empty media queries.
- Switched provider workspace responsive layout to ResizeObserver-based detection.
- Unified heading levels and field wrapper patterns across all settings sections.
- MCP transport labels now use i18n strings instead of hardcoded text.

#### Fixed

- Fixed provider list items not responding to clicks (button did not fill container width).
- Fixed provider workspace content clipping in narrow panels.

### 中文

#### 新增

- 设置页面导航由左侧栏改为顶部水平标签栏。
- 提供商编辑器拆分为「配置」和「模型管理」子标签页。
- 提供商名称作为可编辑标题显示在配置页。
- API Key 支持显示/隐藏切换。
- 无提供商时显示空状态占位提示。

#### 变更

- 提供商启用开关从列表卡片移至配置子页面。
- 全部中文文案中"供应商"统一为"提供商"。
- 模型分区重命名为「自定义模型」/「在线模型」。
- CSS 硬编码值统一替换为 design tokens（--radius-*、--color-*），明暗主题一致。
- 移除所有内联样式，新增工具类（.input-row、.header-row）。
- 清理未使用的 CSS 规则和空媒体查询。
- 提供商工作区响应式布局改为 ResizeObserver 容器宽度检测。
- 统一各设置区域的标题层级和字段包裹模式。
- MCP 传输方式标签改用 i18n 字符串。

#### 修复

- 修复提供商列表点击无响应（按钮未填满容器宽度）。
- 修复窄面板下提供商工作区内容被裁剪的问题。

## [0.2.2] - 2026-04-13

### English

#### Added

- Added a clearer provider model management layout with separate sections for manual models and added remote models.
- Added a remote model picker modal with loading state, search, and one-click add flow.
- Added autosave status feedback for provider configuration.

#### Changed

- Updated provider configuration to save changes automatically after field edits and model changes.
- Improved responsiveness during chat initialization, message updates, and streaming output.
- Improved panel lifecycle handling and stale MCP connection cleanup for better overall stability.

### 中文

#### 新增

- 重构供应商模型管理界面，将手动模型与已添加的远端模型分区展示。
- 新增远端模型选择弹窗，支持加载状态、搜索和逐个添加。
- 新增供应商配置自动保存状态提示。

#### 变更

- 供应商配置改为自动保存，字段编辑和模型变更会自动落盘。
- 优化聊天初始化、消息更新和流式输出时的响应表现。
- 改进面板生命周期处理与过期 MCP 连接清理，提升整体稳定性。

## [0.2.1] - 2026-04-13

### English

#### Added

- Added support for Markdown tables, task lists, LaTeX, Mermaid diagrams, and chart rendering in chat messages.
- Added persistence for assistant group collapse and expand state.
- Redesigned provider model management with remote model selection and autosave status feedback.

#### Changed

- Reduced VSIX package size to improve distribution efficiency.
- Improved responsiveness during chat message updates and streamlined provider and model configuration flows.
- Refined internal architecture to improve overall stability and maintainability.

### 中文

#### 新增

- 新增聊天消息中的 Markdown 表格、任务列表、LaTeX、Mermaid 图表与常规图表渲染支持。
- 新增助手分组折叠与展开状态的持久化保存。
- 重构供应商模型管理流程，支持远端模型选择与自动保存状态提示。

#### 变更

- 缩小 VSIX 包体积，提升分发与安装效率。
- 优化聊天消息更新时的响应表现，并简化供应商与模型配置流程。
- 调整内部架构，提升整体稳定性与可维护性。
