/**
 * 助手编辑器类型定义、常量与工具函数。
 *
 * 从 assistantEditorPanel 中提取的类型、头像常量及纯函数。
 */
import * as fs from 'fs';
import * as path from 'path';

import { DEFAULT_GROUP_ID, DELETED_GROUP_ID, isLegacyDefaultGroupName } from './constants';
import { getCodiconRootUri } from './codicon';
import { ChatStateRepository, UpdateAssistantInput } from './stateRepository';
import type { AssistantGroup, AssistantProfile, McpServerSummary, ProviderModelOption, RuntimeStrings } from './types';
import { clamp } from './utils';

// ─── 类型定义 ────────────────────────────────────────────────────────

export type AssistantEditorMessage =
  | { type: 'ready' }
  | {
      type: 'pickAvatar';
      currentAvatar?: string;
    }
  | {
      type: 'save';
      payload: AssistantEditorPayload;
    };

export type AssistantEditorPayload = {
  name: string;
  note: string;
  avatar: string;
  greeting: string;
  systemPrompt: string;
  questionPrefix: string;
  groupId: string;
  modelRef: string;
  streaming: boolean;
  enabledMcpServerIds: string[];
  temperature: number;
  topP: number;
  maxTokens: number;
  contextCount: number;
  presencePenalty: number;
  frequencyPenalty: number;
};

export type AssistantEditorState = {
  strings: RuntimeStrings;
  assistant: AssistantProfile;
  groups: AssistantGroup[];
  models: ReadonlyArray<ProviderModelOption>;
  mcpServers: ReadonlyArray<McpServerSummary>;
  notice?: string;
};

// ─── 头像图标常量 ────────────────────────────────────────────────────

const AVATAR_ICON_OPTIONS: ReadonlyArray<string> = [
  'account',
  'add',
  'archive',
  'arrow-right',
  'beaker',
  'bell',
  'book',
  'bookmark',
  'briefcase',
  'bug',
  'calendar',
  'check',
  'checklist',
  'chip',
  'clock',
  'cloud',
  'code',
  'comment',
  'copilot',
  'database',
  'debug-alt',
  'device-camera',
  'edit',
  'eye',
  'file',
  'flame',
  'gear',
  'git-branch',
  'globe',
  'heart',
  'history',
  'home',
  'info',
  'key',
  'layers',
  'lightbulb',
  'link',
  'list-tree',
  'lock',
  'mail',
  'megaphone',
  'mention',
  'mic',
  'notebook',
  'paintcan',
  'pencil',
  'person',
  'plug',
  'pulse',
  'question',
  'rocket',
  'search',
  'send',
  'server',
  'shield',
  'sparkle',
  'star-full',
  'symbol-color',
  'terminal',
  'tools',
  'wand',
  'zap'
];

let cachedAvailableAvatarIcons: ReadonlyArray<string> | undefined;

export function getAvailableAvatarIcons(): ReadonlyArray<string> {
  if (cachedAvailableAvatarIcons) {
    return cachedAvailableAvatarIcons;
  }
  try {
    const codiconCssPath = path.join(getCodiconRootUri().fsPath, 'codicon.css');
    const cssContent = fs.readFileSync(codiconCssPath, 'utf8');
    const available = AVATAR_ICON_OPTIONS.filter((icon) => cssContent.includes(`.codicon-${icon}:before`));
    cachedAvailableAvatarIcons = available.length > 0 ? available : AVATAR_ICON_OPTIONS;
  } catch {
    cachedAvailableAvatarIcons = AVATAR_ICON_OPTIONS;
  }
  return cachedAvailableAvatarIcons;
}

// ─── 工具函数 ────────────────────────────────────────────────────────

export function toUpdatePayload(input: AssistantEditorPayload, fallback: AssistantProfile): UpdateAssistantInput {
  return {
    name: input.name.trim() || fallback.name,
    note: input.note,
    avatar: input.avatar.trim(),
    greeting: input.greeting,
    systemPrompt: input.systemPrompt,
    questionPrefix: input.questionPrefix,
    groupId: input.groupId,
    modelRef: input.modelRef.trim() || fallback.modelRef,
    streaming: input.streaming,
    enabledMcpServerIds: Array.isArray(input.enabledMcpServerIds) ? [...new Set(input.enabledMcpServerIds)] : [],
    temperature: clamp(input.temperature, 0, 2, fallback.temperature),
    topP: clamp(input.topP, 0, 1, fallback.topP),
    maxTokens: clamp(input.maxTokens, 0, 65535, fallback.maxTokens),
    contextCount: clamp(input.contextCount, 0, Number.MAX_SAFE_INTEGER, fallback.contextCount),
    presencePenalty: clamp(input.presencePenalty, -2, 2, fallback.presencePenalty),
    frequencyPenalty: clamp(input.frequencyPenalty, -2, 2, fallback.frequencyPenalty)
  };
}

export function buildEditorGroups(
  repository: ChatStateRepository,
  assistant: AssistantProfile,
  strings: RuntimeStrings
): AssistantGroup[] {
  return repository
    .getGroups()
    .filter((group) => group.kind !== 'deleted' || group.id === assistant.groupId)
    .map((group) => ({
      ...group,
      name:
        group.id === DEFAULT_GROUP_ID
          ? !group.name.trim() || (group.updatedAt === group.createdAt && isLegacyDefaultGroupName(group.name))
            ? strings.defaultGroupName
            : group.name
          : group.id === DELETED_GROUP_ID
            ? strings.deletedGroupName
            : group.name
    }));
}
