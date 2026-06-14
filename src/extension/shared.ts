/**
 * 扩展命令层共享类型与工具模块。
 *
 * 定义 `ExtensionContext` 接口（命令注册函数共享的依赖上下文），
 * 以及会话导出等辅助函数。
 */
import { ChatController } from '../chatbuddy/chatController';
import { AssistantEditorPanelController } from '../chatbuddy/assistantEditorPanel';
import { SettingsCenterPanelController } from '../chatbuddy/settingsCenterPanel';
import { escapeHtml, resolveLocaleString, warn } from '../chatbuddy/utils';
import { ChatStateRepository } from '../chatbuddy/stateRepository';
import { ChatSessionDetail } from '../chatbuddy/types';
import type { ActivationSidebarViewProviders } from './activationTypes';

export type ExtensionContext = {
  repository: ChatStateRepository;
  chatController: ChatController;
  settingsCenterPanelController: SettingsCenterPanelController;
  assistantEditorPanelController: AssistantEditorPanelController;
  sidebarViewProviders: ActivationSidebarViewProviders;
  refreshAll: () => void;
  getRuntimeLocale: () => string;
  getRuntimeStrings: () => Record<string, string>;
};

export type SessionExportFormat = 'json' | 'markdown' | 'html';

// ─── Export helpers ───────────────────────────────────────────────────────────

function sanitizeFileNameSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) { return fallback; }
  return normalized.slice(0, 80);
}

export function buildBackupFileName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `chatbuddy-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`;
}

export function buildSessionExportFileName(sessionTitle: string, extension: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const title = sanitizeFileNameSegment(sessionTitle, 'session');
  return `${title}-${stamp}.${extension}`;
}

function formatMessageTime(timestamp: number, locale: string): string {
  const targetLocale = resolveLocaleString(locale, 'zh-CN', 'en-US');
  try {
    return new Date(timestamp).toLocaleString(targetLocale);
  } catch (err) {
    warn('Error formatting message time:', err);
    return new Date(timestamp).toISOString();
  }
}

function resolveMessageRoleLabel(
  role: 'system' | 'user' | 'assistant',
  assistantName: string,
  strings: Record<string, string>
): string {
  if (role === 'assistant') { return assistantName; }
  if (role === 'user') { return strings.userRole; }
  return strings.systemRole;
}

function buildSessionMarkdownExport(
  session: ChatSessionDetail,
  assistantName: string,
  locale: string,
  strings: Record<string, string>
): string {
  const lines: string[] = [];
  lines.push(`# ${session.title?.trim() || strings.untitledSession}`);
  lines.push('');
  lines.push(`- ${strings.assistantRole}: ${assistantName}`);
  lines.push(`- ${strings.exportGeneratedAtLabel}: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');

  for (const message of session.messages) {
    const roleLabel = resolveMessageRoleLabel(message.role, assistantName, strings);
    const timestamp = formatMessageTime(message.timestamp, locale);
    const modelSuffix = message.model?.trim() ? ` · ${message.model.trim()}` : '';
    lines.push('');
    lines.push(`## ${roleLabel} · ${timestamp}${modelSuffix}`);
    lines.push('');
    lines.push(message.content || '');
    const reasoning = message.reasoning?.trim();
    if (reasoning) {
      lines.push('');
      lines.push(`<details><summary>${strings.reasoningSectionTitle}</summary>`);
      lines.push('');
      lines.push(reasoning);
      lines.push('');
      lines.push('</details>');
    }
  }
  lines.push('');
  return lines.join('\n');
}

function buildSessionHtmlExport(
  session: ChatSessionDetail,
  assistantName: string,
  locale: string,
  strings: Record<string, string>
): string {
  const title = escapeHtml(session.title?.trim() || strings.untitledSession);
  const exportedAt = escapeHtml(new Date().toISOString());
  const assistant = escapeHtml(assistantName);
  const messageBlocks = session.messages
    .map((message) => {
      const roleLabel = escapeHtml(resolveMessageRoleLabel(message.role, assistantName, strings));
      const timestamp = escapeHtml(formatMessageTime(message.timestamp, locale));
      const model = message.model?.trim() ? ` · ${escapeHtml(message.model.trim())}` : '';
      const content = escapeHtml(message.content || '').replace(/\n/g, '<br/>');
      const reasoning = message.reasoning?.trim()
        ? `<details><summary>${escapeHtml(strings.reasoningSectionTitle)}</summary><pre>${escapeHtml(message.reasoning.trim())}</pre></details>`
        : '';
      return `
        <article class="message message-${message.role}">
          <header>${roleLabel} · ${timestamp}${model}</header>
          <div class="content">${content}</div>
          ${reasoning}
        </article>
      `;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${resolveLocaleString(locale, 'zh-CN', 'en')}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px auto; max-width: 920px; padding: 0 16px; line-height: 1.6; color: #1f2328; }
      h1 { margin-bottom: 8px; }
      .meta { color: #57606a; margin-bottom: 20px; }
      .message { border: 1px solid #d0d7de; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
      .message header { font-size: 12px; color: #57606a; margin-bottom: 8px; }
      .message pre { white-space: pre-wrap; background: #f6f8fa; border-radius: 8px; padding: 10px; overflow: auto; }
      .message-user { background: #f6f8fa; }
      details summary { cursor: pointer; color: #57606a; font-size: 12px; margin-top: 8px; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <div class="meta">${escapeHtml(strings.assistantRole)}: ${assistant} · ${escapeHtml(strings.exportGeneratedAtLabel)}: ${exportedAt}</div>
    ${messageBlocks}
  </body>
</html>`;
}

export function buildSessionExportContent(
  format: SessionExportFormat,
  session: ChatSessionDetail,
  assistant: { id: string; name: string },
  locale: string,
  strings: Record<string, string>
): string {
  if (format === 'json') {
    return JSON.stringify(
      { schema: 'chatbuddy.session-export', version: 1, exportedAt: new Date().toISOString(), locale, assistant, session },
      null,
      2
    );
  }
  if (format === 'markdown') {
    return buildSessionMarkdownExport(session, assistant.name, locale, strings);
  }
  return buildSessionHtmlExport(session, assistant.name, locale, strings);
}
