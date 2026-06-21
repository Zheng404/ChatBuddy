/**
 * CompassSettingsStore providerApiKeys dirty 判断回归测试（Bug 4 修复）。
 *
 * 验证 setProviderApiKeys / setKvCompat 的 dirty 判断对键顺序无关：
 * 相同的键值对（不同的枚举顺序）不应触发不必要的 dirty 标记。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

import { CompassSettingsStore } from '../../../chatbuddy/compassStorage/settingsStore';
import { createCompassPaths } from '../../../chatbuddy/compassStorage/paths';
import { LEGACY_PROVIDER_API_KEYS_KEY } from '../../../chatbuddy/compassStorage/paths';
import type { StructuredStateDocument } from '../../../chatbuddy/compassStorage/types';
import { DEFAULT_SETTINGS } from '../../../chatbuddy/stateSanitizers';
import { createEmptyDefaultModels } from '../../../chatbuddy/modelCatalog';

function buildStructuredDocument(): StructuredStateDocument {
  return {
    core: {
      groups: [{ id: 'default', name: 'Default', kind: 'default', createdAt: 1, updatedAt: 1 }],
      assistants: [],
    },
    ui: {
      selectedAssistantId: undefined,
      selectedSessionIdByAssistant: {},
      sessionPanelCollapsed: false,
      collapsedGroupIds: [],
    },
    settingsGeneral: { ...DEFAULT_SETTINGS },
    settingsModelConfig: { providers: [] },
    settingsDefaultModels: { defaultModels: createEmptyDefaultModels() },
    settingsMcp: { mcp: { servers: [], groups: [], maxToolRounds: 8 } },
  };
}

async function createTmpPaths() {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'settings-test-'));
  const paths = createCompassPaths(tmpDir);
  await fs.promises.mkdir(paths.metaPath, { recursive: true });
  return { paths, cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }) };
}

void test('setProviderApiKeys — 相同键值对不同顺序不触发 dirty', async () => {
  const { paths, cleanup } = await createTmpPaths();
  try {
    const store = new CompassSettingsStore();
    store.setStructuredStateDocument(buildStructuredDocument());

    // 初始化：设置一组 api keys 并持久化
    store.setProviderApiKeys({ openai: 'sk-a', anthropic: 'sk-b', gemini: 'sk-c' });
    assert.equal(store.isDirty(), true, '首次设置应标记 dirty');
    await store.persist(paths);

    // reload 使内存与磁盘一致
    await store.load(paths);
    assert.equal(store.isDirty(), false, 'load 后应清除 dirty');

    // 用不同的键顺序设置相同的键值对
    store.setProviderApiKeys({ gemini: 'sk-c', openai: 'sk-a', anthropic: 'sk-b' });
    assert.equal(store.isDirty(), false, '相同键值对不同顺序不应触发 dirty（Bug 4 修复）');
  } finally {
    cleanup();
  }
});

void test('setProviderApiKeys — 实际变更触发 dirty', async () => {
  const { paths, cleanup } = await createTmpPaths();
  try {
    const store = new CompassSettingsStore();
    store.setStructuredStateDocument(buildStructuredDocument());
    store.setProviderApiKeys({ openai: 'sk-a' });
    await store.persist(paths);
    await store.load(paths);

    // 修改一个值
    store.setProviderApiKeys({ openai: 'sk-changed' });
    assert.equal(store.isDirty(), true, '值变更应触发 dirty');

    await store.persist(paths);
    await store.load(paths);

    // 增加一个键
    store.setProviderApiKeys({ openai: 'sk-changed', anthropic: 'sk-new' });
    assert.equal(store.isDirty(), true, '新增键应触发 dirty');

    await store.persist(paths);
    await store.load(paths);

    // 删除一个键
    store.setProviderApiKeys({ openai: 'sk-changed' });
    assert.equal(store.isDirty(), true, '删除键应触发 dirty');
  } finally {
    cleanup();
  }
});

void test('setKvCompat — providerApiKeys 不同键顺序不触发 dirty', async () => {
  const { paths, cleanup } = await createTmpPaths();
  try {
    const store = new CompassSettingsStore();
    store.setStructuredStateDocument(buildStructuredDocument());
    store.setProviderApiKeys({ openai: 'sk-a', anthropic: 'sk-b' });
    await store.persist(paths);
    await store.load(paths);

    // 通过 setKvCompat 用不同顺序设置相同键值对
    const payload = JSON.stringify({ anthropic: 'sk-b', openai: 'sk-a' });
    const handled = store.setKvCompat(
      LEGACY_PROVIDER_API_KEYS_KEY,
      payload,
      'unused-state-key',
      LEGACY_PROVIDER_API_KEYS_KEY
    );
    assert.equal(handled, true, 'setKvCompat 应处理 providerApiKeysStoreKey');
    assert.equal(store.isDirty(), false, '相同键值对不同顺序不应触发 dirty（Bug 4 修复）');
  } finally {
    cleanup();
  }
});
