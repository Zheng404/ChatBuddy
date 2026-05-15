# 双 IDE 并发风险分析

> 分析两个 VS Code 实例同时运行 ChatBuddy 时的数据竞争风险。

---

## 风险总览

| 编号 | 风险场景 | 严重程度 | 根因 | 当前状态 |
|------|---------|---------|------|---------|
| R1 | Last-Writer-Wins 覆盖 | **高** | 写前不读，直接覆盖 state.core.json | **已修复** (Worker 2) |
| R2 | Persist Debounce 竞态 | **中** | 多 IDE 同时 debounce 写入同一文件 | **部分缓解** |
| R3 | Reload 时机竞态 | **中** | 读取磁盘时恰好被其他 IDE 覆盖 | **已修复** (Worker 2) |
| R4 | JSONL 追加并发 | **低** | 两个 IDE 同时追加同一 session 文件 | **Worker 3 处理** |
| R5 | Selection 字段覆盖 | **低** | UI 状态被其他 IDE 写入并覆盖 | **已修复** (Worker 1) |
| R6 | 自写标记竞态 | **低** | 写入 .last-write.json 与 watcher 触发存在时间窗口 | **已修复** (Worker 3) |
| R7 | Provider API Keys 覆盖 | **低** | API 密钥被其他 IDE 覆盖 | **未处理** |

---

## R1: Last-Writer-Wins 覆盖 (已修复)

### 场景

```
IDE A: 修改 Assistant X 的 systemPrompt
       → persist() → 写入 state.core.json (v1)

IDE B: 同时修改 Assistant Y 的 temperature
       → persist() → 写入 state.core.json (v2)

结果: IDE A 对 X 的修改被 IDE B 的写入覆盖，数据丢失
```

### 根因

`StatePersistenceService.persist()` 之前直接调用 `writeStateLite()` 写入内存状态，**不读取磁盘当前内容**。

```typescript
// 修复前
this.context.storage.writeStateLite(persistedState, false);
await this.context.storage.flush();
```

### 修复方案

Worker 2 已实现**写前读取 + 三向合并**：

1. `persist()` 写入前先 `readJsonFileWithMtime(stateCorePath)` 读取磁盘
2. 若磁盘有数据，执行 `threeWayMergeState(memory, disk)`：
   - assistants/groups/templates：按 ID 合并，保留 `updatedAt`/`createdAt` 更新的项
   - settings：字段级合并，非空值优先
3. 写入合并后的状态
4. 若合并结果与内存不同，更新内存状态并 bump version

```typescript
// 修复后
const disk = await readJsonFileWithMtime(stateCorePath);
if (disk.data) {
  const merged = threeWayMergeState(persistedState, diskState);
  this.context.storage.writeStateLite(merged, false);
  // ...
}
```

---

## R2: Persist Debounce 竞态 (部分缓解)

### 场景

```
IDE A: 快速修改多个助手 → schedulePersist() debounce 500ms
IDE B: 同时修改设置 → schedulePersist() debounce 500ms

结果: 两个 IDE 几乎同时触发 flush，写入同一文件
```

### 根因

1. `StatePersistenceService.persist()` 有 `persistScheduled` 标志防止同一 IDE 内重复写入
2. 但**跨 IDE 无协调**，两个实例的 debounce 定时器独立运行
3. 原子写入（temp + rename）只保证单文件一致性，不保证跨文件一致性

### 当前缓解

- `writeJsonAtomic()` 保证单文件原子写入（temp → rename）
- 写前读取合并（R1 修复）降低了数据丢失概率
- 但两个 IDE 同时写入仍可能导致：
  - IDE A 读磁盘 → 合并 → 写回
  - IDE B 读磁盘（在 A 写回前）→ 合并 → 写回
  - 结果：A 的合并结果可能被 B 覆盖（仍丢失 A 的变更）

### 残余风险

非原子性的读-改-写序列存在 TOCTOU（Time-of-Check to Time-of-Use）窗口：

```
IDE A: read disk (v1)          ─┐
IDE B: read disk (v1)            │ 同时读取同一版本
IDE A: merge → write (v2)      ─┤
IDE B: merge (基于 v1) → write (v3) ─┘ 覆盖了 A 的 v2
```

### 建议

- 使用文件锁（如 `proper-lockfile`）保证跨进程互斥
- 或引入 generation 号 + CAS（Compare-And-Swap）重试机制

---

## R3: Reload 时机竞态 (已修复)

### 场景

```
IDE A: 写入 state.core.json
IDE B: watcher 触发 → reloadFromSharedStorage()
       → 读取磁盘 → 全量替换 this.state

结果: IDE B 本地未保存的内存修改被磁盘数据覆盖
```

### 根因

`reloadFromSharedStorage()` 之前直接替换 `this.state`：

```typescript
// 修复前
this.persistenceService.hydrateStateFromStorage();
// this.state 被完全替换为磁盘内容
```

### 修复方案

Worker 2 已将 reload 改为**按 ID 合并**：

1. 保存 reload 前的内存状态快照
2. 加载磁盘数据
3. `mergeById()` 合并 assistants/groups/templates（保留更新的）
4. `mergeSettings()` 合并 settings
5. 保留本地 UI 状态（selectedAssistantId 等）

```typescript
// 修复后
const memoryState = { groups, assistants, templates, settings };
// ... load disk ...
const mergedAssistants = this.mergeById(memoryState.assistants, diskState.assistants);
// ...
```

---

## R4: JSONL 追加并发 (Worker 3 处理)

### 场景

```
IDE A: 发送消息到 Session S → appendMessage() → 追加到 S.jsonl
IDE B: 同时发送消息到 Session S → appendMessage() → 追加到 S.jsonl

结果: 两行 JSON 可能交错写入，文件损坏
```

### 根因

`fs.promises.appendFile()` 不是原子操作，多进程同时追加可能导致数据交错。

### 当前状态

Worker 3 负责实现 JSONL 追加模式。可能的方案：
- 使用文件锁保护追加操作
- 或每个 IDE 只追加自己的消息，读取时合并

---

## R5: Selection 字段覆盖 (已修复)

### 场景

```
IDE A: 选中 Assistant X
IDE B: 选中 Assistant Y → persist() 包含 selectedAssistantId
IDE A: reload() → selectedAssistantId 被覆盖为 Y

结果: IDE A 的界面选中状态被 IDE B 干扰
```

### 根因

`selectedAssistantId`、`selectedSessionIdByAssistant`、`collapsedGroupIds`、`sessionPanelCollapsed` 等 UI 状态被存储在共享的 Compass 文件中。

### 修复方案

Worker 1 已将 UI 状态迁移到 VS Code `globalState`（每个 IDE 实例独立）：

1. `persist()` 写入 Compass 前剥离 UI 字段：
   ```typescript
   const { selectedAssistantId, selectedSessionIdByAssistant, ... } = state;
   ```
2. UI 状态通过 `context.globalState` 读写，不进入共享存储

---

## R6: 自写标记竞态 (已修复)

### 场景

```
IDE A: persist() → 写入文件 → 写入 .last-write.json
IDE A 的 watcher: 检测到文件变更 → 读取 .last-write.json

结果: 如果 .last-write.json 写入晚于 watcher 触发，误判为外部变更
```

### 根因

`SyncWatcher` 通过 `.last-write.json` 标记文件区分自写和外部写入，但存在时间窗口。

### 修复方案

Worker 3 已实现：
1. `writeSelfWriteMarker()` 在 persist 成功后写入标记
2. `isSelfWrite()` 检查标记中的 `ideId`
3. `handleChange()` 忽略 `LAST_WRITE_FILE` 本身的变更

---

## R7: Provider API Keys 覆盖 (未处理)

### 场景

```
IDE A: 修改 Provider P 的 API Key → persistSecrets()
IDE B: 修改 Provider Q 的 API Key → persistSecrets()

结果: IDE A 对 P 的修改可能被覆盖
```

### 根因

`persistSecrets()` 直接写入 `providers.api-keys.json`，**不读取磁盘**，无合并逻辑。

### 当前状态

API Keys 存储在独立的 `providers.api-keys.json` 中，与其他状态分离。虽然影响面较小（仅密钥），但仍存在覆盖风险。

### 建议

为 `persistSecrets()` 添加类似的写前读取合并逻辑，或采用字段级合并（按 providerId 合并）。

---

## 总结

| 风险 | 修复状态 | 负责 |
|------|---------|------|
| R1 Last-Writer-Wins | ✅ 已修复 | Worker 2 |
| R2 Persist Debounce | ⚠️ 部分缓解 | - |
| R3 Reload 竞态 | ✅ 已修复 | Worker 2 |
| R4 JSONL 追加 | 🔄 Worker 3 | Worker 3 |
| R5 Selection 覆盖 | ✅ 已修复 | Worker 1 |
| R6 自写标记 | ✅ 已修复 | Worker 3 |
| R7 API Keys 覆盖 | ⬜ 未处理 | - |
