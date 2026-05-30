import test from 'node:test';
import { benchmark } from './perf';
import { cloneAssistant, cloneSession, cloneProvider, cloneMcpSettings } from '../../chatbuddy/stateClone';
import { makeAssistant, makeProvider, makeSession, makeMessage } from '../fixtures';

test('benchmark: cloneAssistant', () => {
  const assistant = makeAssistant({
    enabledMcpServerIds: ['mcp1', 'mcp2', 'mcp3'],
    overrides: { temperature: 0.5 },
    failoverModelRefs: ['p2:m1', 'p3:m2']
  });
  benchmark('cloneAssistant', () => {
    cloneAssistant(assistant);
  }, 10000);
});

test('benchmark: cloneSession', () => {
  const session = makeSession({
    messages: [
      makeMessage({ role: 'user', content: 'Hello, how are you?' }),
      makeMessage({ role: 'assistant', content: 'I am doing well, thank you for asking!' }),
      makeMessage({ role: 'user', content: 'Can you help me with something?' }),
      makeMessage({ role: 'assistant', content: 'Of course! What do you need help with?' }),
    ]
  });
  benchmark('cloneSession', () => {
    cloneSession(session);
  }, 10000);
});

test('benchmark: cloneProvider', () => {
  const provider = makeProvider({
    models: [
      { id: 'm1', name: 'Model 1' },
      { id: 'm2', name: 'Model 2' },
      { id: 'm3', name: 'Model 3' },
      { id: 'm4', name: 'Model 4' },
    ]
  });
  benchmark('cloneProvider', () => {
    cloneProvider(provider);
  }, 10000);
});

test('benchmark: cloneMcpSettings', () => {
  const settings = {
    servers: [
      {
        id: 's1',
        name: 'Server 1',
        enabled: true,
        transport: 'stdio' as const,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        cwd: '',
        env: [{ key: 'API_KEY', value: 'secret1' }, { key: 'DEBUG', value: 'true' }],
        url: '',
        headers: [{ key: 'Authorization', value: 'Bearer token1' }],
        timeoutMs: 30000,
        remotePassthroughEnabled: false,
        groupId: ''
      },
      {
        id: 's2',
        name: 'Server 2',
        enabled: false,
        transport: 'stdio' as const,
        command: 'node',
        args: ['./server.js'],
        cwd: '',
        env: [{ key: 'PORT', value: '8080' }],
        url: '',
        headers: [],
        timeoutMs: 60000,
        remotePassthroughEnabled: false,
        groupId: ''
      }
    ],
    groups: [
      { id: 'g1', name: 'Group 1', enabled: true },
      { id: 'g2', name: 'Group 2', enabled: true }
    ],
    maxToolRounds: 3
  };
  benchmark('cloneMcpSettings', () => {
    cloneMcpSettings(settings);
  }, 10000);
});
