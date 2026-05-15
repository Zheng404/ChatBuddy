import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ExtensionContext } from 'vscode';

import { ChatStorage } from '../chatbuddy/chatStorage';
import { ChatStateRepository } from '../chatbuddy/stateRepository';
import type { ChatBuddySettings, ProviderProfile } from '../chatbuddy/types';

type TestRepositoryHandle = {
  repository: ChatStateRepository;
  tmpDir: string;
  cleanup: () => Promise<void>;
};

function createProvider(): ProviderProfile {
  return {
    id: 'openai',
    kind: 'openai',
    name: 'OpenAI',
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    apiType: 'responses',
    enabled: true,
    models: [{ id: 'gpt-5', name: 'GPT-5' }]
  };
}

function getStorage(repository: ChatStateRepository): ChatStorage {
  return (repository as unknown as { storage: ChatStorage }).storage;
}

async function createRepository(): Promise<TestRepositoryHandle> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chatbuddy-repository-test-'));
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
    tmpDir,
    cleanup: async () => {
      await repository.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };
}

function applyProviderSettings(repository: ChatStateRepository): void {
  const settings: ChatBuddySettings = repository.getSettings();
  settings.providers = [createProvider()];
  settings.defaultModels = {
    ...settings.defaultModels,
    assistant: {
      providerId: 'openai',
      modelId: 'gpt-5'
    }
  };
  repository.updateSettings(settings);
}

async function createStructuredBackupSample(repository: ChatStateRepository) {
  applyProviderSettings(repository);
  const assistant = repository.createAssistant({ name: '测试助手' });
  const session = repository.createSession(assistant.id, '测试会话');
  repository.appendMessage(assistant.id, session.id, {
    id: 'msg-1',
    role: 'user',
    content: '你好，ChatBuddy',
    timestamp: Date.now()
  });
  const storage = getStorage(repository);
  storage.setKv('custom.key', 'custom-value', false);
  await storage.flush();
  return {
    assistant,
    sessionId: session.id,
    backup: repository.exportBackupData()
  };
}

test('exportBackupData emits compass storage backup payload', async () => {
  const { repository, cleanup } = await createRepository();
  try {
    const { assistant, sessionId, backup } = await createStructuredBackupSample(repository);

    assert.equal(backup.schema, 'chatbuddy.backup.compass');
    assert.equal(backup.version, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(backup, 'state'), false);
    assert.equal(backup.storage.layout, 'compass');
    assert.equal(backup.storage.layoutVersion, 3);
    assert.equal(backup.storage.structuredState.core.assistants.length, 1);
    assert.equal(backup.storage.structuredState.core.assistants[0].id, assistant.id);
    assert.equal(backup.storage.structuredState.settingsModelConfig.providers[0].apiKey, '');
    assert.equal(backup.storage.providerApiKeys.openai, 'sk-test');
    assert.equal(backup.storage.sessions.length, 1);
    assert.equal(backup.storage.sessions[0].id, sessionId);
    assert.equal(backup.storage.kv['custom.key'], 'custom-value');
  } finally {
    await cleanup();
  }
});

test('importBackupData restores structured backup and clears stale kv data', async () => {
  const source = await createRepository();
  const target = await createRepository();
  try {
    const { sessionId, backup } = await createStructuredBackupSample(source.repository);
    const targetStorage = getStorage(target.repository);
    targetStorage.setKv('stale.key', 'stale-value', false);

    await target.repository.importBackupData(backup);

    const assistants = target.repository.getAssistants();
    assert.equal(assistants.length, 1);
    assert.equal(assistants[0].name, '测试助手');
    assert.equal(target.repository.getSettings().providers[0].apiKey, 'sk-test');
    assert.equal(targetStorage.getKv('custom.key'), 'custom-value');
    assert.equal(targetStorage.getKv('stale.key'), undefined);

    const importedSession = target.repository.getSessionById(sessionId);
    assert.ok(importedSession);
    assert.equal(importedSession.messages.length, 1);
    assert.equal(importedSession.messages[0].content, '你好，ChatBuddy');
  } finally {
    await source.cleanup();
    await target.cleanup();
  }
});

test('importBackupData accepts legacy json backup payload and migrates it into current storage', async () => {
  const source = await createRepository();
  const target = await createRepository();
  try {
    const { assistant, sessionId } = await createStructuredBackupSample(source.repository);
    const legacyState = source.repository.getState();
    const legacyPayload = {
      schema: 'chatbuddy.backup',
      version: 1,
      state: {
        ...legacyState,
        sessions: getStorage(source.repository).listAllSessions(),
        settings: {
          ...legacyState.settings,
          providers: legacyState.settings.providers.map((provider) => ({
            ...provider,
            apiKey: provider.id === 'openai' ? 'sk-test' : provider.apiKey
          }))
        }
      }
    };

    await target.repository.importBackupData(legacyPayload);

    assert.equal(target.repository.getAssistants().length, 1);
    assert.equal(target.repository.getAssistants()[0].id, assistant.id);
    assert.equal(target.repository.getSettings().providers[0].apiKey, 'sk-test');
    const importedSession = target.repository.getSessionById(sessionId);
    assert.ok(importedSession);
    assert.equal(importedSession.messages[0].content, '你好，ChatBuddy');
  } finally {
    await source.cleanup();
    await target.cleanup();
  }
});

test('resetState clears sessions and custom kv data completely', async () => {
  const handle = await createRepository();
  try {
    const { repository, tmpDir } = handle;
    const { assistant } = await createStructuredBackupSample(repository);

    const storage = getStorage(repository);
    assert.equal(storage.countSessions(), 1);
    assert.equal(storage.getKv('custom.key'), 'custom-value');

    await repository.resetState();

    assert.equal(storage.countSessions(), 0);
    assert.equal(storage.getKv('custom.key'), undefined);

    const kvFilePath = path.join(tmpDir, 'meta', 'kv.compass.json');
    const assistantSessionDirPath = path.join(tmpDir, 'sessions', assistant.id);
    assert.equal(fs.existsSync(kvFilePath), false);
    assert.equal(fs.existsSync(assistantSessionDirPath), false);
  } finally {
    await handle.cleanup();
  }
});
