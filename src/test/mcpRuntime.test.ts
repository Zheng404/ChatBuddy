/**
 * MCP Runtime 单元测试
 *
 * 覆盖连接管理、TTL 清理、工具绑定缓存等核心逻辑。
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { McpRuntime } from '../chatbuddy/mcpRuntime';

function makeSettings(servers: any[]) {
  return {
    providers: [],
    defaultModels: {},
    mcp: { servers, groups: [], maxToolRounds: 5 },
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

function makeServer(id: string, overrides: any = {}) {
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

describe('McpRuntime', () => {
  describe('getServerSummaries', () => {
    it('returns empty array when no assistant', () => {
      const runtime = new McpRuntime();
      const result = runtime.getServerSummaries(makeSettings([makeServer('s1')]), undefined);
      assert.deepStrictEqual(result, []);
    });

    it('returns summaries for enabled servers', () => {
      const runtime = new McpRuntime();
      const result = runtime.getServerSummaries(
        makeSettings([
          makeServer('s1'),
          makeServer('s2', { enabled: false, transport: 'sse' as const })
        ]),
        {
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
          enabledMcpServerIds: ['s1', 's2'],
          note: '',
          questionPrefix: '',
          contextCount: 10,
          pinned: false,
          isDeleted: false,
          lastInteractedAt: 0,
          groupId: 'default',
          createdAt: 0,
          updatedAt: 0
        }
      );
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, 's1');
      assert.strictEqual(result[0].name, 'Server s1');
      assert.strictEqual(result[0].enabled, true);
      assert.strictEqual(result[0].transport, 'stdio');
    });

    it('respects assistant enabledMcpServerIds filter', () => {
      const runtime = new McpRuntime();
      const result = runtime.getServerSummaries(
        makeSettings([makeServer('s1'), makeServer('s2')]),
        {
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
          enabledMcpServerIds: ['s1'],
          note: '',
          questionPrefix: '',
          contextCount: 10,
          pinned: false,
          isDeleted: false,
          lastInteractedAt: 0,
          groupId: 'default',
          createdAt: 0,
          updatedAt: 0
        }
      );
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, 's1');
    });
  });

  describe('pruneConnections', () => {
    it('removes stale connections not in active set', async () => {
      const runtime = new McpRuntime();
      const closed: string[] = [];
      (runtime as any).connections.set('s1', {
        promise: Promise.resolve({
          client: { close: async () => undefined },
          transport: { close: async () => { closed.push('transport-s1'); } },
          server: { id: 's1' }
        } as any),
        createdAt: Date.now()
      });
      await runtime.pruneConnections(new Set(['s2']));
      assert.strictEqual((runtime as any).connections.has('s1'), false);
      assert.strictEqual(closed.length, 1);
    });

    it('removes TTL-expired connections', async () => {
      const runtime = new McpRuntime();
      const closed: string[] = [];
      (runtime as any).connections.set('s1', {
        promise: Promise.resolve({
          client: { close: async () => undefined },
          transport: { close: async () => { closed.push('transport-s1'); } },
          server: { id: 's1' }
        } as any),
        createdAt: Date.now() - 31 * 60 * 1000
      });
      await runtime.pruneConnections(new Set(['s1']));
      assert.strictEqual((runtime as any).connections.has('s1'), false);
      assert.strictEqual(closed.length, 1);
    });

    it('keeps active non-expired connections', async () => {
      const runtime = new McpRuntime();
      (runtime as any).connections.set('s1', {
        promise: Promise.resolve({
          client: { close: async () => undefined },
          transport: { close: async () => undefined },
          server: { id: 's1' }
        } as any),
        createdAt: Date.now()
      });
      await runtime.pruneConnections(new Set(['s1']));
      assert.strictEqual((runtime as any).connections.has('s1'), true);
    });
  });

  describe('invalidateToolBindings', () => {
    it('clears specific assistant cache', () => {
      const runtime = new McpRuntime();
      (runtime as any).toolBindingsCache.set('a1', { bindings: [], expiresAt: Date.now() + 60000 });
      (runtime as any).toolBindingsCache.set('a2', { bindings: [], expiresAt: Date.now() + 60000 });
      runtime.invalidateToolBindings('a1');
      assert.strictEqual((runtime as any).toolBindingsCache.has('a1'), false);
      assert.strictEqual((runtime as any).toolBindingsCache.has('a2'), true);
    });

    it('clears all cache when no assistantId', () => {
      const runtime = new McpRuntime();
      (runtime as any).toolBindingsCache.set('a1', { bindings: [], expiresAt: Date.now() + 60000 });
      runtime.invalidateToolBindings();
      assert.strictEqual((runtime as any).toolBindingsCache.size, 0);
    });
  });

  describe('dispose', () => {
    it('clears all connections and caches', async () => {
      const runtime = new McpRuntime();
      const closed: string[] = [];
      (runtime as any).connections.set('s1', {
        promise: Promise.resolve({
          client: { close: async () => { closed.push('client'); } },
          transport: { close: async () => { closed.push('transport'); } },
          server: { id: 's1' }
        } as any),
        createdAt: Date.now()
      });
      (runtime as any).toolBindingsCache.set('a1', { bindings: [], expiresAt: Date.now() + 60000 });
      await runtime.dispose();
      assert.strictEqual((runtime as any).connections.size, 0);
      assert.strictEqual((runtime as any).toolBindingsCache.size, 0);
      assert.strictEqual(closed.length, 2);
    });
  });
});
