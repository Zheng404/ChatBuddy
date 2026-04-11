import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState,
  sanitizeSettings,
  sanitizeGroups,
  sanitizeMcpSettings,
  sanitizeMcpServer,
  sanitizeProviders,
  sanitizeDefaultModels,
  migrateAssistants,
  normalizeProviderBaseUrl,
  normalizeModelId,
  normalizeMcpKeyValueEntries,
  DEFAULT_SETTINGS
} from '../chatbuddy/stateSanitizers';
import { DEFAULT_GROUP_ID, DELETED_GROUP_ID } from '../chatbuddy/constants';

// ─── createInitialState ──────────────────────────────────────────────────────

test('createInitialState returns a valid empty state', () => {
  const state = createInitialState();

  assert.ok(Array.isArray(state.groups));
  assert.ok(Array.isArray(state.assistants));
  assert.equal(state.assistants.length, 0);
  assert.equal(state.selectedAssistantId, undefined);
  assert.equal(state.sessionPanelCollapsed, false);
  assert.ok(state.settings);
});

test('createInitialState always includes default and deleted groups', () => {
  const state = createInitialState();
  const ids = state.groups.map((g) => g.id);

  assert.ok(ids.includes(DEFAULT_GROUP_ID));
  assert.ok(ids.includes(DELETED_GROUP_ID));
});

// ─── sanitizeSettings ────────────────────────────────────────────────────────

test('sanitizeSettings returns defaults for undefined input', () => {
  const settings = sanitizeSettings(undefined);

  assert.ok(Array.isArray(settings.providers));
  assert.equal(settings.temperature, DEFAULT_SETTINGS.temperature);
  assert.equal(settings.topP, DEFAULT_SETTINGS.topP);
  assert.equal(settings.streamingDefault, DEFAULT_SETTINGS.streamingDefault);
  assert.equal(settings.locale, 'auto');
  assert.equal(settings.sendShortcut, 'enter');
  assert.equal(settings.chatTabMode, 'single');
});

test('sanitizeSettings clamps out-of-range values', () => {
  const settings = sanitizeSettings({
    temperature: 10,
    topP: -1,
    maxTokens: 100000,
    presencePenalty: 5,
    frequencyPenency: -5,
    timeoutMs: 100
  });

  assert.equal(settings.temperature, 2);    // clamped to max
  assert.equal(settings.topP, 0);           // clamped to min
  assert.equal(settings.maxTokens, 65535);   // clamped to max
  assert.equal(settings.timeoutMs, 5000);    // clamped to min
});

test('sanitizeSettings accepts valid locale values', () => {
  assert.equal(sanitizeSettings({ locale: 'zh-CN' }).locale, 'zh-CN');
  assert.equal(sanitizeSettings({ locale: 'en' }).locale, 'en');
  assert.equal(sanitizeSettings({ locale: 'auto' }).locale, 'auto');
  assert.equal(sanitizeSettings({ locale: 'invalid' }).locale, 'auto');
});

test('sanitizeSettings normalizes sendShortcut and chatTabMode', () => {
  assert.equal(sanitizeSettings({ sendShortcut: 'ctrlEnter' }).sendShortcut, 'ctrlEnter');
  assert.equal(sanitizeSettings({ sendShortcut: 'other' }).sendShortcut, 'enter');
  assert.equal(sanitizeSettings({ chatTabMode: 'multi' }).chatTabMode, 'multi');
  assert.equal(sanitizeSettings({ chatTabMode: 'other' }).chatTabMode, 'single');
});

// ─── sanitizeGroups ──────────────────────────────────────────────────────────

test('sanitizeGroups returns default + deleted groups for invalid input', () => {
  const groups = sanitizeGroups(undefined);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].kind, 'default');
  assert.equal(groups[1].kind, 'deleted');
  assert.equal(groups[0].id, DEFAULT_GROUP_ID);
  assert.equal(groups[1].id, DELETED_GROUP_ID);
});

test('sanitizeGroups preserves valid custom groups', () => {
  const groups = sanitizeGroups([
    { id: 'custom1', name: 'My Group', kind: 'custom', createdAt: 1000, updatedAt: 1000 }
  ]);
  const ids = groups.map((g) => g.id);

  assert.ok(ids.includes(DEFAULT_GROUP_ID));
  assert.ok(ids.includes(DELETED_GROUP_ID));
  assert.ok(ids.includes('custom1'));
  assert.equal(groups.length, 3);
});

test('sanitizeGroups skips groups with empty id or name', () => {
  const groups = sanitizeGroups([
    { id: '', name: 'No ID', kind: 'custom' },
    { id: 'no-name', name: '', kind: 'custom' }
  ]);
  assert.equal(groups.length, 2); // only default + deleted
});

test('sanitizeGroups places deleted group last', () => {
  const groups = sanitizeGroups([
    { id: 'custom1', name: 'Group 1', kind: 'custom' }
  ]);
  assert.equal(groups[groups.length - 1].kind, 'deleted');
});

// ─── sanitizeMcpSettings ─────────────────────────────────────────────────────

test('sanitizeMcpSettings returns default for invalid input', () => {
  const mcp = sanitizeMcpSettings(undefined);
  assert.ok(Array.isArray(mcp.servers));
  assert.equal(mcp.servers.length, 0);
  assert.equal(mcp.maxToolRounds, DEFAULT_SETTINGS.mcp.maxToolRounds);
});

test('sanitizeMcpSettings clamps maxToolRounds', () => {
  assert.equal(sanitizeMcpSettings({ maxToolRounds: 0 }).maxToolRounds, 1);
  assert.equal(sanitizeMcpSettings({ maxToolRounds: 100 }).maxToolRounds, 20);
});

test('sanitizeMcpSettings deduplicates servers by id', () => {
  const mcp = sanitizeMcpSettings({
    servers: [
      { id: 's1', name: 'Server 1', transport: 'stdio', command: 'a' },
      { id: 's1', name: 'Server 1 Dup', transport: 'stdio', command: 'b' }
    ]
  });
  assert.equal(mcp.servers.length, 1);
  assert.equal(mcp.servers[0].name, 'Server 1');
});

// ─── sanitizeMcpServer ──────────────────────────────────────────────────────

test('sanitizeMcpServer returns undefined for invalid input', () => {
  assert.equal(sanitizeMcpServer(undefined), undefined);
  assert.equal(sanitizeMcpServer(null), undefined);
  assert.equal(sanitizeMcpServer({}), undefined);
  assert.equal(sanitizeMcpServer({ id: '', name: 'x' }), undefined);
  assert.equal(sanitizeMcpServer({ id: 'x', name: '' }), undefined);
});

test('sanitizeMcpServer defaults transport to stdio', () => {
  const server = sanitizeMcpServer({ id: 's1', name: 'S1' });
  assert.ok(server);
  assert.equal(server.transport, 'stdio');
  assert.equal(server.enabled, true);
});

test('sanitizeMcpServer filters empty args', () => {
  const server = sanitizeMcpServer({ id: 's1', name: 'S1', args: ['valid', '', 123, 'also valid'] });
  assert.ok(server);
  assert.deepEqual(server.args, ['valid', 'also valid']);
});

// ─── sanitizeProviders ───────────────────────────────────────────────────────

test('sanitizeProviders returns empty array for invalid input', () => {
  assert.deepEqual(sanitizeProviders(undefined), []);
  assert.deepEqual(sanitizeProviders('not array'), []);
  assert.deepEqual(sanitizeProviders([null, 123, 'str']), []);
});

test('sanitizeProviders assigns id if missing', () => {
  const providers = sanitizeProviders([{ name: 'No ID Provider' }]);
  assert.equal(providers.length, 1);
  assert.ok(providers[0].id.startsWith('provider_'));
});

test('sanitizeProviders deduplicates models', () => {
  const providers = sanitizeProviders([{
    id: 'p1',
    name: 'Test',
    models: [{ id: 'm1', name: 'M1' }, { id: 'm1', name: 'M1 Dup' }]
  }]);
  assert.equal(providers[0].models.length, 1);
});

// ─── sanitizeDefaultModels ───────────────────────────────────────────────────

test('sanitizeDefaultModels handles undefined input', () => {
  const models = sanitizeDefaultModels(undefined);
  assert.equal(models.assistant, undefined);
  assert.equal(models.titleSummary, undefined);
});

// ─── normalizeProviderBaseUrl ─────────────────────────────────────────────────

test('normalizeProviderBaseUrl validates URLs', () => {
  assert.equal(normalizeProviderBaseUrl('https://api.example.com'), 'https://api.example.com');
  assert.equal(normalizeProviderBaseUrl('not-a-url'), '');
  assert.equal(normalizeProviderBaseUrl(undefined), '');
  assert.equal(normalizeProviderBaseUrl('', 'fallback'), 'fallback');
});

// ─── normalizeModelId ────────────────────────────────────────────────────────

test('normalizeModelId trims and validates', () => {
  assert.equal(normalizeModelId('  gpt-4  '), 'gpt-4');
  assert.equal(normalizeModelId(''), '');
  assert.equal(normalizeModelId(undefined), '');
});

// ─── normalizeMcpKeyValueEntries ─────────────────────────────────────────────

test('normalizeMcpKeyValueEntries handles non-array input', () => {
  assert.deepEqual(normalizeMcpKeyValueEntries(undefined), []);
  assert.deepEqual(normalizeMcpKeyValueEntries('string'), []);
});

test('normalizeMcpKeyValueEntries filters invalid entries', () => {
  const result = normalizeMcpKeyValueEntries([
    { key: 'VALID', value: 'v1' },
    { key: '', value: 'v2' },
    null,
    { key: 'ALSO_VALID', value: 123 }
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].key, 'VALID');
  assert.equal(result[1].value, '');
});

// ─── migrateAssistants ───────────────────────────────────────────────────────

test('migrateAssistants returns empty array for invalid input', () => {
  const settings = sanitizeSettings(undefined);
  const groups = sanitizeGroups(undefined);
  const groupIds = new Set(groups.map((g) => g.id));

  assert.deepEqual(migrateAssistants(undefined, settings, groupIds, Date.now()), []);
  assert.deepEqual(migrateAssistants('not-array', settings, groupIds, Date.now()), []);
});

test('migrateAssistants deduplicates by id', () => {
  const settings = sanitizeSettings(undefined);
  const groups = sanitizeGroups(undefined);
  const groupIds = new Set(groups.map((g) => g.id));

  const result = migrateAssistants([
    { id: 'a1', name: 'Assistant 1' },
    { id: 'a1', name: 'Assistant 1 Dup' }
  ], settings, groupIds, Date.now());

  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Assistant 1');
});
