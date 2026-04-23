/**
 * ToolCallOrchestrator 单元测试。
 *
 * 覆盖工具调用支持判断、结果应用、取消等核心逻辑。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ToolCallOrchestrator,
  resolveGenerationErrorMessage
} from '../chatbuddy/chatControllerToolOrchestrator';
import { ProviderChatResult } from '../chatbuddy/providerClient';

// ─── resolveGenerationErrorMessage (shared via this file too) ────────

function makeStrings(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    generationStopped: 'Generation stopped.',
    requestTimeout: 'Request timed out.',
    networkError: 'Network error occurred.',
    authFailed: 'Authentication failed.',
    rateLimitExceeded: 'Rate limit exceeded.',
    unknownError: 'Unknown error.',
    toolContinuationStoppedMessage: 'Tool calls stopped.',
    emptyResponse: 'Empty response.',
    ...overrides
  };
}

describe('resolveGenerationErrorMessage', () => {
  test('manual abort returns generationStopped', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('x'), 'manual', strings);
    assert.equal(result, strings.generationStopped);
  });

  test('timeout abort returns requestTimeout', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('x'), 'timeout', strings);
    assert.equal(result, strings.requestTimeout);
  });

  test('network error keywords trigger networkError', () => {
    const strings = makeStrings();
    assert.equal(
      resolveGenerationErrorMessage(new Error('fetch failed'), undefined, strings),
      strings.networkError
    );
    assert.equal(
      resolveGenerationErrorMessage(new Error('network unreachable'), undefined, strings),
      strings.networkError
    );
  });

  test('401 unauthorized triggers authFailed', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('401 Unauthorized'), undefined, strings);
    assert.equal(result, strings.authFailed);
  });

  test('429 rate limit triggers rateLimitExceeded', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('429 rate limit'), undefined, strings);
    assert.equal(result, strings.rateLimitExceeded);
  });

  test('timeout in message triggers requestTimeout', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('request timeout'), undefined, strings);
    assert.equal(result, strings.requestTimeout);
  });

  test('generic Error returns its message', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(new Error('boom'), undefined, strings);
    assert.equal(result, 'boom');
  });

  test('non-Error falls back to unknownError', () => {
    const strings = makeStrings();
    const result = resolveGenerationErrorMessage(undefined, undefined, strings);
    assert.equal(result, strings.unknownError);
  });
});

// ─── ToolCallOrchestrator.providerSupportsToolCalling ────────────────

describe('ToolCallOrchestrator.providerSupportsToolCalling', () => {
  function createOrchestrator(resolveOption?: ReturnType<typeof makeMockRepo>['resolveModelOption']) {
    const repository = makeMockRepo(resolveOption);
    return new ToolCallOrchestrator({
      repository: repository as any,
      providerClient: {} as any,
      mcpRuntime: {} as any,
      getLocale: () => 'en',
      getPendingToolContinuation: () => undefined,
      setPendingToolContinuation: () => undefined,
      isGenerating: () => false,
      setIsGenerating: () => undefined,
      getAbortController: () => undefined,
      setAbortController: () => undefined,
      getAbortReason: () => undefined,
      setAbortReason: () => undefined,
      stopGeneration: () => undefined,
      postError: () => undefined,
      postState: () => undefined,
      scheduleStreamStatePost: () => undefined,
      flushScheduledStreamStatePost: () => undefined
    });
  }

  function makeMockRepo(resolveOption?: (modelRef: string) => any) {
    return {
      resolveModelOption: resolveOption || (() => undefined)
    };
  }

  test('returns true when capability.tools is true', () => {
    const orchestrator = createOrchestrator(() => ({
      ref: 'p/m',
      providerId: 'p',
      providerName: 'P',
      modelId: 'm',
      label: 'M',
      capabilities: { tools: true }
    }));
    assert.equal(
      orchestrator.providerSupportsToolCalling('p/m', { apiType: 'other' as any, providerKind: 'custom' }),
      true
    );
  });

  test('returns false when capability.tools is false', () => {
    const orchestrator = createOrchestrator(() => ({
      ref: 'p/m',
      providerId: 'p',
      providerName: 'P',
      modelId: 'm',
      label: 'M',
      capabilities: { tools: false }
    }));
    assert.equal(
      orchestrator.providerSupportsToolCalling('p/m', { apiType: 'chat_completions', providerKind: 'custom' }),
      false
    );
  });

  test('falls back to apiType for chat_completions', () => {
    const orchestrator = createOrchestrator(() => undefined);
    assert.equal(
      orchestrator.providerSupportsToolCalling('p/m', { apiType: 'chat_completions', providerKind: 'custom' }),
      true
    );
  });

  test('falls back to apiType for responses', () => {
    const orchestrator = createOrchestrator(() => undefined);
    assert.equal(
      orchestrator.providerSupportsToolCalling('p/m', { apiType: 'responses', providerKind: 'openai' }),
      true
    );
  });

  test('returns false for unknown apiType when no option', () => {
    const orchestrator = createOrchestrator(() => undefined);
    assert.equal(
      orchestrator.providerSupportsToolCalling('p/m', { apiType: 'other' as any, providerKind: 'custom' }),
      false
    );
  });

  test('returns false for empty capabilities without matching apiType', () => {
    const orchestrator = createOrchestrator(() => ({
      ref: 'p/m',
      providerId: 'p',
      providerName: 'P',
      modelId: 'm',
      label: 'M',
      capabilities: {}
    }));
    assert.equal(
      orchestrator.providerSupportsToolCalling('p/m', { apiType: 'other' as any, providerKind: 'custom' }),
      false
    );
  });

  test('capabilities with vision but no tools falls back to apiType', () => {
    const orchestrator = createOrchestrator(() => ({
      ref: 'p/m',
      providerId: 'p',
      providerName: 'P',
      modelId: 'm',
      label: 'M',
      capabilities: { vision: true }
    }));
    assert.equal(
      orchestrator.providerSupportsToolCalling('p/m', { apiType: 'chat_completions', providerKind: 'custom' }),
      true
    );
  });
});

// ─── ToolCallOrchestrator.applyProviderResultToAssistantMessage ──────

describe('ToolCallOrchestrator.applyProviderResultToAssistantMessage', () => {
  function createOrchestrator() {
    const updates: Array<{ assistantId: string; sessionId: string; message: any }> = [];
    const repository = {
      updateLastAssistantMessage: (
        assistantId: string,
        sessionId: string,
        updater: (current: any) => any,
        _persist?: boolean
      ) => {
        const message = updater(undefined);
        updates.push({ assistantId, sessionId, message });
        return message;
      }
    };
    const orchestrator = new ToolCallOrchestrator({
      repository: repository as any,
      providerClient: {} as any,
      mcpRuntime: {} as any,
      getLocale: () => 'en',
      getPendingToolContinuation: () => undefined,
      setPendingToolContinuation: () => undefined,
      isGenerating: () => false,
      setIsGenerating: () => undefined,
      getAbortController: () => undefined,
      setAbortController: () => undefined,
      getAbortReason: () => undefined,
      setAbortReason: () => undefined,
      stopGeneration: () => undefined,
      postError: () => undefined,
      postState: () => undefined,
      scheduleStreamStatePost: () => undefined,
      flushScheduledStreamStatePost: () => undefined
    });
    return { orchestrator, updates };
  }

  test('applies text content to assistant message', () => {
    const { orchestrator, updates } = createOrchestrator();
    const result: ProviderChatResult = { text: 'Hello world' };
    orchestrator.applyProviderResultToAssistantMessage('a1', 's1', 'm1', result, 'gpt-4o');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].message.content, 'Hello world');
    assert.equal(updates[0].message.role, 'assistant');
    assert.equal(updates[0].message.model, 'gpt-4o');
  });

  test('uses fallback content when text is empty', () => {
    const { orchestrator, updates } = createOrchestrator();
    const result: ProviderChatResult = { text: '' };
    orchestrator.applyProviderResultToAssistantMessage('a1', 's1', 'm1', result, 'gpt-4o', {
      fallbackContent: 'No response'
    });
    assert.equal(updates[0].message.content, 'No response');
  });

  test('strips think tags from content', () => {
    const { orchestrator, updates } = createOrchestrator();
    const result: ProviderChatResult = { text: '<think>thinking...</think>answer' };
    orchestrator.applyProviderResultToAssistantMessage('a1', 's1', 'm1', result, 'gpt-4o');
    assert.equal(updates[0].message.content, 'answer');
    assert.equal(updates[0].message.reasoning, 'thinking...');
  });

  test('merges reasoning parts', () => {
    const { orchestrator, updates } = createOrchestrator();
    const result: ProviderChatResult = {
      text: '<think>tag thought</think>answer',
      reasoning: 'api reasoning'
    };
    orchestrator.applyProviderResultToAssistantMessage('a1', 's1', 'm1', result, 'gpt-4o');
    assert.equal(updates[0].message.reasoning, 'api reasoning\ntag thought');
  });

  test('preserves toolRounds in message', () => {
    const { orchestrator, updates } = createOrchestrator();
    const result: ProviderChatResult = { text: 'done' };
    const toolRounds = [{ reasoning: undefined, calls: [{ id: 'c1', name: 'search', argumentsText: '{}', output: 'results' }] }];
    orchestrator.applyProviderResultToAssistantMessage('a1', 's1', 'm1', result, 'gpt-4o', {
      toolRounds: toolRounds as any
    });
    assert.equal(updates[0].message.toolRounds, toolRounds);
  });

  test('trims content whitespace', () => {
    const { orchestrator, updates } = createOrchestrator();
    const result: ProviderChatResult = { text: '  hello  ' };
    orchestrator.applyProviderResultToAssistantMessage('a1', 's1', 'm1', result, 'gpt-4o');
    assert.equal(updates[0].message.content, 'hello');
  });

  test('uses emptyResponse fallback when no text and no fallback provided', () => {
    const { orchestrator, updates } = createOrchestrator();
    const result: ProviderChatResult = { text: '' };
    orchestrator.applyProviderResultToAssistantMessage('a1', 's1', 'm1', result, 'gpt-4o');
    // Should fallback to emptyResponse string (from getStrings('en').emptyResponse)
    assert.ok(updates[0].message.content);
  });
});

// ─── ToolCallOrchestrator.cancelPendingToolCalls ─────────────────────

describe('ToolCallOrchestrator.cancelPendingToolCalls', () => {
  function createOrchestrator(pending: any) {
    const updates: Array<any> = [];
    const repository = {
      updateLastAssistantMessage: (
        assistantId: string,
        sessionId: string,
        updater: (current: any) => any,
        _persist?: boolean
      ) => {
        const message = updater(undefined);
        updates.push({ assistantId, sessionId, message });
        return message;
      }
    };
    let pendingRef = pending;
    const orchestrator = new ToolCallOrchestrator({
      repository: repository as any,
      providerClient: {} as any,
      mcpRuntime: {} as any,
      getLocale: () => 'en',
      getPendingToolContinuation: () => pendingRef,
      setPendingToolContinuation: (p: any) => {
        pendingRef = p;
      },
      isGenerating: () => false,
      setIsGenerating: () => undefined,
      getAbortController: () => undefined,
      setAbortController: () => undefined,
      getAbortReason: () => undefined,
      setAbortReason: () => undefined,
      stopGeneration: () => undefined,
      postError: () => undefined,
      postState: () => undefined,
      scheduleStreamStatePost: () => undefined,
      flushScheduledStreamStatePost: () => undefined
    });
    return { orchestrator, updates, getPending: () => pendingRef };
  }

  test('clears pending continuation and applies stopped message', () => {
    const pending = {
      assistant: { id: 'a1', name: 'A' },
      sessionId: 's1',
      assistantMessageId: 'm1',
      result: { text: '' },
      providerConfig: { modelLabel: 'gpt-4o' },
      locale: 'en' as const
    };
    const { orchestrator, updates, getPending } = createOrchestrator(pending);
    orchestrator.cancelPendingToolCalls();
    assert.equal(getPending(), undefined);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].assistantId, 'a1');
    assert.equal(updates[0].sessionId, 's1');
  });

  test('no-op when no pending continuation', () => {
    const { orchestrator, updates, getPending } = createOrchestrator(undefined);
    orchestrator.cancelPendingToolCalls();
    assert.equal(getPending(), undefined);
    assert.equal(updates.length, 0);
  });
});
