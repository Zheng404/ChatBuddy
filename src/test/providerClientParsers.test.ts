/**
 * providerClientParsers 单元测试。
 *
 * 覆盖 Chat Completions 和 Responses API 的响应解析、
 * 流式 delta 提取、模型列表解析等纯函数。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractChatCompletionResult,
  extractResponsesResult,
  extractChatCompletionsStreamDelta,
  extractResponsesStreamEvent,
  parseStandardModelList,
  parseGeminiModels,
  parseOllamaModels
} from '../chatbuddy/providerClientParsers';

// ─── extractChatCompletionResult ────────────────────────────────────

describe('extractChatCompletionResult', () => {
  test('extracts string content from choices[0].message', () => {
    const result = extractChatCompletionResult({
      choices: [{ message: { content: 'Hello world', role: 'assistant' } }]
    });
    assert.equal(result.text, 'Hello world');
  });

  test('extracts array content parts', () => {
    const result = extractChatCompletionResult({
      choices: [{
        message: {
          content: [{ type: 'text', text: 'part1' }, { type: 'text', text: 'part2' }]
        }
      }]
    });
    assert.equal(result.text, 'part1\npart2');
  });

  test('extracts reasoning_content', () => {
    const result = extractChatCompletionResult({
      choices: [{
        message: {
          content: 'answer',
          reasoning_content: 'thinking...'
        }
      }]
    });
    assert.equal(result.text, 'answer');
    assert.equal(result.reasoning, 'thinking...');
  });

  test('extracts reasoning from nested reasoning field', () => {
    const result = extractChatCompletionResult({
      choices: [{
        message: {
          content: 'answer',
          reasoning: 'deep thought'
        }
      }]
    });
    assert.equal(result.reasoning, 'deep thought');
  });

  test('extracts tool_calls', () => {
    const result = extractChatCompletionResult({
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            id: 'tc-1',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"test"}' }
          }]
        }
      }]
    });
    assert.equal(result.toolCalls?.length, 1);
    assert.equal(result.toolCalls?.[0].id, 'tc-1');
    assert.equal(result.toolCalls?.[0].name, 'search');
    assert.equal(result.toolCalls?.[0].argumentsText, '{"q":"test"}');
  });

  test('returns empty text for null payload', () => {
    const result = extractChatCompletionResult(null);
    assert.equal(result.text, '');
    assert.equal(result.reasoning, undefined);
  });

  test('returns empty text for empty object', () => {
    const result = extractChatCompletionResult({});
    assert.equal(result.text, '');
  });
});

// ─── extractResponsesResult ─────────────────────────────────────────

describe('extractResponsesResult', () => {
  test('extracts output_text', () => {
    const result = extractResponsesResult({
      output_text: 'response text'
    });
    assert.equal(result.text, 'response text');
  });

  test('extracts from output array with message type', () => {
    const result = extractResponsesResult({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'hello' }]
      }]
    });
    assert.equal(result.text, 'hello');
  });

  test('returns empty for null', () => {
    const result = extractResponsesResult(null);
    assert.equal(result.text, '');
  });
});

// ─── extractChatCompletionsStreamDelta ───────────────────────────────

describe('extractChatCompletionsStreamDelta', () => {
  test('extracts text delta', () => {
    const delta = extractChatCompletionsStreamDelta({
      choices: [{ delta: { content: 'chunk' } }]
    });
    assert.equal(delta.textDelta, 'chunk');
    assert.equal(delta.reasoningDelta, '');
  });

  test('extracts reasoning delta', () => {
    const delta = extractChatCompletionsStreamDelta({
      choices: [{ delta: { reasoning_content: 'think' } }]
    });
    assert.equal(delta.reasoningDelta, 'think');
  });

  test('extracts from array content delta', () => {
    const delta = extractChatCompletionsStreamDelta({
      choices: [{
        delta: {
          content: [{ type: 'text', text: 'arr' }]
        }
      }]
    });
    assert.equal(delta.textDelta, 'arr');
  });

  test('returns empty for null', () => {
    const delta = extractChatCompletionsStreamDelta(null);
    assert.equal(delta.textDelta, '');
    assert.equal(delta.reasoningDelta, '');
  });

  test('returns empty for empty choices', () => {
    const delta = extractChatCompletionsStreamDelta({ choices: [] });
    assert.equal(delta.textDelta, '');
  });
});

// ─── extractResponsesStreamEvent ─────────────────────────────────────

describe('extractResponsesStreamEvent', () => {
  test('detects done event', () => {
    const event = extractResponsesStreamEvent({
      type: 'response.completed'
    });
    assert.equal(event.done, true);
  });

  test('extracts text delta', () => {
    const event = extractResponsesStreamEvent({
      type: 'response.output_text.delta',
      delta: 'text chunk'
    });
    assert.equal(event.done, false);
    assert.equal(event.textDelta, 'text chunk');
  });

  test('returns done=false for unknown event', () => {
    const event = extractResponsesStreamEvent({});
    assert.equal(event.done, false);
    assert.equal(event.textDelta, '');
  });
});

// ─── parseStandardModelList ─────────────────────────────────────────

describe('parseStandardModelList', () => {
  test('parses data array with id and name', () => {
    const models = parseStandardModelList({
      data: [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' }
      ]
    });
    assert.equal(models.length, 2);
    assert.equal(models[0].id, 'gpt-4o');
    assert.equal(models[0].name, 'GPT-4o');
  });

  test('uses id as name fallback', () => {
    const models = parseStandardModelList({
      data: [{ id: 'model-a' }]
    });
    assert.equal(models[0].name, 'model-a');
  });

  test('handles models array field', () => {
    const models = parseStandardModelList({
      models: [{ id: 'm1', name: 'Model 1' }]
    });
    assert.equal(models.length, 1);
    assert.equal(models[0].id, 'm1');
  });

  test('filters out entries without id', () => {
    const models = parseStandardModelList({
      data: [{ id: 'valid' }, { name: 'no-id' }]
    });
    assert.equal(models.length, 1);
  });

  test('returns empty for null', () => {
    const models = parseStandardModelList(null);
    assert.equal(models.length, 0);
  });
});

// ─── parseGeminiModels ──────────────────────────────────────────────

describe('parseGeminiModels', () => {
  test('strips models/ prefix', () => {
    const models = parseGeminiModels({
      models: [
        { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' }
      ]
    });
    assert.equal(models[0].id, 'gemini-1.5-pro');
    assert.equal(models[0].name, 'Gemini 1.5 Pro');
  });

  test('returns empty for null', () => {
    const models = parseGeminiModels(null);
    assert.equal(models.length, 0);
  });
});

// ─── parseOllamaModels ──────────────────────────────────────────────

describe('parseOllamaModels', () => {
  test('uses name field for id and name', () => {
    const models = parseOllamaModels({
      models: [{ name: 'llama3:latest' }]
    });
    assert.equal(models[0].id, 'llama3:latest');
    assert.equal(models[0].name, 'llama3:latest');
  });

  test('falls back to model field', () => {
    const models = parseOllamaModels({
      models: [{ model: 'mistral:7b' }]
    });
    assert.equal(models[0].id, 'mistral:7b');
  });

  test('returns empty for null', () => {
    const models = parseOllamaModels(null);
    assert.equal(models.length, 0);
  });
});
