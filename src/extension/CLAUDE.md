# 扩展适配层 (Extension Adapter Layer)

[根目录](../../CLAUDE.md) > **src/extension**

## 模块职责

扩展适配层是 ChatBuddy 与 VS Code API 的桥接层，负责：

1. **生命周期管理**: 扩展激活 (`activate`) 与停用 (`deactivate`)
2. **依赖注入**: 构建并组装核心业务模块（Repository、Controller、Runtime）
3. **命令注册**: 将所有业务命令注册到 VS Code 命令系统
4. **视图管理**: 创建和管理 TreeProvider、TreeView、WebViewPanel
5. **事件订阅**: 统一管理资源释放与事件监听

**核心原则**: 本层不包含业务逻辑，只负责适配与协调，所有业务操作委托给 `src/chatbuddy/` 层。

---

## 入口与启动

### 主入口文件

**`src/extension.ts`**

扩展的激活入口，负责初始化整个应用：

```typescript
export async function activate(context: vscode.ExtensionContext) {
  // 1. 全局异常兜底
  process.on('unhandledRejection', unhandledRejectionHandler);

  // 2. 依赖注入链
  const repository = new ChatStateRepository(context);
  await repository.initialize();

  const providerClient = new OpenAICompatibleClient();
  const mcpRuntime = new McpRuntime();
  const chatController = new ChatController(repository, providerClient, mcpRuntime, context.extensionUri);

  // 3. 视图构建
  const { assistantsTreeProvider, recycleBinTreeProvider, sessionsTreeProvider } = createTreeProviders(repository);
  const { assistantsTreeView, recycleBinTreeView, sessionsTreeView, settingsTreeView } = createTreeViews(...);

  // 4. 面板控制器
  const { settingsCenterPanelController, assistantEditorPanelController } = createPanelControllers(...);

  // 5. 命令注册
  const commandDisposables = registerCommands(...);

  // 6. 订阅管理
  context.subscriptions.push(...);
}
```

**初始化顺序**:
1. 异常处理器 → 防止扩展崩溃
2. 状态仓库 → 加载持久化数据
3. 提供商客户端 → 准备 API 调用
4. MCP 运行时 → 初始化工具调用
5. 聊天控制器 → 组装子服务
6. 视图层 → 构建树视图和面板
7. 命令层 → 注册所有命令
8. 订阅管理 → 统一释放资源

---

## 对外接口

### 命令模块

命令按功能域拆分为多个模块，每个模块导出一个 `register*Commands()` 函数：

| 模块 | 文件 | 职责 | 命令数量 |
|------|------|------|----------|
| **设置命令** | `settingsCommands.ts` | 打开设置、模型配置、默认模型、MCP、关于 | 6 |
| **导航命令** | `navigationCommands.ts` | 打开助手聊天、树视图操作 | 2 |
| **助手树命令** | `assistantTreeCommands.ts` | 助手树的搜索、折叠、展开 | 4 |
| **助手管理命令** | `assistantManagementCommands.ts` | 助手的创建、编辑、删除、置顶、分组管理 | 12 |
| **会话命令** | `sessionCommands.ts` | 会话的创建、重命名、删除、导出、清空 | 8 |
| **语言菜单命令** | `localeMenuCommands.ts` | 中英文菜单别名命令注册 | 36 |

**共享上下文接口**:

```typescript
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

所有命令通过解构获取依赖，确保可测试性与灵活性。

### 视图模块

**`src/extension/treeViews.ts`**

负责创建和管理 4 个 TreeView：

| TreeView | ID | TreeProvider | 说明 |
|----------|-----|--------------|------|
| **助手视图** | `chatbuddy.assistantsView` | `AssistantsTreeProvider` | 显示活跃助手（默认分组 + 自定义分组） |
| **会话视图** | `chatbuddy.sessionsView` | `SessionsTreeProvider` | 显示当前选中助手的所有会话 |
| **回收站视图** | `chatbuddy.recycleBinView` | `RecycleBinTreeProvider` | 显示已删除的助手 |
| **设置视图** | `chatbuddy.settingsView` | `SettingsTreeProvider` | 显示设置中心入口点 |

**关键方法**:
- `createTreeProviders(repository)`: 创建所有 TreeProvider 实例
- `createTreeViews(...)`: 创建所有 TreeView 实例并绑定到 VS Code

### 面板控制器

**`src/extension/panelControllers.ts`**

负责创建和管理 WebView 面板：

```typescript
interface PanelControllers {
  settingsCenterPanelController?: SettingsCenterPanelController;
  assistantEditorPanelController?: AssistantEditorPanelController;
}

function createPanelControllers(deps): PanelControllers {
  const settingsCenterPanelController = new SettingsCenterPanelController(...);
  const assistantEditorPanelController = new AssistantEditorPanelController(...);

  return { settingsCenterPanelController, assistantEditorPanelController };
}
```

**面板生命周期**:
- **创建**: 按需创建（用户点击命令时）
- **显示**: 使用 `ViewColumn.One` 避免同一组面板多次打开
- **销毁**: 通过 `context.subscriptions` 统一管理

---

## 关键依赖与配置

### VS Code API 依赖

- `vscode.ExtensionContext`: 扩展上下文（全局存储、路径、订阅）
- `vscode.TreeView<T>`: 树视图组件
- `vscode.WebviewPanel`: WebView 面板
- `vscode.commands`: 命令注册与执行
- `vscode.window`: UI 交互（通知、输入框）

### 业务模块依赖

- `ChatStateRepository`: 状态管理与持久化
- `ChatController`: 聊天控制器（消息处理、工具调用）
- `OpenAICompatibleClient`: 提供商客户端（API 调用）
- `McpRuntime`: MCP 运行时（工具/资源/Prompt 管理）

---

## 数据模型

本层不定义数据模型，所有数据模型来自 `src/chatbuddy/types.ts`：

### 核心类型

- `AssistantProfile`: 助手配置
- `ChatSessionDetail`: 会话详情
- `ChatBuddySettings`: 全局设置
- `ProviderProfile`: 提供商配置
- `McpServerProfile`: MCP 服务器配置

---

## 测试与质量

### 测试策略

本层主要通过**集成测试**验证，不单独进行单元测试。测试重点：

1. **命令注册**: 验证所有命令正确注册到 VS Code
2. **生命周期**: 验证 `activate` 和 `deactivate` 正常执行
3. **资源释放**: 验证所有订阅正确释放
4. **错误处理**: 验证初始化失败时的降级处理

### 错误处理

**初始化失败降级**:

```typescript
try {
  await repository.initialize();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  warn('ChatStateRepository initialization failed:', msg);
  void vscode.window.showErrorMessage(
    `ChatBuddy initialization failed: ${msg}. Some features may be unavailable.`
  );
}
```

**全局异常兜底**:

```typescript
const unhandledRejectionHandler = (reason: unknown) => {
  if (reason instanceof Error) {
    const msg = reason.message || '';
    const name = reason.name || '';
    if (name === 'Canceled' || name === 'AbortError' || msg === 'Channel has been closed') {
      return; // 静默忽略良性错误
    }
  }
  warn('Unhandled promise rejection:', reason);
};
process.on('unhandledRejection', unhandledRejectionHandler);
```

---

## 常见问题 (FAQ)

### Q1: 为什么命令要拆分成多个模块？

**A**: 按功能域拆分命令可以提高代码可维护性，每个模块专注于一个领域，便于测试和扩展。

### Q2: 为什么使用 `context.subscriptions` 管理资源？

**A**: VS Code 在扩展停用时会自动调用所有订阅的 `dispose()` 方法，统一管理可以防止资源泄漏。

### Q3: 如何添加新命令？

**A**:
1. 在对应的命令模块中添加命令处理函数
2. 在 `registerCommands()` 中注册到 VS Code
3. 在 `package.json` 的 `contributes.commands` 中声明

### Q4: TreeView 和 TreeProvider 的区别是什么？

**A**:
- **TreeProvider**: 数据提供器，负责提供树的数据结构
- **TreeView**: VS Code UI 组件，负责渲染树并处理用户交互

### Q5: 为什么要在 `activate` 中注册全局异常处理器？

**A**: VS Code 的 webview 生命周期事件会产生良性的 Promise 拒绝（如 `Canceled`、`AbortError`），全局处理器可以防止这些错误污染日志，同时捕获真正的未处理异常。

---

## 相关文件清单

### 核心文件

- `src/extension.ts`: 扩展入口
- `src/extension/activationTypes.ts`: 激活层类型定义
- `src/extension/shared.ts`: 共享上下文类型
- `src/extension/commands.ts`: 命令注册聚合
- `src/extension/panelControllers.ts`: 面板控制器创建
- `src/extension/treeViews.ts`: 视图创建

### 命令模块

- `src/extension/settingsCommands.ts`: 设置命令
- `src/extension/navigationCommands.ts`: 导航命令
- `src/extension/assistantTreeCommands.ts`: 助手树命令
- `src/extension/assistantManagementCommands.ts`: 助手管理命令
- `src/extension/sessionCommands.ts`: 会话命令
- `src/extension/localeMenuCommands.ts`: 语言菜单命令

### 数据操作

- `src/extension/dataActions.ts`: 数据导入/导出/重置操作
