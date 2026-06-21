/**
 * unwrapImportedStorageBackup 深度 shape 校验回归测试（Bug 5 修复）。
 *
 * 验证 `structuredState` 关键嵌套字段（数组/对象）被正确校验：
 * - 顶层字段是对象但嵌套字段类型错误时，抛出含具体字段路径的清晰错误
 * - 非法 schema/version 仍返回 undefined（区别于「是 backup 但已损坏」的抛出）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { unwrapImportedStorageBackup } from '../../../chatbuddy/stateHelpers';
import type { StructuredStateDocument } from '../../../chatbuddy/compassStorage/types';
import { DEFAULT_SETTINGS } from '../../../chatbuddy/stateSanitizers';
import { createEmptyDefaultModels } from '../../../chatbuddy/modelCatalog';

function buildValidStructuredState(): StructuredStateDocument {
  return {
    core: {
      groups: [],
      assistants: [],
    },
    ui: {
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

function buildValidBackup(overrides: Record<string, unknown> = {}): unknown {
  return {
    schema: 'chatbuddy.backup.compass',
    version: 2,
    storage: {
      layout: 'compass',
      layoutVersion: 3,
      structuredState: buildValidStructuredState(),
      providerApiKeys: {},
      sessions: [],
      kv: {},
      ...overrides,
    },
  };
}

/**
 * 修改 backup 中 structuredState 的字段（用于构造各种损坏场景）。
 * 使用 any 类型避免 TypeScript 类型系统拒绝赋值错误类型的值（测试需要故意写入错误类型）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setStructuredField(backup: unknown, mutate: (structuredState: any) => void): void {
  const storage = (backup as { storage: { structuredState: unknown } }).storage;
  mutate(storage.structuredState);
}

void test('unwrapImportedStorageBackup — 合法 backup 正确解包', () => {
  const result = unwrapImportedStorageBackup(buildValidBackup());
  assert.ok(result, '合法 backup 应返回解包结果');
  assert.ok(result!.structuredState, '应包含 structuredState');
  assert.deepEqual(result!.sessions, [], '应包含 sessions');
});

void test('unwrapImportedStorageBackup — 非 compass schema 返回 undefined', () => {
  const result = unwrapImportedStorageBackup({ schema: 'other', version: 2 });
  assert.equal(result, undefined, '非 compass schema 应返回 undefined');
});

void test('unwrapImportedStorageBackup — version 超出范围返回 undefined', () => {
  const result = unwrapImportedStorageBackup({
    schema: 'chatbuddy.backup.compass',
    version: 99,
  });
  assert.equal(result, undefined, 'version 超出范围应返回 undefined');
});

void test('unwrapImportedStorageBackup — core.groups 不是数组时抛出', () => {
  const invalid = buildValidBackup();
  setStructuredField(invalid, (s) => { s.core.groups = 'not-array'; });
  assert.throws(
    () => unwrapImportedStorageBackup(invalid),
    /structuredState\.core\.groups/,
    '应抛出包含字段路径的错误'
  );
});

void test('unwrapImportedStorageBackup — core.assistants 不是数组时抛出', () => {
  const invalid = buildValidBackup();
  setStructuredField(invalid, (s) => { s.core.assistants = { foo: 'bar' }; });
  assert.throws(
    () => unwrapImportedStorageBackup(invalid),
    /structuredState\.core\.assistants/,
    '应抛出包含字段路径的错误'
  );
});

void test('unwrapImportedStorageBackup — ui.collapsedGroupIds 不是数组时抛出', () => {
  const invalid = buildValidBackup();
  setStructuredField(invalid, (s) => { s.ui.collapsedGroupIds = 'oops'; });
  assert.throws(
    () => unwrapImportedStorageBackup(invalid),
    /structuredState\.ui\.collapsedGroupIds/,
    '应抛出包含字段路径的错误'
  );
});

void test('unwrapImportedStorageBackup — settingsModelConfig.providers 不是数组时抛出', () => {
  const invalid = buildValidBackup();
  setStructuredField(invalid, (s) => { s.settingsModelConfig.providers = null; });
  assert.throws(
    () => unwrapImportedStorageBackup(invalid),
    /structuredState\.settingsModelConfig\.providers/,
    '应抛出包含字段路径的错误'
  );
});

void test('unwrapImportedStorageBackup — settingsDefaultModels.defaultModels 不是对象时抛出', () => {
  const invalid = buildValidBackup();
  setStructuredField(invalid, (s) => { s.settingsDefaultModels.defaultModels = 'invalid'; });
  assert.throws(
    () => unwrapImportedStorageBackup(invalid),
    /structuredState\.settingsDefaultModels\.defaultModels/,
    '应抛出包含字段路径的错误'
  );
});

void test('unwrapImportedStorageBackup — settingsMcp.mcp 不是对象时抛出', () => {
  const invalid = buildValidBackup();
  setStructuredField(invalid, (s) => { s.settingsMcp.mcp = null; });
  assert.throws(
    () => unwrapImportedStorageBackup(invalid),
    /structuredState\.settingsMcp\.mcp/,
    '应抛出包含字段路径的错误'
  );
});

void test('unwrapImportedStorageBackup — core.templates 存在但不是数组时抛出', () => {
  const invalid = buildValidBackup();
  setStructuredField(invalid, (s) => { s.core.templates = { not: 'array' }; });
  assert.throws(
    () => unwrapImportedStorageBackup(invalid),
    /structuredState\.core\.templates/,
    '应抛出包含字段路径的错误'
  );
});
