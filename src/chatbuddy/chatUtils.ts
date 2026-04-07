import type { ChatMessage, ProviderMessage } from './types';

/**
 * Prepend the question prefix to content if not already present.
 */
export function applyQuestionPrefix(content: string, questionPrefix: string): string {
  const prefix = questionPrefix.trim();
  if (!prefix) {
    return content;
  }
  if (content.startsWith(prefix)) {
    return content;
  }
  const separator = /[:：]$/.test(prefix) ? '' : ' ';
  return `${prefix}${separator}${content}`;
}

/**
 * Convert chat messages to provider format, filtering system messages and
 * applying question prefixes.
 */
export function toProviderConversationMessages(questionPrefix: string, messages: ChatMessage[]): ProviderMessage[] {
  const result: ProviderMessage[] = [];
  for (const message of messages) {
    if (message.content.trim().length === 0 || message.role === 'system') {
      continue;
    }
    if (message.role === 'user') {
      result.push({
        role: 'user',
        content: applyQuestionPrefix(message.content, questionPrefix)
      });
      continue;
    }
    result.push({
      role: 'assistant',
      content: message.content
    });
  }
  return result;
}

/**
 * Build the full provider message array: optional system prompt + limited
 * conversation messages.
 */
export function toProviderMessages(
  systemPrompt: string,
  questionPrefix: string,
  messages: ChatMessage[],
  contextCount: number
): ProviderMessage[] {
  const normalizedSystemPrompt = systemPrompt.trim();
  const conversationMessages = toProviderConversationMessages(questionPrefix, messages);
  const normalizedContextCount = Number.isFinite(contextCount) && contextCount > 0 ? Math.floor(contextCount) : 0;
  const limitedMessages =
    normalizedContextCount === 0
      ? conversationMessages
      : conversationMessages.slice(-normalizedContextCount);

  return [
    ...(normalizedSystemPrompt
      ? [
          {
            role: 'system' as const,
            content: normalizedSystemPrompt
          }
        ]
      : []),
    ...limitedMessages
  ];
}

/**
 * Split `<think ...>...</think tagged content into content and reasoning parts.
 */
export function splitThinkTaggedContent(rawText: string): { content: string; reasoning: string } {
  if (!rawText || !/[<]/.test(rawText)) {
    return {
      content: rawText,
      reasoning: ''
    };
  }

  // Only treat as reasoning when the message starts with a think block.
  if (!/^\s*<think\b[^>]*>/i.test(rawText)) {
    return {
      content: rawText,
      reasoning: ''
    };
  }

  const tagPattern = /<think\b[^>]*>|<\/think>/gi;
  let thinkDepth = 0;
  let cursor = 0;
  let matchedThinkOpenTag = false;
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];

  for (const match of rawText.matchAll(tagPattern)) {
    const index = match.index ?? 0;
    const segment = rawText.slice(cursor, index);
    if (segment) {
      if (thinkDepth > 0) {
        reasoningParts.push(segment);
      } else {
        contentParts.push(segment);
      }
    }

    const tag = match[0].toLowerCase();
    if (tag.startsWith('</think')) {
      if (thinkDepth === 0) {
        return {
          content: rawText,
          reasoning: ''
        };
      }
      thinkDepth -= 1;
    } else {
      matchedThinkOpenTag = true;
      thinkDepth += 1;
    }
    cursor = index + match[0].length;
  }

  if (!matchedThinkOpenTag || thinkDepth !== 0) {
    return {
      content: rawText,
      reasoning: ''
    };
  }

  const tail = rawText.slice(cursor);
  if (tail) {
    if (thinkDepth > 0) {
      reasoningParts.push(tail);
    } else {
      contentParts.push(tail);
    }
  }

  return {
    content: contentParts.join(''),
    reasoning: reasoningParts.join('')
  };
}

/**
 * Merge multiple reasoning parts, stripping model-specific tool call XML.
 */
export function mergeReasoningParts(...parts: Array<string | undefined>): string | undefined {
  let merged = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .trim();
  // Strip model-specific tool call XML (e.g. <minimax:tool_call>...</minimax:tool_call>)
  merged = merged.replace(/<[a-zA-Z_-]+:tool_call>[\s\S]*?<\/[a-zA-Z_-]+:tool_call>/g, '').trim();
  return merged || undefined;
}
