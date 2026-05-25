import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ExtensionContext } from 'vscode';

import {
  BACKUP_ARCHIVE_MANIFEST_PATH,
  createBackupArchive,
  extractBackupPayloadFromArchive,
  isZipArchive,
  readZipArchiveEntries
} from '../chatbuddy/backupArchive';
import { ChatStateRepository } from '../chatbuddy/stateRepository';

type ZipTestEntry = {
  path: string;
  data: Uint8Array;
};

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

async function createRepository(): Promise<{ repository: ChatStateRepository; cleanup: () => Promise<void> }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chatbuddy-backup-archive-test-'));
  const repository = new ChatStateRepository({
    globalStorageUri: {
      fsPath: tmpDir,
      path: tmpDir,
      toString: () => tmpDir
    },
    globalState: {
      get: () => undefined,
      update: () => Promise.resolve(),
      keys: () => []
    }
  } as unknown as ExtensionContext);
  await repository.initialize();
  return {
    repository,
    cleanup: async () => {
      await repository.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };
}

function crc32(input: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of input) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function toJsonBytes(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createTestZipArchive(entries: ZipTestEntry[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.path, 'utf8');
    const dataBytes = Buffer.from(entry.data);
    const checksum = crc32(dataBytes);

    const localHeader = Buffer.alloc(30 + nameBytes.length);
    localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER_SIGNATURE, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(ZIP_STORE_METHOD, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(dataBytes.length, 18);
    localHeader.writeUInt32LE(dataBytes.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBytes.copy(localHeader, 30);

    const centralHeader = Buffer.alloc(46 + nameBytes.length);
    centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(ZIP_STORE_METHOD, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(dataBytes.length, 20);
    centralHeader.writeUInt32LE(dataBytes.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    nameBytes.copy(centralHeader, 46);

    localParts.push(localHeader, dataBytes);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + dataBytes.length;
  }

  const centralOffset = localOffset;
  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(centralOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

function rebuildArchive(entries: Map<string, Uint8Array>): Uint8Array {
  return createTestZipArchive(
    [...entries.entries()]
      .map(([entryPath, data]) => ({ path: entryPath, data }))
      .sort((left, right) => left.path.localeCompare(right.path))
  );
}

function createNestedRootArchive(entries: Map<string, Uint8Array>, rootDirName = 'archive-root'): Uint8Array {
  const rootedEntries = new Map<string, Uint8Array>();
  for (const [entryPath, data] of entries.entries()) {
    rootedEntries.set(entryPath === BACKUP_ARCHIVE_MANIFEST_PATH ? entryPath : `${rootDirName}/${entryPath}`, data);
  }
  return rebuildArchive(rootedEntries);
}

function readArchiveJson<T>(entries: Map<string, Uint8Array>, entryPath: string): T {
  const data = entries.get(entryPath);
  assert.ok(data, `Missing archive entry: ${entryPath}`);
  return JSON.parse(Buffer.from(data).toString('utf8')) as T;
}

test('createBackupArchive packages manifest metadata and restores payload from structured files', async () => {
  const { repository, cleanup } = await createRepository();
  try {
    const settings = repository.getSettings();
    settings.providers = [
      {
        id: 'openai',
        kind: 'openai',
        name: 'OpenAI',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        apiType: 'responses',
        enabled: true,
        models: [{ id: 'gpt-5', name: 'GPT-5' }]
      }
    ];
    repository.updateSettings(settings);

    const assistant = repository.createAssistant({ name: '归档测试助手' });
    const session = repository.createSession(assistant.id, '归档测试会话');
    repository.appendMessage(assistant.id, session.id, {
      id: 'msg-archive',
      role: 'user',
      content: '打包导出测试',
      timestamp: Date.now()
    });

    const storage = (repository as unknown as { storage: { setKv: (key: string, value: string, persist?: boolean) => void; flush: () => Promise<void> } }).storage;
    storage.setKv('custom.key', 'custom-value', false);
    storage.setKv('custom.empty', '', false);
    storage.setKv('custom.whitespace', '  keep surrounding whitespace  ', false);
    storage.setKv('custom.multiline', 'line1\nline2\n', false);
    await storage.flush();

    const backup = repository.exportBackupData();
    const archive = createBackupArchive(backup);
    const entries = await readZipArchiveEntries(archive);
    const restored = await extractBackupPayloadFromArchive(archive);
    const manifest = readArchiveJson<Record<string, unknown>>(entries, BACKUP_ARCHIVE_MANIFEST_PATH);
    const manifestStorage = manifest.storage as Record<string, unknown>;

    assert.equal(isZipArchive(archive), true);
    assert.equal(entries.has(BACKUP_ARCHIVE_MANIFEST_PATH), true);
    assert.equal(entries.has('meta/state.core.json'), true);
    assert.equal(entries.has('meta/ui.selection.json'), true);
    assert.equal(entries.has('meta/settings.general.json'), true);
    assert.equal(entries.has('meta/settings.model-config.json'), true);
    assert.equal(entries.has('meta/settings.default-models.json'), true);
    assert.equal(entries.has('meta/settings.mcp.json'), true);
    assert.equal(entries.has('meta/providers.api-keys.json'), true);
    assert.equal(entries.has('meta/kv.compass.json'), true);
    assert.equal(entries.has('sessions/index.compass.json'), true);
    assert.equal(entries.has(`sessions/${assistant.id}/${session.id}.jsonl`), true);
    assert.equal(manifest.schema, 'chatbuddy.backup.compass');
    assert.equal(manifest.packageFormat, 'structured-zip');
    assert.equal(manifestStorage.layout, 'compass');
    assert.equal(Object.prototype.hasOwnProperty.call(manifestStorage, 'structuredState'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(manifestStorage, 'sessions'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(manifestStorage, 'providerApiKeys'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(manifestStorage, 'kv'), false);
    assert.deepEqual(restored, JSON.parse(JSON.stringify(backup)));
  } finally {
    await cleanup();
  }
});

test('extractBackupPayloadFromArchive rejects archives missing required structured files', async () => {
  const { repository, cleanup } = await createRepository();
  try {
    const backup = repository.exportBackupData();
    const archive = createBackupArchive(backup);
    const entries = await readZipArchiveEntries(archive);
    entries.delete('meta/state.core.json');

    await assert.rejects(
      () => extractBackupPayloadFromArchive(rebuildArchive(entries)),
      /Backup archive entry is missing: meta\/state\.core\.json/
    );
  } finally {
    await cleanup();
  }
});

test('extractBackupPayloadFromArchive supports rooted structured archives from older layouts', async () => {
  const { repository, cleanup } = await createRepository();
  try {
    const assistant = repository.createAssistant({ name: '旧版归档助手' });
    const session = repository.createSession(assistant.id, '旧版归档会话');
    repository.appendMessage(assistant.id, session.id, {
      id: 'msg-legacy-archive',
      role: 'assistant',
      content: 'legacy rooted archive',
      timestamp: Date.now()
    });

    const backup = repository.exportBackupData();
    const archive = createBackupArchive(backup);
    const legacyArchive = createNestedRootArchive(await readZipArchiveEntries(archive));

    assert.deepEqual(await extractBackupPayloadFromArchive(legacyArchive), JSON.parse(JSON.stringify(backup)));
  } finally {
    await cleanup();
  }
});

test('readZipArchiveEntries rejects archives with duplicate entry paths', async () => {
  const archive = createTestZipArchive([
    {
      path: BACKUP_ARCHIVE_MANIFEST_PATH,
      data: toJsonBytes({ schema: 'chatbuddy.backup.compass', version: 2, exportedAt: new Date().toISOString() })
    },
    {
      path: BACKUP_ARCHIVE_MANIFEST_PATH,
      data: toJsonBytes({ schema: 'chatbuddy.backup.compass', version: 2, exportedAt: new Date().toISOString() })
    }
  ]);

  await assert.rejects(
    () => readZipArchiveEntries(archive),
    /ZIP archive contains duplicate entry: backup\.manifest\.json/
  );
});

test('extractBackupPayloadFromArchive rejects archives with session index mismatch', async () => {
  const { repository, cleanup } = await createRepository();
  try {
    const assistant = repository.createAssistant({ name: '索引测试助手' });
    const session = repository.createSession(assistant.id, '索引测试会话');
    repository.appendMessage(assistant.id, session.id, {
      id: 'msg-index',
      role: 'assistant',
      content: '索引不一致测试',
      timestamp: Date.now()
    });

    const archive = createBackupArchive(repository.exportBackupData());
    const entries = await readZipArchiveEntries(archive);
    const indexPayload = readArchiveJson<{ sessions: Array<Record<string, unknown>> }>(
      entries,
      'sessions/index.compass.json'
    );
    indexPayload.sessions[0].messageCount = 99;
    entries.set('sessions/index.compass.json', toJsonBytes(indexPayload));

    await assert.rejects(
      () => extractBackupPayloadFromArchive(rebuildArchive(entries)),
      /Backup session index does not match session file/
    );
  } finally {
    await cleanup();
  }
});

test('extractBackupPayloadFromArchive rejects archives with duplicate session id', async () => {
  const { repository, cleanup } = await createRepository();
  try {
    const assistant = repository.createAssistant({ name: '重复 ID 助手' });
    const session = repository.createSession(assistant.id, '重复 ID 会话');
    repository.appendMessage(assistant.id, session.id, {
      id: 'msg-dup-id',
      role: 'user',
      content: 'duplicate session id',
      timestamp: Date.now()
    });

    const archive = createBackupArchive(repository.exportBackupData());
    const entries = await readZipArchiveEntries(archive);
    const indexPayload = readArchiveJson<{ sessions: Array<Record<string, unknown>> }>(
      entries,
      'sessions/index.compass.json'
    );
    indexPayload.sessions.push({
      ...indexPayload.sessions[0],
      assistantId: 'other-assistant'
    });
    entries.set('sessions/index.compass.json', toJsonBytes(indexPayload));

    await assert.rejects(
      () => extractBackupPayloadFromArchive(rebuildArchive(entries)),
      /Backup session index contains duplicate session id/
    );
  } finally {
    await cleanup();
  }
});

test('extractBackupPayloadFromArchive rejects archives with duplicate session file reference', async () => {
  const { repository, cleanup } = await createRepository();
  try {
    const assistant = repository.createAssistant({ name: '重复文件助手' });
    const session = repository.createSession(assistant.id, '重复文件会话');
    repository.appendMessage(assistant.id, session.id, {
      id: 'msg-dup-path',
      role: 'assistant',
      content: 'duplicate session file',
      timestamp: Date.now()
    });

    const archive = createBackupArchive(repository.exportBackupData());
    const entries = await readZipArchiveEntries(archive);
    const indexPayload = readArchiveJson<{ sessions: Array<Record<string, unknown>> }>(
      entries,
      'sessions/index.compass.json'
    );
    indexPayload.sessions.push({
      ...indexPayload.sessions[0],
      title: 'another summary for same file'
    });
    entries.set('sessions/index.compass.json', toJsonBytes(indexPayload));

    await assert.rejects(
      () => extractBackupPayloadFromArchive(rebuildArchive(entries)),
      /Backup session index contains duplicate session file reference/
    );
  } finally {
    await cleanup();
  }
});

test('extractBackupPayloadFromArchive rejects archives with malformed session jsonl', async () => {
  const { repository, cleanup } = await createRepository();
  try {
    const assistant = repository.createAssistant({ name: 'JSONL 测试助手' });
    const session = repository.createSession(assistant.id, 'JSONL 测试会话');
    repository.appendMessage(assistant.id, session.id, {
      id: 'msg-jsonl',
      role: 'user',
      content: '测试 JSONL',
      timestamp: Date.now()
    });

    const archive = createBackupArchive(repository.exportBackupData());
    const entries = await readZipArchiveEntries(archive);
    entries.set(
      `sessions/${assistant.id}/${session.id}.jsonl`,
      Buffer.from('{"id":"msg-jsonl","role":"user","content":"ok","timestamp":1}\nnot-json\n', 'utf8')
    );

    await assert.rejects(
      () => extractBackupPayloadFromArchive(rebuildArchive(entries)),
      new RegExp(`Backup session file contains invalid JSONL: sessions/${assistant.id}/${session.id}\\.jsonl`)
    );
  } finally {
    await cleanup();
  }
});

test('extractBackupPayloadFromArchive rejects archives with newer backup version', async () => {
  const { repository, cleanup } = await createRepository();
  try {
    const archive = createBackupArchive(repository.exportBackupData());
    const entries = await readZipArchiveEntries(archive);
    const manifest = readArchiveJson<Record<string, unknown>>(entries, BACKUP_ARCHIVE_MANIFEST_PATH);
    manifest.version = 999;
    entries.set(BACKUP_ARCHIVE_MANIFEST_PATH, toJsonBytes(manifest));

    await assert.rejects(
      () => extractBackupPayloadFromArchive(rebuildArchive(entries)),
      /Backup archive version is newer than supported: 999/
    );
  } finally {
    await cleanup();
  }
});

test('extractBackupPayloadFromArchive rejects archives with newer layout version', async () => {
  const { repository, cleanup } = await createRepository();
  try {
    const archive = createBackupArchive(repository.exportBackupData());
    const entries = await readZipArchiveEntries(archive);
    const manifest = readArchiveJson<Record<string, unknown>>(entries, BACKUP_ARCHIVE_MANIFEST_PATH);
    manifest.storage = {
      ...(manifest.storage as Record<string, unknown>),
      layoutVersion: 999
    };
    entries.set(BACKUP_ARCHIVE_MANIFEST_PATH, toJsonBytes(manifest));

    await assert.rejects(
      () => extractBackupPayloadFromArchive(rebuildArchive(entries)),
      /Backup archive layout version is newer than supported: 999/
    );
  } finally {
    await cleanup();
  }
});
