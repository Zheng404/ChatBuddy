# 工具函数模块 (Utilities)

[根目录](../../../CLAUDE.md) > [业务核心层](../CLAUDE.md) > **utils**

## 模块职责

工具函数模块提供 ChatBuddy 各模块共享的**通用工具函数**，遵循单一职责原则，每个文件专注于一个工具领域。

**核心原则**：
- **纯函数优先**: 尽量使用无副作用的纯函数
- **类型安全**: 充分利用 TypeScript 类型守卫
- **零外部依赖**: 除标准库外不依赖其他模块（`index.ts` 除外）

---

## 工具函数清单

| 文件 | 导出 | 职责 | 典型用法 |
|------|------|------|----------|
| `math.ts` | `clamp` | 数值限制在范围内 | `clamp(value, 0, 100)` |
| `id.ts` | `createId`, `nowTs` | 唯一 ID 生成和时间戳 | `createId()` → `'abc123...'` |
| `csp.ts` | `getNonce`, `buildCsp` | CSP 策略构建 | 生成 WebView CSP 头 |
| `html.ts` | `escapeHtml`, `escapeHtmlAttr` | HTML 转义 | 防止 XSS 注入 |
| `locale.ts` | `getLocaleFromSettings`, `resolveLocaleString` | 本地化辅助 | 快捷键标签、选项文本 |
| `guard.ts` | `isString`, `isObject`, `isNonEmptyArray` | 类型守卫 | 运行时类型检查 |
| `fs.ts` | `readFile`, `writeFile`, `fileExists` | 文件操作封装 | 异步文件 I/O |
| `provider.ts` | `normalizeProvider` | Provider 配置规范化 | 标准化 API 端点 URL |
| `error.ts` | `toErrorMessage` | 错误信息提取 | 从 unknown 安全获取消息 |
| `logger.ts` | `warn`, `error`, `log` | 日志输出 | `warn('something failed')` |
| `retry.ts` | `retryWithBackoff` | 指数退避重试 | API 调用重试 |
| `template.ts` | 模板解析 | 模板字符串变量替换 | 提示词模板处理 |
| `index.ts` | 全部聚合 | 统一导出入口 | `import { ... } from './utils'` |

---

## 关键工具详解

### 类型守卫 (`guard.ts`)

```typescript
// 安全地检查类型，配合 TypeScript 类型收窄
if (isNonEmptyArray(data)) {
  // data 被收窄为 unknown[] & { length > 0 }
  const first = data[0];
}

if (isObject(value)) {
  // value 被收窄为 Record<string, unknown>
  const keys = Object.keys(value);
}
```

### HTML 转义 (`html.ts`)

```typescript
const userInput = '<script>alert(1)</script>';
const safe = escapeHtml(userInput);
// &lt;script&gt;alert(1)&lt;/script&gt;
```

**WebView 安全**: 所有用户输入在插入 DOM 前必须经过转义。

### CSP 构建 (`csp.ts`)

```typescript
const csp = buildCsp(nonce, extensionUri);
// 生成严格的 Content-Security-Policy 字符串
// 限制脚本来源、样式来源、图片来源等
```

### 指数退避重试 (`retry.ts`)

```typescript
const result = await retryWithBackoff(
  async () => fetchModels(provider),
  { maxRetries: 3, baseDelayMs: 1000 }
);
// 第1次延迟: 1000ms
// 第2次延迟: 2000ms
// 第3次延迟: 4000ms
```

### ID 生成 (`id.ts`)

```typescript
const id = createId();     // 21字符 Crockford base32
const ts = nowTs();        // 毫秒级时间戳
```

---

## 依赖关系

```
utils/
  ├── index.ts (聚合导出，依赖所有子模块)
  └── 各工具文件 (相互独立，无交叉依赖)
```

**重要**: 各工具文件之间**不相互依赖**，确保可以单独导入使用。

---

## 使用方式

### 统一导入（推荐）

```typescript
import { escapeHtml, createId, retryWithBackoff } from './utils';
```

### 单独导入（按需）

```typescript
import { escapeHtml } from './utils/html';
import { createId } from './utils/id';
```

---

## 相关文件清单

- `index.ts`: 工具函数统一导出
- `math.ts`: 数学工具
- `id.ts`: ID 与时间戳生成
- `csp.ts`: CSP 策略构建
- `html.ts`: HTML 转义
- `locale.ts`: 本地化辅助
- `guard.ts`: 类型守卫
- `fs.ts`: 文件操作
- `provider.ts`: Provider 规范化
- `error.ts`: 错误处理
- `logger.ts`: 日志工具
- `retry.ts`: 重试机制
- `template.ts`: 模板解析
- **使用模式说明**: 记录统一导入和单独导入两种使用方式
