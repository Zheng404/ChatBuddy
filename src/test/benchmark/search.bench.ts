import test from 'node:test';
import { benchmark } from './perf';
import { CompassSessionStore } from '../../chatbuddy/compassStorage/sessionStore';
import type { ChatMessage, ChatSessionDetail } from '../../chatbuddy/types';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeMessage(role: 'user' | 'assistant', content: string, id?: string): ChatMessage {
  return {
    id: id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: Date.now(),
  };
}

function makeSession(assistantId: string, sessionId: string, messages: ChatMessage[]): ChatSessionDetail {
  return {
    id: sessionId,
    assistantId,
    title: `Session ${sessionId}`,
    titleSource: 'default',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages,
  };
}

function populateStore(store: CompassSessionStore, sessionCount: number, messagesPerSession: number): void {
  const words = [
    'hello', 'world', 'test', 'performance', 'benchmark', 'search', 'index',
    'message', 'session', 'assistant', 'chat', 'ai', 'model', 'token',
    'response', 'query', 'result', 'data', 'code', 'function', 'variable',
    'typescript', 'javascript', 'python', 'rust', 'go', 'java', 'compiler',
    'database', 'storage', 'memory', 'cache', 'network', 'api', 'http',
    'server', 'client', 'request', 'response', 'header', 'body', 'json',
    'async', 'await', 'promise', 'callback', 'event', 'stream', 'buffer',
    'algorithm', 'complexity', 'optimization', 'refactor', 'debug', 'test',
    'unit', 'integration', 'e2e', 'coverage', 'lint', 'format', 'build',
    'deploy', 'ci', 'cd', 'pipeline', 'container', 'docker', 'kubernetes',
    'cloud', 'aws', 'azure', 'gcp', 'serverless', 'lambda', 'edge',
    'security', 'auth', 'oauth', 'jwt', 'encryption', 'hash', 'salt',
    'frontend', 'backend', 'fullstack', 'framework', 'library', 'module',
    'component', 'hook', 'state', 'props', 'context', 'router', 'middleware',
  ];

  for (let s = 0; s < sessionCount; s++) {
    const messages: ChatMessage[] = [];
    for (let m = 0; m < messagesPerSession; m++) {
      const wordCount = 5 + Math.floor(Math.random() * 20);
      const contentWords: string[] = [];
      for (let w = 0; w < wordCount; w++) {
        contentWords.push(words[Math.floor(Math.random() * words.length)]);
      }
      const role = m % 2 === 0 ? 'user' : 'assistant';
      messages.push(makeMessage(role, contentWords.join(' '), `msg-${s}-${m}`));
    }
    store.insertSession(makeSession('a1', `sess-${s}`, messages));
  }
}

// ── Benchmarks ───────────────────────────────────────────────────────────

test('benchmark: searchSessionIdsByContent — single token (100 sessions, 20 msgs each)', () => {
  const store = new CompassSessionStore();
  populateStore(store, 100, 20);

  benchmark('searchSessionIdsByContent (single token)', () => {
    store.searchSessionIdsByContent('a1', 'performance');
  }, 1000);
});

test('benchmark: searchSessionIdsByContent — multi token (100 sessions, 20 msgs each)', () => {
  const store = new CompassSessionStore();
  populateStore(store, 100, 20);

  benchmark('searchSessionIdsByContent (multi token)', () => {
    store.searchSessionIdsByContent('a1', 'performance benchmark');
  }, 1000);
});

test('benchmark: searchSessionIdsByContent — no results (100 sessions, 20 msgs each)', () => {
  const store = new CompassSessionStore();
  populateStore(store, 100, 20);

  benchmark('searchSessionIdsByContent (no results)', () => {
    store.searchSessionIdsByContent('a1', 'xyznonexistent');
  }, 1000);
});

test('benchmark: searchSessionIdsByContent — fallback short keyword (100 sessions, 20 msgs each)', () => {
  const store = new CompassSessionStore();
  populateStore(store, 100, 20);

  benchmark('searchSessionIdsByContent (fallback short keyword)', () => {
    store.searchSessionIdsByContent('a1', 'go');
  }, 1000);
});

test('benchmark: insertSession (100 sessions, 20 msgs each)', () => {
  const store = new CompassSessionStore();
  const sessions: ChatSessionDetail[] = [];
  for (let s = 0; s < 100; s++) {
    const messages: ChatMessage[] = [];
    for (let m = 0; m < 20; m++) {
      messages.push(makeMessage(m % 2 === 0 ? 'user' : 'assistant', `Message content ${s}-${m}`, `msg-${s}-${m}`));
    }
    sessions.push(makeSession('a1', `sess-${s}`, messages));
  }

  let index = 0;
  benchmark('insertSession', () => {
    store.insertSession(sessions[index % sessions.length]);
    index++;
  }, 1000);
});
