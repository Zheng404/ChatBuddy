/**
 * API Key 持久化专项测试。
 *
 * 验证以下场景中 API Key 不会丢失：
 * 1. updateSettings → persist → restart（重新 initialize）
 * 2. updateSettings → persist → restart → updateSettings（二次修改）
 * 3. 多个 provider 的 API Key 独立保存
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ExtensionContext } from 'vscode';

import { ChatStateRepository } from '../chatbuddy/stateRepository';
import type { ChatBuddySettings, ProviderProfile } from '../chatbuddy/types';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeProvider(id: string, apiKey: string): ProviderProfile {
  return {
    id,
    kind: 'openai',
    name: `Provider ${id}`,
    apiKey,
    baseUrl: 'https://api.openai.com/v1',
    apiType: 'responses',
    enabled: true,
    models: [{ id: 'gpt-5', name: 'GPT-5' }]
  };
}

function makeContext(tmpDir: string): ExtensionContext {
  return {
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
  } as unknown as ExtensionContext;
}

async function createRepo(tmpDir: string): Promise<ChatStateRepository> {
  const repo = new ChatStateRepository(makeContext(tmpDir));
  await repo.initialize();
  return repo;
}

async function drainAndClose(repo: ChatStateRepository): Promise<void> {
  await repo.close();
}

// ── Tests ────────────────────────────────────────────────────────────────

void test('apiKey persistence — updateSettings 后 restart，API Key 保留', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'apikey-test-'));
  try {
    // 1. 创建仓库，设置 provider with API key
    const repo1 = await createRepo(tmpDir);
    const settings: ChatBuddySettings = repo1.getSettings();
    settings.providers = [makeProvider('openai', 'sk-test-key-123')];
    repo1.updateSettings(settings);

    // 确认内存中 API key 存在
    const s1 = repo1.getSettings();
    assert.equal(s1.providers[0].apiKey, 'sk-test-key-123', '内存中应有 API key');

    // 2. 等待 persist 完成，关闭仓库
    await drainAndClose(repo1);

    // 3. 重新创建仓库（模拟 restart）
    const repo2 = await createRepo(tmpDir);

    // 4. 验证 API key 保留
    const s2 = repo2.getSettings();
    assert.ok(s2.providers.length > 0, '应有 provider');
    assert.equal(s2.providers[0].id, 'openai', 'provider ID 应保留');
    assert.equal(s2.providers[0].apiKey, 'sk-test-key-123', 'restart 后 API key 应保留');

    await drainAndClose(repo2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

void test('apiKey persistence — 多 provider API Key 独立保存', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'apikey-test-'));
  try {
    const repo1 = await createRepo(tmpDir);
    const settings: ChatBuddySettings = repo1.getSettings();
    settings.providers = [
      makeProvider('openai', 'sk-openai-key'),
      makeProvider('anthropic', 'sk-ant-key'),
      makeProvider('gemini', 'gemini-key')
    ];
    repo1.updateSettings(settings);
    await drainAndClose(repo1);

    const repo2 = await createRepo(tmpDir);
    const s2 = repo2.getSettings();
    assert.equal(s2.providers.length, 3, '应有 3 个 provider');

    const openai = s2.providers.find((p) => p.id === 'openai');
    const anthropic = s2.providers.find((p) => p.id === 'anthropic');
    const gemini = s2.providers.find((p) => p.id === 'gemini');

    assert.ok(openai, 'openai provider 应存在');
    assert.ok(anthropic, 'anthropic provider 应存在');
    assert.ok(gemini, 'gemini provider 应存在');

    assert.equal(openai.apiKey, 'sk-openai-key', 'openai API key 应保留');
    assert.equal(anthropic.apiKey, 'sk-ant-key', 'anthropic API key 应保留');
    assert.equal(gemini.apiKey, 'gemini-key', 'gemini API key 应保留');

    await drainAndClose(repo2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

void test('apiKey persistence — restart 后修改 API Key，再次 restart 仍保留', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'apikey-test-'));
  try {
    // 第一次设置
    const repo1 = await createRepo(tmpDir);
    const s1: ChatBuddySettings = repo1.getSettings();
    s1.providers = [makeProvider('openai', 'sk-old-key')];
    repo1.updateSettings(s1);
    await drainAndClose(repo1);

    // 第一次 restart
    const repo2 = await createRepo(tmpDir);
    const s2 = repo2.getSettings();
    assert.equal(s2.providers[0].apiKey, 'sk-old-key', '第一次 restart 后 key 应保留');

    // 修改 API key
    s2.providers[0].apiKey = 'sk-new-key';
    repo2.updateSettings(s2);
    await drainAndClose(repo2);

    // 第二次 restart
    const repo3 = await createRepo(tmpDir);
    const s3 = repo3.getSettings();
    assert.equal(s3.providers[0].apiKey, 'sk-new-key', '第二次 restart 后新 key 应保留');

    await drainAndClose(repo3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

void test('apiKey persistence — 无 API key 的 provider 不影响其他 provider', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'apikey-test-'));
  try {
    const repo1 = await createRepo(tmpDir);
    const s1: ChatBuddySettings = repo1.getSettings();
    s1.providers = [
      makeProvider('openai', 'sk-openai-key'),
      makeProvider('ollama', '')  // 本地模型，无 API key
    ];
    repo1.updateSettings(s1);
    await drainAndClose(repo1);

    const repo2 = await createRepo(tmpDir);
    const s2 = repo2.getSettings();
    assert.equal(s2.providers.length, 2, '应有 2 个 provider');

    const openai = s2.providers.find((p) => p.id === 'openai');
    const ollama = s2.providers.find((p) => p.id === 'ollama');

    assert.ok(openai, 'openai provider 应存在');
    assert.ok(ollama, 'ollama provider 应存在');
    assert.equal(openai.apiKey, 'sk-openai-key', 'openai API key 应保留');
    assert.equal(ollama.apiKey, '', 'ollama 无 API key 应保持为空');

    await drainAndClose(repo2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
