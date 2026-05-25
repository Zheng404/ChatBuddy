/**
 * MCP Server Groups 单元测试
 *
 * 覆盖 getEnabledServers 的分组启用逻辑、groupId 验证等。
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { getEnabledServers } from '../chatbuddy/mcpUtils';
import type { AssistantProfile, ChatBuddySettings, McpServerGroup, McpServerProfile } from '../chatbuddy/types';

function makeSettings(servers: McpServerProfile[], groups: McpServerGroup[] = []): ChatBuddySettings {
  return {
    providers: [],
    defaultModels: {},
    mcp: { servers, groups, maxToolRounds: 5 },
    temperature: 0.7,
    topP: 1,
    maxTokens: 2048,
    presencePenalty: 0,
    frequencyPenalty: 0,
    timeoutMs: 30000,
    streamingDefault: true,
    locale: 'auto' as const,
    sendShortcut: 'enter' as const,
    chatTabMode: 'single' as const,
    localBackup: { enabled: false, directory: '', intervalHours: 24, maxCount: 10, maxAgeDays: 30 }
  };
}

function makeAssistant(enabledIds: string[]): AssistantProfile {
  return {
    id: 'a1',
    name: 'Assistant',
    modelRef: 'p1/m1',
    systemPrompt: '',
    greeting: '',
    temperature: 0.7,
    topP: 1,
    maxTokens: 2048,
    presencePenalty: 0,
    frequencyPenalty: 0,
    streaming: true,
    enabledMcpServerIds: enabledIds,
    note: '',
    questionPrefix: '',
    contextCount: 10,
    pinned: false,
    isDeleted: false,
    lastInteractedAt: 0,
    groupId: 'default',
    createdAt: 0,
    updatedAt: 0
  };
}

function makeServer(id: string, overrides: Partial<McpServerProfile> = {}): McpServerProfile {
  return {
    id,
    name: `Server ${id}`,
    enabled: true,
    transport: 'stdio' as const,
    command: 'cmd',
    args: [],
    cwd: '',
    env: [],
    url: '',
    headers: [],
    timeoutMs: 30000,
    remotePassthroughEnabled: false,
    ...overrides
  };
}

describe('getEnabledServers with groups', () => {
  it('returns enabled servers when no groups exist', () => {
    const settings = makeSettings([
      makeServer('s1'),
      makeServer('s2', { enabled: false })
    ]);
    const assistant = makeAssistant(['s1', 's2']);
    const result = getEnabledServers(settings, assistant);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 's1');
  });

  it('includes server without groupId regardless of groups', () => {
    const settings = makeSettings(
      [makeServer('s1'), makeServer('s2', { groupId: 'g1' })],
      [{ id: 'g1', name: 'Group 1', enabled: true }]
    );
    const assistant = makeAssistant(['s1', 's2']);
    const result = getEnabledServers(settings, assistant);
    assert.strictEqual(result.length, 2);
    assert.ok(result.some((s) => s.id === 's1'));
    assert.ok(result.some((s) => s.id === 's2'));
  });

  it('excludes server in disabled group', () => {
    const settings = makeSettings(
      [
        makeServer('s1', { groupId: 'g1' }),
        makeServer('s2', { groupId: 'g2' })
      ],
      [
        { id: 'g1', name: 'Enabled Group', enabled: true },
        { id: 'g2', name: 'Disabled Group', enabled: false }
      ]
    );
    const assistant = makeAssistant(['s1', 's2']);
    const result = getEnabledServers(settings, assistant);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 's1');
  });

  it('excludes server when group was deleted (groupId references non-existent group)', () => {
    const settings = makeSettings(
      [makeServer('s1', { groupId: 'g1' }), makeServer('s2', { groupId: 'missing' })],
      [{ id: 'g1', name: 'Group 1', enabled: true }]
    );
    const assistant = makeAssistant(['s1', 's2']);
    const result = getEnabledServers(settings, assistant);
    assert.strictEqual(result.length, 1);
    assert.ok(result.some((s) => s.id === 's1'));
    assert.ok(!result.some((s) => s.id === 's2'));
  });

  it('respects assistant enabledMcpServerIds filter', () => {
    const settings = makeSettings(
      [makeServer('s1', { groupId: 'g1' }), makeServer('s2', { groupId: 'g1' })],
      [{ id: 'g1', name: 'Group 1', enabled: true }]
    );
    const assistant = makeAssistant(['s1']);
    const result = getEnabledServers(settings, assistant);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 's1');
  });

  it('returns empty when all servers are in disabled groups', () => {
    const settings = makeSettings(
      [makeServer('s1', { groupId: 'g1' }), makeServer('s2', { groupId: 'g1' })],
      [{ id: 'g1', name: 'Disabled', enabled: false }]
    );
    const assistant = makeAssistant(['s1', 's2']);
    const result = getEnabledServers(settings, assistant);
    assert.strictEqual(result.length, 0);
  });

  it('handles mixed grouped and ungrouped servers', () => {
    const settings = makeSettings(
      [
        makeServer('s1'),
        makeServer('s2', { groupId: 'g1' }),
        makeServer('s3', { groupId: 'g2' })
      ],
      [
        { id: 'g1', name: 'Enabled', enabled: true },
        { id: 'g2', name: 'Disabled', enabled: false }
      ]
    );
    const assistant = makeAssistant(['s1', 's2', 's3']);
    const result = getEnabledServers(settings, assistant);
    assert.strictEqual(result.length, 2);
    assert.ok(result.some((s) => s.id === 's1'));
    assert.ok(result.some((s) => s.id === 's2'));
    assert.ok(!result.some((s) => s.id === 's3'));
  });

  it('excludes disabled servers even in enabled group', () => {
    const settings = makeSettings(
      [
        makeServer('s1', { groupId: 'g1', enabled: true }),
        makeServer('s2', { groupId: 'g1', enabled: false })
      ],
      [{ id: 'g1', name: 'Enabled', enabled: true }]
    );
    const assistant = makeAssistant(['s1', 's2']);
    const result = getEnabledServers(settings, assistant);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 's1');
  });

  it('handles empty groups array', () => {
    const settings = makeSettings(
      [makeServer('s1'), makeServer('s2')],
      []
    );
    const assistant = makeAssistant(['s1', 's2']);
    const result = getEnabledServers(settings, assistant);
    assert.strictEqual(result.length, 2);
  });
});
