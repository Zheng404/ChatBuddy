import { mergeReasoningParts, splitThinkTaggedContent } from './chatUtils';
import { ChatStateRepository } from './stateRepository';
import { nowTs } from './utils/id';
import type { ChatToolRound, RuntimeStrings } from './types';

export const STREAM_FLUSH_INTERVAL_MS = 100;
export const STREAM_STATE_POST_INTERVAL_MS = 150;

/** Shared state for incremental stream accumulation and throttled flush. */
export type StreamAccumulator = {
  rawMerged: string;
  rawPersisted: string;
  reasoningMerged: string;
  reasoningPersisted: string;
  flushTimer: ReturnType<typeof setTimeout> | undefined;
};

/** Parameters that vary between sendMessage and streamFinalResponse. */
export type StreamFlushParams = {
  assistantId: string;
  sessionId: string;
  fallbackMessageId: string;
  modelLabel: string;
  toolRounds?: ChatToolRound[];
  /** Opaque context passed through to the notify callback; not used by the accumulator itself. */
  context?: unknown;
};

export function createStreamAccumulator(): StreamAccumulator {
  return {
    rawMerged: '',
    rawPersisted: '',
    reasoningMerged: '',
    reasoningPersisted: '',
    flushTimer: undefined
  };
}

/**
 * Build a flush callback that parses think-tagged content, merges reasoning,
 * persists the assistant message, and notifies the webview.
 */
export function buildStreamFlush(
  acc: StreamAccumulator,
  params: StreamFlushParams,
  repository: ChatStateRepository,
  strings: RuntimeStrings,
  notifyState?: (persist: boolean) => void
): (persist: boolean) => void {
  return (persist: boolean) => {
    const thinkSplit = splitThinkTaggedContent(acc.rawMerged);
    const contentValue = thinkSplit.content.trim() || strings.emptyResponse;
    const reasoningValue = mergeReasoningParts(acc.reasoningMerged, thinkSplit.reasoning);
    repository.updateLastAssistantMessage(
      params.assistantId,
      params.sessionId,
      (current) => ({
        id: current?.id ?? params.fallbackMessageId,
        role: 'assistant',
        content: contentValue,
        timestamp: nowTs(),
        model: params.modelLabel,
        reasoning: reasoningValue,
        ...(params.toolRounds ? { toolRounds: params.toolRounds } : {})
      }),
      persist
    );
    acc.rawPersisted = acc.rawMerged;
    acc.reasoningPersisted = acc.reasoningMerged;
    notifyState?.(persist);
  };
}

/**
 * Schedule a throttled flush. Only one timer runs at a time; re-entrant calls are no-ops.
 */
export function scheduleStreamFlush(acc: StreamAccumulator, flush: (persist: boolean) => void): void {
  if (acc.flushTimer) { return; }
  acc.flushTimer = setTimeout(() => {
    acc.flushTimer = undefined;
    if (acc.rawMerged !== acc.rawPersisted || acc.reasoningMerged !== acc.reasoningPersisted) {
      flush(false);
    }
  }, STREAM_FLUSH_INTERVAL_MS);
}

/** Cancel a pending flush timer if one exists. */
export function clearStreamFlush(acc: StreamAccumulator): void {
  if (acc.flushTimer) {
    clearTimeout(acc.flushTimer);
    acc.flushTimer = undefined;
  }
}

/**
 * Build stream callbacks (onDelta, onReasoningDelta, onDone) that feed into an accumulator.
 */
export function buildStreamCallbacks(
  acc: StreamAccumulator,
  flush: (persist: boolean) => void
): { onDelta: (delta: string) => void; onReasoningDelta: (delta: string) => void; onDone: () => void } {
  return {
    onDelta: (delta) => {
      acc.rawMerged += delta;
      scheduleStreamFlush(acc, flush);
    },
    onReasoningDelta: (delta) => {
      acc.reasoningMerged += delta;
      scheduleStreamFlush(acc, flush);
    },
    onDone: () => {
      clearStreamFlush(acc);
      flush(true);
    }
  };
}

/** Build a partial-error message from the current accumulated stream content. */
export function buildStreamErrorContent(
  acc: StreamAccumulator,
  userFacingError: string
): { content: string; reasoning?: string } {
  const partialSplit = splitThinkTaggedContent(acc.rawMerged);
  const partial = partialSplit.content.trim();
  const reasoningPartial = mergeReasoningParts(acc.reasoningMerged, partialSplit.reasoning);
  return {
    content: partial ? `${partial}\n\n${userFacingError}` : userFacingError,
    reasoning: reasoningPartial || undefined
  };
}
