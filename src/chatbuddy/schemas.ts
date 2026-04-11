import { z } from 'zod';

/**
 * Lightweight Zod schema for validating the top-level shape of persisted state.
 * Validates only the structural skeleton (required keys and their types),
 * delegating deep field sanitization to existing sanitizer functions.
 */
export const PersistedStateLiteSchema = z.object({
  groups: z.array(z.record(z.string(), z.unknown())),
  assistants: z.array(z.record(z.string(), z.unknown())),
  selectedAssistantId: z.string().optional(),
  selectedSessionIdByAssistant: z.record(z.string(), z.string()),
  sessionPanelCollapsed: z.boolean(),
  collapsedGroupIds: z.array(z.string()),
  settings: z.object({
    providers: z.array(z.record(z.string(), z.unknown())),
    defaultModels: z.record(z.string(), z.unknown()),
    mcp: z.record(z.string(), z.unknown()),
    temperature: z.number(),
    topP: z.number(),
    maxTokens: z.number(),
    presencePenalty: z.number(),
    frequencyPenalty: z.number(),
    timeoutMs: z.number(),
    streamingDefault: z.boolean(),
    locale: z.string(),
    sendShortcut: z.string(),
    chatTabMode: z.string()
  })
});
