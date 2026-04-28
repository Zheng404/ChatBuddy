# 国际化模块 (Internationalization)

[根目录](../../../CLAUDE.md) > [业务核心层](../CLAUDE.md) > **i18n**

## 模块职责

国际化模块负责 ChatBuddy 的**运行时本地化**支持，提供完整的中英文双语界面切换能力。

**核心职责**：

1. **字符串管理**: 集中管理所有用户可见的文本字符串
2. **运行时切换**: 支持在不重启 VS Code 的情况下切换语言
3. **模板变量**: 支持带变量的字符串格式化（如 `{name}` 替换）
4. **语言检测**: 根据 VS Code 语言设置自动选择默认语言

---

## 模块结构

```
i18n/
├── runtimeStrings.ts   # 运行时字符串聚合入口
├── strings.en.ts       # 英文翻译（~22KB）
└── strings.zh-CN.ts    # 中文翻译（~22KB）
```

### 外部入口

**`i18n.ts`**（位于 `src/chatbuddy/` 根目录）是国际化的主入口模块，提供：

- `normalizeLocale()`: 将 VS Code 语言标识规范化为 `zh-CN` 或 `en`
- `resolveLocale()`: 根据用户设置和 VS Code 语言解析最终语言
- `getStrings()`: 获取指定语言的字符串表
- `formatString()`: 模板字符串格式化（`{key}` 替换）
- `getLanguageOptions()`: 获取语言选择选项

---

## 字符串组织

### 字符串表结构 (`RuntimeStrings`)

所有语言共享相同的 `RuntimeStrings` 接口，确保翻译完整性：

```typescript
interface RuntimeStrings {
  // 通用
  appName: string;
  untitledSession: string;
  loading: string;

  // 按钮
  send: string;
  cancel: string;
  confirm: string;
  delete: string;

  // 设置
  settingsTitle: string;
  languageAuto: string;
  languageZhCn: string;
  languageEn: string;

  // 错误
  errorNetwork: string;
  errorTimeout: string;
  errorUnknown: string;

  // ... 更多分类
}
```

### 翻译文件规模

| 文件 | 大小 | 字符串数量 |
|------|------|----------|
| `strings.en.ts` | ~22KB | ~300+ |
| `strings.zh-CN.ts` | ~22KB | ~300+ |

---

## 使用方式

### 获取当前语言字符串

```typescript
import { resolveLocale, getStrings } from './i18n';

const locale = resolveLocale(settings.locale, vscode.env.language);
const strings = getStrings(locale);

// 使用字符串
const title = strings.untitledSession;
```

### 带变量的格式化

```typescript
import { formatString } from './i18n';

const msg = formatString(strings.deleteConfirm, { name: 'My Assistant' });
// 中文: "确定要删除助手 My Assistant 吗？"
// 英文: "Are you sure you want to delete assistant My Assistant?"
```

### 语言选项

```typescript
import { getLanguageOptions } from './i18n';

const options = getLanguageOptions(strings);
// [
//   { value: 'auto', label: '自动 (Auto)' },
//   { value: 'zh-CN', label: '简体中文' },
//   { value: 'en', label: 'English' }
// ]
```

---

## 语言解析规则

### 优先级

1. **用户显式设置**: 如果用户在设置中选择了 `zh-CN` 或 `en`，优先使用
2. **VS Code 语言**: 如果设置为 `auto`，根据 `vscode.env.language` 推断
3. **默认值**: 无法识别时回退到 `en`

### 语言映射

| VS Code 语言 | 解析结果 |
|-------------|---------|
| `zh-CN`, `zh-TW`, `zh` | `zh-CN` |
| `en`, `en-US`, `en-GB` | `en` |
| 其他 | `en` (回退) |

---

## 添加新字符串的流程

1. 在 `types.ts` 的 `RuntimeStrings` 接口中添加新字段
2. 在 `strings.en.ts` 中添加英文翻译
3. 在 `strings.zh-CN.ts` 中添加中文翻译
4. 在使用处通过 `getStrings(locale).newField` 引用

---

## 相关文件清单

- `../i18n.ts`: 国际化主入口（语言解析、格式化）
- `runtimeStrings.ts`: 运行时字符串聚合
- `strings.en.ts`: 英文翻译表
- `strings.zh-CN.ts`: 中文翻译表
