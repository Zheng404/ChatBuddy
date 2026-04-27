# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, but kept intentionally simple for this project.

## [Unreleased]

### English

#### Added

- Document parsing for PDF, DOCX, and PPTX files. Files are extracted as plain text and sent to the model.
- Multi-image paste support: users can paste or select multiple images at once.
- OCR fallback: when a non-vision model receives images, text is extracted via OCR and appended as a text prompt.
- External image file storage: image base64 data is saved to the `images/` directory instead of persisted state, reducing memory usage.
- File attachment cards in chat messages: files are shown as collapsible cards rather than inline code blocks.
- SVG support in image picker dialog.

#### Changed

- `message.content` now stores only the user's raw text input; file contents are injected at provider-request time via `toProviderConversationMessages`.
- Optimistic send preview now includes images and files.
- File picker dialogs are restricted to supported file types.

#### Fixed

- Fixed `pdf-parse` API usage (destructured `PDFParse` instead of wrong property access).
- Fixed PPTX XML entity decoding and numeric slide sorting (`slide10` before `slide2`).
- Fixed `cloneMessage` and `normalizeMessageInput` losing `path` and `files` fields.
- Fixed `extractImagesToFiles` not handling imported backup images correctly.
- Fixed empty base64 images being sent to the provider or rendered as broken images.
- Fixed WebView blocking image paste for non-vision models, which prevented the OCR fallback from ever executing.
- Fixed history messages with images being sent to non-vision models after model switch.
- Fixed OCR complete failure with no text input causing an empty user message.
- Fixed `clearSessionsForAssistants` not cleaning up image files.
- Fixed file truncation hint not replacing `{name}` placeholder.
- Fixed CSS variables (`--surface`, `--hover-bg`) and inline `transform` on file toggle.

### 中文

#### 新增

- 文档解析：支持 PDF、DOCX、PPTX 文件，自动提取纯文本发送给模型。
- 多图片粘贴：支持一次性粘贴或选择多张图片。
- OCR 降级：当非视觉模型收到图片时，通过 OCR 提取文字并作为文本提示词附加。
- 图片外部文件存储：图片 base64 数据保存到 `images/` 目录，不再存放在持久化状态中，减少内存占用。
- 聊天中文件附件卡片：文件以可折叠卡片形式显示，不再直接内联代码块。
- 图片选择对话框支持 SVG 格式。

#### 变更

- `message.content` 仅存储用户原始文本输入；文件内容在构建 Provider 请求时通过 `toProviderConversationMessages` 动态注入。
- 乐观发送预览现在包含图片和文件。
- 文件选择对话框限制为支持的文件类型。

#### 修复

- 修复 `pdf-parse` API 调用方式（解构 `PDFParse` 类）。
- 修复 PPTX XML 实体未解码和幻灯片按字母排序错乱（`slide10` 排在 `slide2` 之前）。
- 修复 `cloneMessage` 和 `normalizeMessageInput` 丢失 `path` 和 `files` 字段。
- 修复 `extractImagesToFiles` 导入备份图片时处理不当。
- 修复空 base64 图片被发送给 Provider 或渲染为裂图。
- 修复 WebView 阻止非视觉模型图片粘贴，导致 OCR 降级逻辑永远无法执行。
- 修复切换模型后历史消息中的图片仍发送给不支持视觉的模型。
- 修复 OCR 完全失败且没有文本输入时发送空消息。
- 修复 `clearSessionsForAssistants` 未清理图片文件。
- 修复文件截断提示未替换 `{name}` 占位符。
- 修复 CSS 变量（`--surface`、`--hover-bg`）和文件切换按钮的内联 `transform` 不生效。

## [0.3.2] - 2026-04-25

### English

#### Added

- Added GPT-5.5 and GPT-5.5 Pro model capability entries (vision, tools, reasoning, web search).
- Added DeepSeek-V4-Flash and DeepSeek-V4-Pro model capability entries (tools, reasoning).
- Added Gemini native API adapter (generateContent/streamGenerateContent) with full tool calling, streaming, and multimodal support.
- Added `gemini` as a third ProviderApiType alongside chat_completions and responses.
- Added Custom (Gemini) template option in provider creation modal.
- Added `test:watch` script to package.json.

#### Changed

- Updated GPT-4.1 series to include web search capability.
- Updated o3-mini to include vision capability.
- Updated DeepSeek reasoner and R1 to include tools capability (R1-0528+).
- Updated DeepSeek-V4 to include reasoning capability.
- Enhanced vision/reasoning pattern fallback to cover GPT-4.1, GPT-5.4/5.5 variants.
- Split settingsCenterJs into modular files (modelConfigActions, modelConfigModals, modelConfigState, modelConfigProviderRenderer, modelConfigModelsRenderer, mcpModal).
- Split eventListeners.ts (648 lines) into 8 focused sub-modules (nav, layout, general, dataManagement, mcp, providerEditor, modelManager, modals).
- Replace inline template selector with modal popup for provider creation.
- Add SSE read timeout in providerClient.ts to prevent indefinite hangs.
- Extract `buildModelSelectOptions()` and `renderModelEmptyState()` helpers to eliminate code duplication.
- Improve test coverage: 195 → 287+ → 349 tests.

#### Fixed

- Fixed duplicate `updateSettings` and async dispose in chat controller.
- Fixed innerHTML escaping in dataManagement backup list empty state.
- Fixed CI test failures and panel icon resolution.
- Fixed flaky timer test using mock.timers in behavior test.

#### Documentation

- Optimized `.gitignore` and `.vscodeignore` configuration.

### 中文

#### 新增

- 新增 GPT-5.5 和 GPT-5.5 Pro 模型能力条目（视觉、工具、推理、网络搜索）。
- 新增 DeepSeek-V4-Flash 和 DeepSeek-V4-Pro 模型能力条目（工具、推理）。
- 新增 Gemini 原生 API 适配器（generateContent/streamGenerateContent），完整支持工具调用、流式输出和多模态。
- 新增 `gemini` 提供商 API 类型（与 chat_completions、responses 并列）。
- 新增提供商创建模态框中的 Gemini 自定义模板选项。
- 新增 `test:watch` 脚本。

#### 变更

- GPT-4.1 系列补充网络搜索能力；o3-mini 补充视觉能力。
- DeepSeek reasoner/R1 补充工具调用能力（R1-0528 起）；DeepSeek-V4 补充推理能力。
- 增强视觉/推理模式回退匹配，覆盖 GPT-4.1、GPT-5.4/5.5 变体。
- 拆分设置中心 JS 为模块化文件；拆分 eventListeners.ts（648 行）为 8 个子模块。
- 提供商创建由内联模板选择器改为模态框弹窗。
- providerClient.ts 新增 SSE 读取超时，防止无限挂起。
- 提取公共函数消除代码重复。
- 测试覆盖率提升：195 → 287+ → 349 个测试。

#### 修复

- 修复聊天控制器中重复的 updateSettings 和异步 dispose 问题。
- 修复数据管理备份列表空状态的 innerHTML 转义问题。
- 修复 CI 测试失败和面板图标解析问题。
- 修复行为测试中使用 mock.timers 的定时器测试不稳定问题。

#### 文档

- 优化 `.gitignore` 和 `.vscodeignore` 配置。

## [0.3.1] - 2026-04-23

### English

#### Changed

- Refactored large files across the codebase to improve maintainability and build performance.
- Switched Mermaid diagram engine to ESM build for full diagram type support (including mindmap, quadrantChart, etc.).
- Unified CSS design tokens for consistent theming across light and dark modes.
- Cleaned up i18n strings by removing unused translation keys.
- Enhanced CI workflow with additional quality checks.

#### Fixed

- Fixed TypeScript type compatibility issues under strict mode.
- Restored `@cfworker/json-schema` dependency required by the MCP client.

#### Documentation

- Updated README screenshots to match the current UI.

### 中文

#### 变更

- 项目级代码重构：拆分大文件以提升可维护性与构建性能。
- Mermaid 图表引擎切换至 ESM 构建，完整支持所有图表类型（包括思维导图、象限图等）。
- 统一 CSS 设计 token，提升明暗主题一致性。
- 清理国际化字符串，移除未使用的翻译键。
- 增强 CI 流程，增加额外质量检查。

#### 修复

- 修复 TypeScript 严格模式下的类型兼容问题。
- 恢复 MCP 客户端所需的 `@cfworker/json-schema` 依赖。

#### 文档

- 更新 README 截图以匹配当前 UI。

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
