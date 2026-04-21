import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import initSqlJs from 'sql.js';

import {
  ChatStorage,
  COMPASS_PROVIDER_API_KEYS_STORE_KEY,
  COMPASS_STATE_STORE_KEY
} from '../chatbuddy/chatStorage';
import { createInitialState } from '../chatbuddy/stateSanitizers';
import type { ChatMessage, ChatSessionDetail } from '../chatbuddy/types';

// Use a temp directory for each test to avoid cross-test contamination
async function createStorage(): Promise<{ storage: ChatStorage; tmpDir: string; cleanup: () => void }> {
  const storage = new ChatStorage();
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chatbuddy-test-'));
  await storage.initialize(tmpDir);
  return {
    storage,
    tmpDir,
    cleanup: () => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };
}

function makeMessage(role: 'user' | 'assistant', content: string, id?: string): ChatMessage {
  return {
    id: id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: Date.now()
  };
}

function makeSession(assistantId: string, sessionId?: string, messages?: ChatMessage[]): ChatSessionDetail {
  return {
    id: sessionId ?? `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    assistantId,
    title: 'Test Session',
    titleSource: 'default',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: messages ?? []
  };
}

async function createLegacySqlite(globalStoragePath: string): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`)
  });
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE sessions_meta (
      id TEXT PRIMARY KEY,
      assistant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      title_source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      preview TEXT
    );
    CREATE TABLE messages (
      id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning TEXT,
      model TEXT,
      ts INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      tool_rounds TEXT,
      images TEXT,
      PRIMARY KEY (session_id, seq)
    );
    CREATE TABLE kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db.run(
    `INSERT INTO sessions_meta(id, assistant_id, title, title_source, created_at, updated_at, message_count, preview)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['legacy-session', 'legacy-assistant', 'Legacy Title', 'default', 1000, 2000, 1, 'legacy-preview']
  );
  db.run(
    `INSERT INTO messages(id, session_id, role, content, reasoning, model, ts, seq, tool_rounds, images)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['legacy-msg', 'legacy-session', 'assistant', 'Legacy hello', null, 'legacy-model', 3000, 0, null, null]
  );
  db.run(
    `INSERT INTO kv(key, value) VALUES (?, ?), (?, ?), (?, ?)`,
    [
      'chatbuddy.sqlite.state.v1',
      JSON.stringify({ selectedAssistantId: 'legacy-assistant' }),
      'chatbuddy.sqlite.providerApiKeys.v1',
      JSON.stringify({ legacy: 'legacy-key' }),
      'custom-key',
      'custom-value'
    ]
  );
  const binary = db.export();
  db.close();
  await fs.promises.writeFile(path.join(globalStoragePath, 'chatbuddy.sqlite'), Buffer.from(binary));
}

// ─── Initialize ──────────────────────────────────────────────────────────────

test('initialize creates an empty storage', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    assert.equal(storage.hasAnySession(), false);
    assert.equal(storage.countSessions(), 0);
  } finally {
    await storage.close();
    cleanup();
  }
});

test('initialize migrates legacy sqlite data into compass storage', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chatbuddy-legacy-test-'));
  const storage = new ChatStorage();
  try {
    await createLegacySqlite(tmpDir);
    await storage.initialize(tmpDir);

    const summary = storage.getSessionSummary('legacy-assistant', 'legacy-session');
    assert.ok(summary);
    assert.equal(summary.title, 'Legacy Title');

    const detail = storage.getSessionDetail('legacy-assistant', 'legacy-session');
    assert.ok(detail);
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0].content, 'Legacy hello');

    const migratedState = storage.getKv(COMPASS_STATE_STORE_KEY);
    assert.ok(migratedState);
    assert.equal(JSON.parse(migratedState as string).selectedAssistantId, 'legacy-assistant');
    assert.equal(storage.getKv(COMPASS_PROVIDER_API_KEYS_STORE_KEY), JSON.stringify({ legacy: 'legacy-key' }));
    assert.equal(storage.getKv('custom-key'), 'custom-value');

    const stateCorePath = path.join(tmpDir, 'meta', 'state.core.json');
    const settingsGeneralPath = path.join(tmpDir, 'meta', 'settings.general.json');
    const providerApiKeysPath = path.join(tmpDir, 'meta', 'providers.api-keys.json');
    const stateCommitPath = path.join(tmpDir, 'meta', 'state.commit.json');
    const legacyDbPath = path.join(tmpDir, 'chatbuddy.sqlite');
    assert.equal(fs.existsSync(stateCorePath), true);
    assert.equal(fs.existsSync(settingsGeneralPath), true);
    assert.equal(fs.existsSync(providerApiKeysPath), true);
    assert.equal(fs.existsSync(stateCommitPath), true);
    assert.equal(fs.existsSync(legacyDbPath), false);

    const migrationMarkerPath = path.join(
      tmpDir,
      'meta',
      'chatbuddy.migration.compass.json'
    );
    const marker = JSON.parse(await fs.promises.readFile(migrationMarkerPath, 'utf-8')) as {
      name: string;
      layoutVersion: number;
      source: string;
    };
    assert.equal(marker.name, 'compass');
    assert.equal(marker.layoutVersion, 3);
    assert.equal(marker.source, 'sqlite');
  } finally {
    await storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('initialize removes lingering legacy sqlite when structured compass state exists without migration marker', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chatbuddy-structured-legacy-test-'));
  const storage = new ChatStorage();
  try {
    await storage.initialize(tmpDir);
    storage.writeStateLite(createInitialState(), false);
    await storage.flush();
    await storage.close();
    await fs.promises.rm(path.join(tmpDir, 'meta', 'chatbuddy.migration.compass.json'), { force: true });

    await createLegacySqlite(tmpDir);

    const reloaded = new ChatStorage();
    try {
      await reloaded.initialize(tmpDir);

      const legacyDbPath = path.join(tmpDir, 'chatbuddy.sqlite');
      const migrationMarkerPath = path.join(tmpDir, 'meta', 'chatbuddy.migration.compass.json');
      const marker = JSON.parse(await fs.promises.readFile(migrationMarkerPath, 'utf-8')) as {
        source: string;
      };

      assert.equal(fs.existsSync(legacyDbPath), false);
      assert.equal(marker.source, 'existing-structured');
    } finally {
      await reloaded.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('initialize removes lingering legacy sqlite after converting legacy compass payload', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chatbuddy-existing-compass-test-'));
  try {
    const metaDir = path.join(tmpDir, 'meta');
    await fs.promises.mkdir(metaDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(metaDir, 'state.compass.json'),
      JSON.stringify({
        ...createInitialState(),
        selectedAssistantId: 'legacy-assistant'
      }, null, 2),
      'utf8'
    );
    await createLegacySqlite(tmpDir);

    const storage = new ChatStorage();
    try {
      await storage.initialize(tmpDir);

      const legacyDbPath = path.join(tmpDir, 'chatbuddy.sqlite');
      const structuredStatePath = path.join(tmpDir, 'meta', 'state.core.json');
      const migrationMarkerPath = path.join(tmpDir, 'meta', 'chatbuddy.migration.compass.json');
      const marker = JSON.parse(await fs.promises.readFile(migrationMarkerPath, 'utf-8')) as {
        source: string;
      };

      assert.equal(fs.existsSync(legacyDbPath), false);
      assert.equal(fs.existsSync(structuredStatePath), true);
      assert.equal(marker.source, 'existing-compass');
    } finally {
      await storage.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('initialize migrates legacy nested compass root into storage root', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chatbuddy-legacy-root-layout-test-'));
  const storage = new ChatStorage();
  try {
    await storage.initialize(tmpDir);
    const state = createInitialState();
    state.selectedAssistantId = 'assistant-root-migrate';
    storage.writeStateLite(state, false);
    storage.insertSession(makeSession('assistant-root-migrate', 'session-root-migrate', [makeMessage('user', 'legacy root')]), false);
    await storage.flush();
    await storage.close();

    const legacyRootDir = path.join(tmpDir, 'nested-storage-root');
    await fs.promises.mkdir(legacyRootDir, { recursive: true });
    await fs.promises.rename(path.join(tmpDir, 'meta'), path.join(legacyRootDir, 'meta'));
    await fs.promises.rename(path.join(tmpDir, 'sessions'), path.join(legacyRootDir, 'sessions'));

    const reloaded = new ChatStorage();
    try {
      await reloaded.initialize(tmpDir);

      assert.equal(fs.existsSync(path.join(tmpDir, 'meta', 'state.core.json')), true);
      assert.equal(fs.existsSync(path.join(tmpDir, 'sessions', 'assistant-root-migrate', 'session-root-migrate.jsonl')), true);
      assert.equal(fs.existsSync(legacyRootDir), false);

      const migratedState = reloaded.readStateLite() as { selectedAssistantId?: string } | undefined;
      assert.equal(migratedState?.selectedAssistantId, 'assistant-root-migrate');
      const detail = reloaded.getSessionDetail('assistant-root-migrate', 'session-root-migrate');
      assert.ok(detail);
      assert.equal(detail.messages[0].content, 'legacy root');
    } finally {
      await reloaded.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('initialize recovers from legacy sqlite when the current structured snapshot is corrupted', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chatbuddy-corrupted-structured-test-'));
  const storage = new ChatStorage();
  try {
    await storage.initialize(tmpDir);
    const state = createInitialState();
    state.selectedAssistantId = 'structured-assistant';
    storage.writeStateLite(state, false);
    storage.insertSession(makeSession('structured-assistant', 'structured-session', [makeMessage('user', 'structured')]), false);
    await storage.flush();
    await storage.close();

    await fs.promises.writeFile(path.join(tmpDir, 'meta', 'state.core.json'), '{broken json', 'utf8');
    await createLegacySqlite(tmpDir);

    const reloaded = new ChatStorage();
    try {
      await reloaded.initialize(tmpDir);

      const migratedState = reloaded.readStateLite() as { selectedAssistantId?: string } | undefined;
      assert.equal(migratedState?.selectedAssistantId, 'legacy-assistant');
      assert.equal(reloaded.getSessionDetail('legacy-assistant', 'legacy-session')?.messages[0].content, 'Legacy hello');
      assert.equal(fs.existsSync(path.join(tmpDir, 'chatbuddy.sqlite')), false);
    } finally {
      await reloaded.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('initialize throws when the structured snapshot is corrupted and no sqlite recovery source exists', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chatbuddy-corrupted-structured-no-sqlite-test-'));
  const storage = new ChatStorage();
  try {
    await storage.initialize(tmpDir);
    storage.writeStateLite(createInitialState(), false);
    await storage.flush();
    await storage.close();

    await fs.promises.writeFile(path.join(tmpDir, 'meta', 'state.core.json'), '{broken json', 'utf8');

    const reloaded = new ChatStorage();
    await assert.rejects(
      reloaded.initialize(tmpDir),
      /Compass snapshot failed validation with a current migration marker/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Insert & Query ──────────────────────────────────────────────────────────

test('insertSession and listSessionsByAssistant', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const session = makeSession('a1', 's1');
    storage.insertSession(session, true);

    assert.equal(storage.hasAnySession(), true);
    assert.equal(storage.countSessions(), 1);

    const summaries = storage.listSessionsByAssistant('a1');
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].id, 's1');
    assert.equal(summaries[0].assistantId, 'a1');
  } finally {
    await storage.close();
    cleanup();
  }
});

test('getSessionDetailById returns inserted session', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const session = makeSession('a1', 's1', [makeMessage('user', 'Hello')]);
    storage.insertSession(session, true);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.id, 's1');
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0].content, 'Hello');
  } finally {
    await storage.close();
    cleanup();
  }
});

test('getSessionDetailById returns undefined for unknown session', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    assert.equal(storage.getSessionDetailById('nonexistent'), undefined);
  } finally {
    await storage.close();
    cleanup();
  }
});

test('searchSessionIdsByContent treats LIKE wildcards as literals', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    storage.insertSession(makeSession('a1', 's1', [makeMessage('user', 'value contains 100% match and under_score')]), true);
    storage.insertSession(makeSession('a1', 's2', [makeMessage('user', 'plain text only')]), true);

    const percentMatches = storage.searchSessionIdsByContent('a1', '%');
    assert.equal(percentMatches.length, 1);
    assert.equal(percentMatches.includes('s1'), true);

    const underscoreMatches = storage.searchSessionIdsByContent('a1', '_');
    assert.equal(underscoreMatches.length, 1);
    assert.equal(underscoreMatches.includes('s1'), true);
  } finally {
    await storage.close();
    cleanup();
  }
});

test('sessionExists returns correct boolean', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const session = makeSession('a1', 's1');
    storage.insertSession(session, true);

    assert.equal(storage.sessionExists('a1', 's1'), true);
    assert.equal(storage.sessionExists('a1', 's999'), false);
    assert.equal(storage.sessionExists('other', 's1'), false);
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── Append Message ──────────────────────────────────────────────────────────

test('appendMessage adds a message to existing session', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const session = makeSession('a1', 's1');
    storage.insertSession(session, true);

    const msg = makeMessage('user', 'Hello');
    storage.appendMessage('a1', 's1', msg, Date.now(), true);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0].content, 'Hello');
  } finally {
    await storage.close();
    cleanup();
  }
});

test('appendMessage returns false for non-existent session', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const result = storage.appendMessage('a1', 's1', makeMessage('user', 'test'), Date.now());
    assert.equal(result, false);
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── Rename ──────────────────────────────────────────────────────────────────

test('renameSession updates the title', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const session = makeSession('a1', 's1');
    storage.insertSession(session, true);

    const renamed = storage.renameSession('a1', 's1', 'New Title', 'custom', Date.now());
    assert.equal(renamed, true);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.title, 'New Title');
    assert.equal(detail.titleSource, 'custom');
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── Delete ──────────────────────────────────────────────────────────────────

test('deleteSession removes a session', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    storage.insertSession(makeSession('a1', 's1'), true);
    storage.insertSession(makeSession('a1', 's2'), true);
    assert.equal(storage.countSessions(), 2);

    storage.deleteSession('a1', 's1', true);
    assert.equal(storage.countSessions(), 1);
    assert.equal(storage.sessionExists('a1', 's1'), false);
    assert.equal(storage.sessionExists('a1', 's2'), true);
  } finally {
    await storage.close();
    cleanup();
  }
});

test('clearSessionsForAssistant removes all sessions for an assistant', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    storage.insertSession(makeSession('a1', 's1'), true);
    storage.insertSession(makeSession('a1', 's2'), true);
    storage.insertSession(makeSession('a2', 's3'), true);

    const removed = storage.clearSessionsForAssistant('a1', true);
    assert.equal(removed, 2);
    assert.equal(storage.countSessions(), 1);
    assert.equal(storage.sessionExists('a2', 's3'), true);
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── Truncate Messages ──────────────────────────────────────────────────────

test('truncateMessages keeps only the first N messages', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const msgs = [
      makeMessage('user', 'msg1', 'm1'),
      makeMessage('assistant', 'reply1', 'm2'),
      makeMessage('user', 'msg2', 'm3'),
      makeMessage('assistant', 'reply2', 'm4')
    ];
    const session = makeSession('a1', 's1', msgs);
    storage.insertSession(session, true);

    storage.truncateMessages('a1', 's1', 2, Date.now(), true);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[0].id, 'm1');
    assert.equal(detail.messages[1].id, 'm2');
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── Delete Message ──────────────────────────────────────────────────────────

test('deleteMessage removes a specific message', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const msgs = [
      makeMessage('user', 'msg1', 'm1'),
      makeMessage('assistant', 'reply1', 'm2'),
      makeMessage('user', 'msg2', 'm3')
    ];
    const session = makeSession('a1', 's1', msgs);
    storage.insertSession(session, true);

    storage.deleteMessage('a1', 's1', 'm2', Date.now(), true);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[0].id, 'm1');
    assert.equal(detail.messages[1].id, 'm3');
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── Clear Session Messages ──────────────────────────────────────────────────

test('clearSessionMessages removes all messages from a session', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const msgs = [makeMessage('user', 'msg1'), makeMessage('assistant', 'reply1')];
    const session = makeSession('a1', 's1', msgs);
    storage.insertSession(session, true);

    storage.clearSessionMessages('a1', 's1', Date.now(), true);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.messages.length, 0);
  } finally {
    await storage.close();
    cleanup();
  }
});

test('clearSessionMessages rejects assistant-session mismatch', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const msgs = [makeMessage('user', 'msg1', 'm1'), makeMessage('assistant', 'reply1', 'm2')];
    storage.insertSession(makeSession('a1', 's1', msgs), true);

    const cleared = storage.clearSessionMessages('a2', 's1', Date.now(), true);
    assert.equal(cleared, false);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[0].id, 'm1');
    assert.equal(detail.messages[1].id, 'm2');
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── KV Store ────────────────────────────────────────────────────────────────

test('KV store set and get', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    storage.setKv('test.key', 'hello', true);
    assert.equal(storage.getKv('test.key'), 'hello');
    assert.equal(storage.getKv('nonexistent'), undefined);
  } finally {
    await storage.close();
    cleanup();
  }
});

test('KV store overwrites existing value', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    storage.setKv('test.key', 'v1', true);
    storage.setKv('test.key', 'v2', true);
    assert.equal(storage.getKv('test.key'), 'v2');
  } finally {
    await storage.close();
    cleanup();
  }
});

test('state/settings are persisted into structured per-page files', async () => {
  const { storage, tmpDir, cleanup } = await createStorage();
  try {
    const state = createInitialState();
    state.selectedAssistantId = 'assistant-structured';
    state.selectedSessionIdByAssistant = { 'assistant-structured': 'session-1' };
    state.settings.temperature = 0.42;
    state.settings.sendShortcut = 'ctrlEnter';

    storage.writeStateLite(state, false);
    storage.writeProviderApiKeys({ openai: 'sk-structured' }, false);
    await storage.flush();

    const metaDir = path.join(tmpDir, 'meta');
    const core = JSON.parse(await fs.promises.readFile(path.join(metaDir, 'state.core.json'), 'utf-8')) as {
      assistants: Array<{ id: string }>;
    };
    const ui = JSON.parse(await fs.promises.readFile(path.join(metaDir, 'ui.selection.json'), 'utf-8')) as {
      selectedAssistantId?: string;
      selectedSessionIdByAssistant: Record<string, string>;
    };
    const general = JSON.parse(await fs.promises.readFile(path.join(metaDir, 'settings.general.json'), 'utf-8')) as {
      temperature: number;
      sendShortcut: string;
    };
    const commit = JSON.parse(await fs.promises.readFile(path.join(metaDir, 'state.commit.json'), 'utf-8')) as {
      layoutVersion: number;
      generation: number;
    };
    const providerApiKeys = JSON.parse(
      await fs.promises.readFile(path.join(metaDir, 'providers.api-keys.json'), 'utf-8')
    ) as Record<string, string>;

    assert.equal(Array.isArray(core.assistants), true);
    assert.equal(ui.selectedAssistantId, 'assistant-structured');
    assert.equal(ui.selectedSessionIdByAssistant['assistant-structured'], 'session-1');
    assert.equal(general.temperature, 0.42);
    assert.equal(general.sendShortcut, 'ctrlEnter');
    assert.equal(commit.layoutVersion, 3);
    assert.equal(commit.generation, 1);
    assert.equal(providerApiKeys.openai, 'sk-structured');
  } finally {
    await storage.close();
    cleanup();
  }
});

test('state compat key merges partial payloads into the current structured state', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const state = createInitialState();
    state.selectedAssistantId = 'assistant-keep';
    state.settings.temperature = 0.7;
    state.settings.timeoutMs = 60000;
    storage.writeStateLite(state, false);
    await storage.flush();

    storage.setKv(COMPASS_STATE_STORE_KEY, JSON.stringify({ settings: { temperature: 0.15 } }), false);

    const nextState = storage.readStateLite() as ReturnType<typeof createInitialState>;
    assert.equal(nextState.selectedAssistantId, 'assistant-keep');
    assert.equal(nextState.settings.temperature, 0.15);
    assert.equal(nextState.settings.timeoutMs, 60000);
  } finally {
    await storage.close();
    cleanup();
  }
});

test('invalid state compat payload keeps the current structured state intact', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const state = createInitialState();
    state.selectedAssistantId = 'assistant-safe';
    storage.writeStateLite(state, false);
    await storage.flush();

    storage.setKv(COMPASS_STATE_STORE_KEY, '{broken json', false);

    const nextState = storage.readStateLite() as ReturnType<typeof createInitialState>;
    assert.equal(nextState.selectedAssistantId, 'assistant-safe');
  } finally {
    await storage.close();
    cleanup();
  }
});

test('invalid provider api keys compat payload does not clear the current structured secrets', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    storage.writeProviderApiKeys({ openai: 'sk-safe' }, false);
    await storage.flush();

    storage.setKv(COMPASS_PROVIDER_API_KEYS_STORE_KEY, '{broken json', false);

    assert.equal(storage.readProviderApiKeys().openai, 'sk-safe');
  } finally {
    await storage.close();
    cleanup();
  }
});

test('replaceAllKv ignores reserved compass keys and only replaces regular kv entries', async () => {
  const { storage, tmpDir, cleanup } = await createStorage();
  try {
    const state = createInitialState();
    state.selectedAssistantId = 'assistant-safe';
    storage.writeStateLite(state, false);
    storage.writeProviderApiKeys({ openai: 'sk-safe' }, false);
    await storage.flush();

    storage.replaceAllKv(
      {
        custom: 'value',
        [COMPASS_STATE_STORE_KEY]: JSON.stringify({ selectedAssistantId: 'assistant-hijack' }),
        [COMPASS_PROVIDER_API_KEYS_STORE_KEY]: JSON.stringify({ evil: 'sk-evil' })
      },
      false
    );
    await storage.flush();

    const kvPayload = JSON.parse(await fs.promises.readFile(path.join(tmpDir, 'meta', 'kv.compass.json'), 'utf-8')) as Record<
      string,
      string
    >;
    const nextState = storage.readStateLite() as ReturnType<typeof createInitialState>;

    assert.equal(storage.getKv('custom'), 'value');
    assert.deepEqual(kvPayload, { custom: 'value' });
    assert.equal(nextState.selectedAssistantId, 'assistant-safe');
    assert.equal(storage.readProviderApiKeys().openai, 'sk-safe');
  } finally {
    await storage.close();
    cleanup();
  }
});

// ─── Update Message ──────────────────────────────────────────────────────────

test('updateMessage changes message content', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    const msgs = [makeMessage('assistant', 'original', 'm1')];
    const session = makeSession('a1', 's1', msgs);
    storage.insertSession(session, true);

    storage.updateMessage('a1', 's1', 'm1', 'updated', Date.now(), true);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.messages[0].content, 'updated');
  } finally {
    await storage.close();
    cleanup();
  }
});

test('updateMessage rejects assistant-session mismatch', async () => {
  const { storage, cleanup } = await createStorage();
  try {
    storage.insertSession(makeSession('a1', 's1', [makeMessage('assistant', 'original', 'm1')]), true);

    const updated = storage.updateMessage('a2', 's1', 'm1', 'updated', Date.now(), true);
    assert.equal(updated, false);

    const detail = storage.getSessionDetailById('s1');
    assert.ok(detail);
    assert.equal(detail.messages[0].content, 'original');
  } finally {
    await storage.close();
    cleanup();
  }
});
