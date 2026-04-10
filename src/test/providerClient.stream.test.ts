import test from 'node:test';
import assert from 'node:assert/strict';

import { OpenAICompatibleClient } from '../chatbuddy/providerClient';
import { ProviderConfig } from '../chatbuddy/types';

function createProviderConfig(apiType: 'chat_completions' | 'responses'): ProviderConfig {
  return {
    providerId: 'provider-1',
    providerKind: 'custom',
    providerName: 'Provider 1',
    apiType,
    apiKey: '',
    baseUrl: 'https://example.invalid/v1',
    modelId: 'model-1',
    modelRef: 'provider-1:model-1',
    modelLabel: 'model-1',
    temperature: 0.7,
    topP: 1,
    maxTokens: 1024,
    contextCount: 8,
    presencePenalty: 0,
    frequencyPenalty: 0,
    timeoutMs: 10_000
  };
}

function createSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    }
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream'
    }
  });
}

function mockFetchWithResponse(response: Response): () => void {
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = async () => response;
  return () => {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  };
}

test('chatCompletions stream parses text deltas and handles [DONE]', async () => {
  const restoreFetch = mockFetchWithResponse(
    createSseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
      'data: [DONE]\n'
    ])
  );

  try {
    const client = new OpenAICompatibleClient();
    let text = '';
    let doneCount = 0;
    await client.chatStream(
      [{ role: 'user', content: 'ping' }],
      createProviderConfig('chat_completions'),
      {
        onDelta(delta) {
          text += delta;
        },
        onDone() {
          doneCount += 1;
        }
      },
      'en'
    );
    assert.equal(text, 'Hello');
    assert.equal(doneCount, 1);
  } finally {
    restoreFetch();
  }
});

test('responses stream stops when done event arrives without [DONE] marker', async () => {
  const restoreFetch = mockFetchWithResponse(
    createSseResponse([
      'data: {"type":"response.output_text.delta","delta":"A"}\n',
      'data: {"type":"response.output_text.delta","delta":"B"}\n',
      'data: {"type":"response.completed"}\n'
    ])
  );

  try {
    const client = new OpenAICompatibleClient();
    let text = '';
    let doneCount = 0;
    await client.chatStream(
      [{ role: 'user', content: 'ping' }],
      createProviderConfig('responses'),
      {
        onDelta(delta) {
          text += delta;
        },
        onDone() {
          doneCount += 1;
        }
      },
      'en'
    );
    assert.equal(text, 'AB');
    assert.equal(doneCount, 1);
  } finally {
    restoreFetch();
  }
});

test('stream parser ignores invalid JSON chunks', async () => {
  const restoreFetch = mockFetchWithResponse(
    createSseResponse([
      'data: {"choices":[{"delta":{"content":"Ok"}}]}\n',
      'data: invalid-json\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n',
      'data: [DONE]\n'
    ])
  );

  try {
    const client = new OpenAICompatibleClient();
    let text = '';
    let doneCount = 0;
    await client.chatStream(
      [{ role: 'user', content: 'ping' }],
      createProviderConfig('chat_completions'),
      {
        onDelta(delta) {
          text += delta;
        },
        onDone() {
          doneCount += 1;
        }
      },
      'en'
    );
    assert.equal(text, 'Ok!');
    assert.equal(doneCount, 1);
  } finally {
    restoreFetch();
  }
});
