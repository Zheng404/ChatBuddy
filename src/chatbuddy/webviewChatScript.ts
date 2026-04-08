import { getToastScript } from './webviewShared';
import { getHtmlEscaperScript } from './utils/html';

/**
 * Returns the <script> tag for the chat webview panel.
 * Contains all client-side JavaScript for message rendering,
 * composer interaction, and VS Code extension communication.
 */
export function getChatScript(nonce: string): string {
  return `
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();

      const icons = {
        send: '<span class="codicon codicon-send"></span>',
        stop: '<span class="codicon codicon-debug-stop"></span>',
        regenerateReply: '<span class="codicon codicon-refresh"></span>',
        regenerateFrom: '<span class="codicon codicon-debug-restart"></span>',
        edit: '<span class="codicon codicon-edit"></span>',
        copy: '<span class="codicon codicon-copy"></span>',
        delete: '<span class="codicon codicon-trash"></span>',
        rawText: '<span class="codicon codicon-code"></span>',
        tool: '<span class="codicon codicon-tools"></span>'
      };

      const dom = {
        content: document.getElementById('content'),
        messages: document.getElementById('messages'),
        messagesInner: document.getElementById('messagesInner'),
        composerResizer: document.getElementById('composerResizer'),
        composerInput: document.getElementById('composerInput'),
        sendBtn: document.getElementById('sendBtn'),
        stopBtn: document.getElementById('stopBtn'),
        clearBtn: document.getElementById('clearBtn'),
        tempModelSelect: document.getElementById('tempModelSelect'),
        tempModelChip: document.getElementById('tempModelChip'),
        streamingToggle: document.getElementById('streamingToggle'),
        streamingLabel: document.getElementById('streamingLabel'),
        toastStack: document.getElementById('toastStack'),
        rawModalOverlay: document.getElementById('rawModalOverlay'),
        rawModalTitle: document.getElementById('rawModalTitle'),
        rawModalClose: document.getElementById('rawModalClose'),
        rawModalBody: document.getElementById('rawModalBody'),
        toolContinuationOverlay: document.getElementById('toolContinuationOverlay'),
        toolContinuationTitle: document.getElementById('toolContinuationTitle'),
        toolContinuationDescription: document.getElementById('toolContinuationDescription'),
        toolContinuationCancelBtn: document.getElementById('toolContinuationCancelBtn'),
        toolContinuationContinueBtn: document.getElementById('toolContinuationContinueBtn')
      };

      let state = {
        locale: 'en',
        strings: {},
        assistants: [],
        selectedAssistant: undefined,
        selectedAssistantId: undefined,
        sessions: [],
        selectedSessionId: undefined,
        selectedSession: undefined,
        sessionPanelCollapsed: false,
        providerLabel: '-',
        modelLabel: '-',
        modelOptions: [],
        mcpServers: [],
        sessionTempModelRef: '',
        sendShortcut: 'enter',
        streaming: true,
        isGenerating: false,
        canChat: false,
        awaitingToolContinuation: false,
        pendingToolCallCount: 0,
        toolRoundLimit: 0,
        readOnlyReason: ''
      };
      const renderSigs = {
        messages: '',
        composer: ''
      };
      let lastStateError = '';
      const COMPOSER_MIN_HEIGHT = 100;
      const COMPOSER_MAX_HEIGHT = 340;
      let isResizingComposer = false;
      let composerResizeStartY = 0;
      let composerResizeStartHeight = 0;
      let toolContinuationActionPending = false;
      let editingMessageId = '';
      let editingSessionId = '';

      function clearMessageEditState(clearInput) {
        editingMessageId = '';
        editingSessionId = '';
        if (clearInput) {
          dom.composerInput.value = '';
        }
      }

      function syncMessageEditState() {
        if (!editingMessageId) {
          return false;
        }
        if (!state.selectedSession || state.selectedSession.id !== editingSessionId) {
          clearMessageEditState(true);
          return true;
        }
        const exists = (state.selectedSession.messages || []).some((message) => message.id === editingMessageId);
        if (exists) {
          return false;
        }
        clearMessageEditState(true);
        return true;
      }

      function clampComposerHeight(value) {
        return Math.max(COMPOSER_MIN_HEIGHT, Math.min(COMPOSER_MAX_HEIGHT, Math.round(value)));
      }

${getToastScript()}
${getHtmlEscaperScript()}

      function decodeHtmlEntities(input) {
        return String(input || '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#0*39;/g, "'");
      }

      function formatTemplate(template, values) {
        return String(template || '').replace(/\\{(\\w+)\\}/g, (_, key) => values[key] || '');
      }

      function normalizeCodicon(icon) {
        const raw = String(icon || '').trim().toLowerCase();
        if (!raw || !/^[a-z0-9-]+$/.test(raw)) {
          return 'account';
        }
        return raw;
      }

      function codiconMarkup(icon) {
        const normalized = normalizeCodicon(icon);
        return '<span class="codicon codicon-' + escapeHtml(normalized) + '"></span>';
      }

      function formatDate(ts) {
        try {
          const locale = state.locale === 'zh-CN' ? 'zh-CN' : 'en-US';
          return new Intl.DateTimeFormat(locale, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }).format(new Date(ts));
        } catch {
          return '';
        }
      }

      function markdownToHtml(input) {
        const source = String(input || '');
        const codeBlocks = [];
        const codeBlockPattern = new RegExp('[\\\\x60]{3}([a-zA-Z0-9_-]*)\\\\n([\\\\s\\\\S]*?)[\\\\x60]{3}', 'g');
        let escaped = escapeHtml(source).replace(codeBlockPattern, (_, lang, code) => {
          const cls = lang ? ' class="lang-' + lang + '"' : '';
          const marker = '@@CODE_BLOCK_' + codeBlocks.length + '@@';
          codeBlocks.push('<pre><code' + cls + '>' + code + '</code></pre>');
          return marker;
        });

        const toSafeHref = (raw, allowDataImage, allowDataVideo) => {
          const value = decodeHtmlEntities(raw).trim();
          if (!value) {
            return '';
          }
          if (allowDataImage && /^data:image\\/[a-z0-9.+-]+;base64,[a-z0-9+/=\\s]+$/i.test(value)) {
            return value.replace(/\\s+/g, '');
          }
          if (allowDataVideo && /^data:video\\/[a-z0-9.+-]+;base64,[a-z0-9+/=\\s]+$/i.test(value)) {
            return value.replace(/\\s+/g, '');
          }
          let parsed;
          try {
            parsed = new URL(value);
          } catch {
            return '';
          }
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return '';
          }
          return parsed.toString();
        };

        escaped = escaped.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, (full, alt, rawUrl) => {
          const mediaType = String(alt || '').trim().toLowerCase();
          const altText = decodeHtmlEntities(alt).trim();
          if (mediaType === 'video') {
            const safeUrl = toSafeHref(rawUrl, false, true);
            if (!safeUrl) {
              return full;
            }
            return '<video controls preload="metadata" src="' + escapeHtmlAttr(safeUrl) + '"></video>';
          }
          const safeUrl = toSafeHref(rawUrl, true, false);
          if (!safeUrl) {
            return full;
          }
          return (
            '<img src="' +
            escapeHtmlAttr(safeUrl) +
            '" alt="' +
            escapeHtmlAttr(altText) +
            '" loading="lazy" />'
          );
        });

        escaped = escaped.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, (full, label, rawUrl) => {
          const safeUrl = toSafeHref(rawUrl, false, false);
          if (!safeUrl) {
            return full;
          }
          return (
            '<a href="' +
            escapeHtmlAttr(safeUrl) +
            '" target="_blank" rel="noopener noreferrer">' +
            label +
            '</a>'
          );
        });

        // ---- Markdown inline / block extensions ----
        // Headings
        escaped = escaped.replace(/^(#{1,6})\\s+(.+)$/gm, (m, hashes, txt) => {
          const lv = hashes.length;
          return '<h' + lv + '>' + txt + '</h' + lv + '>';
        });
        // Bold
        escaped = escaped.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        // Italic
        escaped = escaped.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
        // Strikethrough
        escaped = escaped.replace(/~~(.+?)~~/g, '<del>$1</del>');

        // Paragraph breaks (double newline) → spacer; single newline → line break
        escaped = escaped.replace(/\\n\\n/g, '@@PARA@@');
        escaped = escaped.replace(/\\n/g, '<br/>');
        escaped = escaped.replace(/@@PARA@@/g, '<br/>');

        // Restore code block placeholders
        escaped = escaped.replace(/@@CODE_BLOCK_(\\d+)@@/g, (_, index) => {
          const value = codeBlocks[Number(index)];
          return typeof value === 'string' ? value : '';
        });

        // Remove <br/> directly before/after block-level elements to prevent extra spacing
        escaped = escaped.replace(/<br\\/>\\s*<(h[1-6]|pre|div|ul|ol|li|blockquote|table|hr)/g, '<$1');
        escaped = escaped.replace(/<\\/(h[1-6]|pre|div|ul|ol|li|blockquote|table|hr)>\\s*<br\\/>/g, '</$1>');

        return escaped;
      }

      function getSelectedAssistantAvatar() {
        return normalizeCodicon(state.selectedAssistant?.avatar || 'account');
      }

      function messageDigest(message) {
        if (!message) {
          return '';
        }
        const content = String(message.content || '');
        const reasoning = String(message.reasoning || '');
        const toolRoundsDigest = Array.isArray(message.toolRounds)
          ? String(message.toolRounds.length) + ':' + message.toolRounds.map(function(r) {
              return String((r.calls || []).length) + '|' + (r.calls || []).map(function(c) { return c.name || ''; }).join(',');
            }).join(';')
          : '';
        return [
          String(message.id || ''),
          String(message.role || ''),
          String(content.length),
          content.slice(-80),
          String(reasoning.length),
          reasoning.slice(-80),
          String(message.timestamp || ''),
          String(message.model || ''),
          toolRoundsDigest
        ].join('~');
      }

      function buildMessagesSignature() {
        const current = state.selectedSession?.messages ?? [];
        const selectedAssistantName = String(state.selectedAssistant?.name || '').trim();
        return [
          String(state.locale || ''),
          String(state.selectedAssistantId || ''),
          selectedAssistantName,
          String(state.selectedSessionId || ''),
          String(state.selectedSession?.updatedAt || ''),
          state.canChat ? '1' : '0',
          String(state.readOnlyReason || ''),
          String(state.strings.emptyStateTitle || ''),
          String(state.strings.emptyStateBody || ''),
          String(state.strings.noAssistantSelectedTitle || ''),
          String(state.strings.noAssistantSelectedBody || ''),
          String(state.strings.userRole || ''),
          String(state.strings.assistantRole || ''),
          String(state.strings.systemRole || ''),
          String(state.strings.regenerateReplyAction || ''),
          String(state.strings.regenerateFromMessageAction || ''),
          String(state.strings.copyMessageAction || ''),
          String(state.strings.deleteMessageAction || ''),
          String(state.strings.reasoningSectionTitle || ''),
          String(current.length),
          messageDigest(current[current.length - 1])
        ].join('|');
      }

      function buildComposerSignature() {
        const modelOptionsDigest = (state.modelOptions || [])
          .map((option) => option.ref + '~' + option.label + '~' + JSON.stringify(option.capabilities || {}))
          .join('^');
        const isEditingMessage = !!editingMessageId;
        return [
          isEditingMessage ? '1' : '0',
          editingMessageId,
          state.canChat ? '1' : '0',
          state.isGenerating ? '1' : '0',
          state.streaming ? '1' : '0',
          String(state.readOnlyReason || ''),
          String(state.providerLabel || ''),
          String(state.modelLabel || ''),
          String(state.sessionTempModelRef || ''),
          String(state.sendShortcut || ''),
          modelOptionsDigest,
          String(state.strings.composerPlaceholder || ''),
          String(state.strings.send || ''),
          String(state.strings.stop || ''),
          String(state.strings.streaming || ''),
          String(state.strings.sendShortcutEnter || ''),
          String(state.strings.sendShortcutCtrlEnter || ''),
          String(state.strings.provider || ''),
          String(state.strings.model || ''),
          String(state.strings.chatModelFollowAssistant || ''),
          String(state.strings.chatTemporaryModelLabel || ''),
          String(state.strings.mcpResourcesAction || ''),
          String(state.strings.mcpPromptsAction || ''),
          String((state.mcpServers || []).length),
          String(state.strings.noAssistantSelectedBody || '')
        ].join('|');
      }

      function getCurrentSendShortcutText() {
        return state.sendShortcut === 'ctrlEnter'
          ? String(state.strings.sendShortcutCtrlEnter || '')
          : String(state.strings.sendShortcutEnter || '');
      }

      function renderToolContinuationModal() {
        const shouldShow = !!state.awaitingToolContinuation;
        if (!shouldShow) {
          dom.toolContinuationOverlay.classList.remove('visible');
          toolContinuationActionPending = false;
          return;
        }

        dom.toolContinuationTitle.textContent = state.strings.toolContinuationTitle || 'Continue Tool Calls';
        dom.toolContinuationDescription.textContent = formatTemplate(
          state.strings.toolContinuationDescription ||
            'Auto tool-call limit reached ({limit} rounds). {count} tool calls are waiting to continue.',
          {
            limit: String(state.toolRoundLimit || 0),
            count: String(state.pendingToolCallCount || 0)
          }
        );
        dom.toolContinuationCancelBtn.textContent = state.strings.toolContinuationStopAction || 'Stop';
        dom.toolContinuationContinueBtn.textContent = state.strings.toolContinuationContinueAction || 'Continue';
        dom.toolContinuationCancelBtn.disabled = toolContinuationActionPending;
        dom.toolContinuationContinueBtn.disabled = toolContinuationActionPending;
        dom.toolContinuationOverlay.classList.add('visible');
      }

      function renderEmptyState() {
        const title = state.selectedAssistantId
          ? state.strings.emptyStateTitle
          : (state.strings.noAssistantSelectedTitle || state.strings.emptyStateTitle);
        const body = state.selectedAssistantId
          ? state.strings.emptyStateBody
          : (state.strings.noAssistantSelectedBody || state.strings.emptyStateBody);
        dom.messagesInner.innerHTML = '' +
          '<div class="empty-state">' +
            '<div class="empty-card">' +
              '<div class="assistant-badge">' + codiconMarkup(getSelectedAssistantAvatar()) + '</div>' +
              '<div class="empty-title">' + escapeHtml(title) + '</div>' +
              '<div class="empty-copy">' + escapeHtml(body) + '</div>' +
            '</div>' +
          '</div>';
      }

      function renderMessages() {
        const current = state.selectedSession?.messages ?? [];
        if (!current.length) {
          renderEmptyState();
          return;
        }

        const latestAssistantId = [...current].reverse().find((item) => item.role === 'assistant')?.id || '';
        const assistantDisplayName = String(state.selectedAssistant?.name || '').trim() || state.strings.assistantRole;
        const isGenerating = state.isGenerating;
        const lastMsg = current[current.length - 1];

        dom.messagesInner.innerHTML = current.map((message) => {
          // Only show cursor on the last message when it's an assistant message and still generating
          const showCursor = isGenerating && lastMsg && lastMsg.role === 'assistant' && message.id === lastMsg.id;
          const role =
            message.role === 'user'
              ? state.strings.userRole
              : message.role === 'assistant'
                ? assistantDisplayName
                : state.strings.systemRole;
          const rowClass = message.role === 'user' ? 'message-row user' : 'message-row';
          const avatarNode =
            message.role === 'assistant'
              ? '<div class="message-avatar">' + codiconMarkup(getSelectedAssistantAvatar()) + '</div>'
              : message.role === 'system'
                ? '<div class="message-avatar">' + codiconMarkup('settings-gear') + '</div>'
                : '';
          const modelText = String(message.model || '').trim();
          const shouldShowModel = !!modelText && !/^[^:\\s]+:[^:\\s]+$/.test(modelText);
          const metaExtra = shouldShowModel ? ' · ' + escapeHtml(modelText) : '';
          const reasoningText = String(message.reasoning || '').trim();
          const toolRounds = (message.role === 'assistant' && Array.isArray(message.toolRounds) && message.toolRounds.length > 0)
            ? message.toolRounds
            : undefined;
          // Pre-tool reasoning: each round's thinking before calling tools (flat, above Tool Calls)
          const preToolReasoning = (function() {
            if (!toolRounds) { return ''; }
            var parts = [];
            for (var ri = 0; ri < toolRounds.length; ri++) {
              if (toolRounds[ri].reasoning) {
                parts.push('<details class="reasoning-block">' +
                  '<summary>' + escapeHtml(state.strings.reasoningSectionTitle || '') + '</summary>' +
                  '<div class="reasoning-content">' + markdownToHtml(toolRounds[ri].reasoning) + '</div>' +
                '</details>');
              }
            }
            return parts.join('');
          })();
          // Tool calls block (flat, no reasoning inside)
          const toolRoundsBlock = toolRounds
            ? (function() {
                const header = state.strings.toolCallRoundHeader || 'Tool Calls (Round {round})';
                var parts = [];
                for (let ri = 0; ri < toolRounds.length; ri++) {
                  const round = toolRounds[ri];
                  if (ri > 0) {
                    parts.push('<hr class="tool-round-separator">');
                  }
                  parts.push('<div class="tool-call-name">' + escapeHtml(header.replace('{round}', String(ri + 1))) + '</div>');
                  for (const call of round.calls || []) {
                    parts.push('<div class="tool-round-item">');
                    parts.push('<div><span class="tool-call-name">' + icons.tool + ' ' + escapeHtml(call.name || '') + '</span></div>');
                    if (call.argumentsText) {
                      parts.push('<div class="tool-call-args">' + escapeHtml(call.argumentsText) + '</div>');
                    }
                    if (call.output) {
                      parts.push('<div class="tool-call-output">' + escapeHtml(call.output) + '</div>');
                    }
                    parts.push('</div>');
                  }
                }
                return '<details class="tool-rounds-block">' +
                  '<summary>' + escapeHtml(state.strings.toolCallSectionTitle || 'Tool Calls') + ' (' + toolRounds.length + ')</summary>' +
                  '<div class="tool-rounds-content">' + parts.join('') + '</div>' +
                '</details>';
              })()
            : '';
          // Post-tool reasoning: final thinking after all tools (flat, below Tool Calls)
          const postToolReasoning = (toolRounds && reasoningText)
            ? '<details class="reasoning-block">' +
                '<summary>' + escapeHtml(state.strings.reasoningSectionTitle || '') + '</summary>' +
                '<div class="reasoning-content">' + markdownToHtml(reasoningText) + '</div>' +
              '</details>'
            : '';
          // Simple case: no tool rounds, just reasoning
          const reasoningBlock = (!toolRounds && message.role === 'assistant' && reasoningText)
            ? '<details class="reasoning-block">' +
                '<summary>' + escapeHtml(state.strings.reasoningSectionTitle || '') + '</summary>' +
                '<div class="reasoning-content">' + markdownToHtml(reasoningText) + '</div>' +
              '</details>'
            : '';
          const messageActions = state.canChat ? '' +
            '<div class="message-meta-actions">' +
              '<button class="message-action-btn" type="button" data-msg-action="view-raw" data-id="' + escapeHtml(message.id) + '" title="' + escapeHtml(state.strings.viewRawTextAction || '') + '">' + icons.rawText + '</button>' +
              (message.id === latestAssistantId && message.role === 'assistant'
                ? '<button class="message-action-btn" type="button" data-msg-action="regenerate-reply" data-id="' + escapeHtml(message.id) + '" title="' + escapeHtml(state.strings.regenerateReplyAction || '') + '">' + icons.regenerateReply + '</button>'
                : '') +
              (message.role === 'user'
                ? '<button class="message-action-btn" type="button" data-msg-action="edit-message" data-id="' + escapeHtml(message.id) + '" title="' + escapeHtml(state.strings.editMessageAction || '') + '">' + icons.edit + '</button>'
                : '') +
              (message.role !== 'system'
                ? '<button class="message-action-btn" type="button" data-msg-action="regenerate-from" data-id="' + escapeHtml(message.id) + '" title="' + escapeHtml(state.strings.regenerateFromMessageAction || '') + '">' + icons.regenerateFrom + '</button>'
                : '') +
              '<button class="message-action-btn" type="button" data-msg-action="copy-message" data-id="' + escapeHtml(message.id) + '" title="' + escapeHtml(state.strings.copyMessageAction || '') + '">' + icons.copy + '</button>' +
              '<button class="message-action-btn" type="button" data-msg-action="delete-message" data-id="' + escapeHtml(message.id) + '" title="' + escapeHtml(state.strings.deleteMessageAction || '') + '">' + icons.delete + '</button>' +
            '</div>'
            : '';
          return '' +
            '<div class="' + rowClass + '">' +
              avatarNode +
              '<div class="message-card">' +
                '<div class="message-meta">' +
                  '<div class="message-meta-main">' +
                    '<span class="message-role">' + escapeHtml(role) + '</span>' +
                    '<span>' + escapeHtml(formatDate(message.timestamp)) + metaExtra + '</span>' +
                  '</div>' +
                  messageActions +
                '</div>' +
                reasoningBlock +
                preToolReasoning +
                toolRoundsBlock +
                postToolReasoning +
                '<div class="message-text">' + markdownToHtml(message.content || '') + ((showCursor && message.id === lastMsg.id) ? '<span class="streaming-cursor"></span>' : '') + '</div>' +
              '</div>' +
            '</div>';
        }).join('') + (isGenerating && lastMsg && lastMsg.role === 'assistant' && !lastMsg.content ? '<div class="loading-indicator-wrapper"><div class="loading-dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>' : '');


        dom.messages.scrollTop = dom.messages.scrollHeight;
      }

      function renderComposer() {
        const isEditingMessage = !!editingMessageId;
        const assistantModelRef = String(state.selectedAssistant?.modelRef || '').trim();
        const assistantModelLabel = state.modelLabel || '-';
        const activeModelRef = String(state.sessionTempModelRef || assistantModelRef || '').trim();
        const modelMap = new Map();
        (state.modelOptions || []).forEach((option) => {
          if (!option || !option.ref || modelMap.has(option.ref)) {
            return;
          }
          const caps = option.capabilities;
          const capSuffix = caps && (caps.vision || caps.reasoning || caps.audio || caps.video || caps.tools)
            ? ' [' + [
                caps.vision ? state.strings.capabilityVision : '',
                caps.reasoning ? state.strings.capabilityReasoning : '',
                caps.audio ? state.strings.capabilityAudio : '',
                caps.video ? state.strings.capabilityVideo : '',
                caps.tools ? state.strings.capabilityTools : ''
              ].filter(Boolean).join(', ') + ']'
            : '';
          modelMap.set(option.ref, (option.label || option.ref) + capSuffix);
        });
        if (activeModelRef && !modelMap.has(activeModelRef)) {
          modelMap.set(activeModelRef, assistantModelLabel);
        }
        dom.tempModelSelect.innerHTML = Array.from(modelMap.entries()).map(([ref, label]) => {
          return '<option value="' + escapeHtml(ref) + '">' + escapeHtml(label) + '</option>';
        }).join('');
        dom.tempModelSelect.value = activeModelRef;

        dom.composerInput.placeholder = state.canChat
          ? state.strings.composerPlaceholder
          : (state.readOnlyReason || state.strings.noAssistantSelectedBody || state.strings.composerPlaceholder);
        const sendLabel = isEditingMessage
          ? (state.strings.saveAction || state.strings.editMessageAction || state.strings.send || '')
          : (state.strings.send || '');
        dom.sendBtn.innerHTML = icons.send + '<span>' + escapeHtml(sendLabel) + '</span>';
        dom.stopBtn.innerHTML = icons.stop + '<span>' + escapeHtml(state.strings.stop || '') + '</span>';
        const sendShortcutText = getCurrentSendShortcutText();
        dom.sendBtn.title = [sendLabel, sendShortcutText].filter(Boolean).join(' · ');
        dom.stopBtn.title = state.strings.stop || '';
        dom.streamingLabel.textContent = state.strings.streaming;
        const isTemporaryModel = !!state.sessionTempModelRef;
        dom.tempModelChip.textContent = state.strings.chatTemporaryModelLabel || '';
        dom.tempModelChip.classList.toggle('visible', isTemporaryModel && state.canChat);
        const activeLabel = modelMap.get(activeModelRef) || assistantModelLabel;
        dom.tempModelSelect.title = state.strings.model + ': ' + activeLabel;
        dom.streamingToggle.checked = !!state.streaming;
        dom.composerInput.disabled = !state.canChat;
        dom.tempModelSelect.disabled = !state.canChat || state.isGenerating;
        dom.streamingToggle.disabled = !state.canChat || state.isGenerating;
        dom.sendBtn.disabled = state.isGenerating || !state.canChat;
        dom.stopBtn.disabled = !state.isGenerating;
        dom.clearBtn.title = isEditingMessage ? (state.strings.cancelAction || '') : (state.strings.clearSessionAction || '');
        dom.clearBtn.disabled = isEditingMessage
          ? false
          : (!state.canChat || state.isGenerating || !state.selectedSession?.messages?.length);
      }

      function renderByDiff(force) {
        const messagesSig = buildMessagesSignature();
        if (force || messagesSig !== renderSigs.messages) {
          renderMessages();
          renderSigs.messages = messagesSig;
        }

        const composerSig = buildComposerSignature();
        if (force || composerSig !== renderSigs.composer) {
          renderComposer();
          renderSigs.composer = composerSig;
        }
        renderToolContinuationModal();
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || !message.type) {
          return;
        }
        if (message.type === 'state') {
          const wasGenerating = state.isGenerating;
          state = message.payload;
          const editStateChanged = syncMessageEditState();
          if (!state.awaitingToolContinuation) {
            toolContinuationActionPending = false;
          }
          renderByDiff(editStateChanged);
          if (wasGenerating && !state.isGenerating) {
            dom.messagesInner.querySelectorAll('.streaming-cursor, .loading-indicator-wrapper').forEach((el) => el.remove());
          }
          if (state.error) {
            if (state.error !== lastStateError) {
              showToast(state.error, 'error');
            }
            lastStateError = state.error;
          } else {
            lastStateError = '';
          }
        }
        if (message.type === 'error') {
          const text = typeof message.message === 'string' ? message.message : state.strings.unknownError || '';
          showToast(text, 'error');
        }
        if (message.type === 'toast') {
          const text = typeof message.message === 'string' ? message.message : '';
          showToast(text, message.tone || 'info');
        }
      });

      dom.streamingToggle.addEventListener('change', () => {
        if (!state.canChat) {
          return;
        }
        vscode.postMessage({ type: 'setStreaming', enabled: !!dom.streamingToggle.checked });
      });

      dom.tempModelSelect.addEventListener('change', () => {
        if (!state.canChat) {
          return;
        }
        const selectedModelRef = String(dom.tempModelSelect.value || '').trim();
        const assistantModelRef = String(state.selectedAssistant?.modelRef || '').trim();
        const nextTempModelRef = selectedModelRef && selectedModelRef !== assistantModelRef ? selectedModelRef : '';
        vscode.postMessage({ type: 'setSessionTempModel', modelRef: nextTempModelRef });
      });

      dom.stopBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'stopGeneration' });
      });

      dom.sendBtn.addEventListener('click', () => {
        if (!state.canChat) {
          return;
        }
        const content = dom.composerInput.value.trim();
        if (!content) {
          return;
        }
        if (editingMessageId) {
          const messageId = editingMessageId;
          const currentContent = String(
            state.selectedSession?.messages?.find((message) => message.id === messageId)?.content || ''
          ).trim();
          clearMessageEditState(true);
          renderByDiff(true);
          if (content === currentContent) {
            return;
          }
          vscode.postMessage({ type: 'editMessage', messageId, newContent: content });
          return;
        }
        dom.composerInput.value = '';
        vscode.postMessage({ type: 'sendMessage', content });
      });

      dom.clearBtn.addEventListener('click', () => {
        if (editingMessageId) {
          clearMessageEditState(true);
          renderByDiff(true);
          return;
        }
        if (!state.canChat || !state.selectedSession) {
          return;
        }
        const current = state.selectedSession?.messages ?? [];
        if (!current.length) {
          return;
        }
        vscode.postMessage({ type: 'clearSession' });
      });

      dom.composerInput.addEventListener('keydown', (event) => {
        if (!state.canChat) {
          return;
        }
        const isCtrlEnterMode = state.sendShortcut === 'ctrlEnter';
        const shouldSend = isCtrlEnterMode
          ? event.key === 'Enter' && event.ctrlKey && !event.shiftKey && !event.metaKey
          : event.key === 'Enter' && !event.ctrlKey && !event.shiftKey && !event.metaKey;
        if (event.key === 'Escape' && editingMessageId) {
          event.preventDefault();
          clearMessageEditState(true);
          renderByDiff(true);
          return;
        }
        if (shouldSend) {
          event.preventDefault();
          dom.sendBtn.click();
        }
      });

      dom.composerResizer.addEventListener('mousedown', (event) => {
        if (event.button !== 0) {
          return;
        }
        isResizingComposer = true;
        composerResizeStartY = event.clientY;
        composerResizeStartHeight = dom.composerInput.offsetHeight;
        document.body.classList.add('resizing');
        event.preventDefault();
      });

      window.addEventListener('mousemove', (event) => {
        if (!isResizingComposer) {
          return;
        }
        const delta = composerResizeStartY - event.clientY;
        const nextHeight = clampComposerHeight(composerResizeStartHeight + delta);
        dom.composerInput.style.height = nextHeight + 'px';
      });

      window.addEventListener('mouseup', () => {
        if (!isResizingComposer) {
          return;
        }
        isResizingComposer = false;
        document.body.classList.remove('resizing');
      });

      dom.messagesInner.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const trigger = target.closest('[data-msg-action]');
        const action = trigger?.getAttribute('data-msg-action');
        const messageId = trigger?.getAttribute('data-id');
        if (!action) {
          return;
        }
        if (action === 'regenerate-reply') {
          vscode.postMessage({ type: 'regenerateReply' });
          return;
        }
        if (!messageId) {
          return;
        }
        if (action === 'regenerate-from') {
          vscode.postMessage({ type: 'regenerateFromMessage', messageId });
          return;
        }
        if (action === 'copy-message') {
          vscode.postMessage({ type: 'copyMessage', messageId });
          return;
        }
        if (action === 'edit-message') {
          const msg = state.selectedSession?.messages?.find((m) => m.id === messageId);
          if (msg && dom.composerInput) {
            editingMessageId = messageId;
            editingSessionId = state.selectedSession?.id || '';
            dom.composerInput.value = msg.content || '';
            dom.composerInput.focus();
            dom.composerInput.setSelectionRange(dom.composerInput.value.length, dom.composerInput.value.length);
            renderByDiff(true);
          }
          return;
        }
        if (action === 'delete-message') {
          vscode.postMessage({ type: 'deleteMessage', messageId });
          return;
        }
        if (action === 'view-raw') {
          var msg = state.selectedSession?.messages?.find(function(m) { return m.id === messageId; });
          if (msg) {
            var container = dom.rawModalBody;
            container.innerHTML = '';
            var reasoningText = String(msg.reasoning || '').trim();
            if (msg.role === 'assistant' && reasoningText) {
              var details = document.createElement('details');
              details.className = 'raw-reasoning-block';
              var summary = document.createElement('summary');
              summary.innerHTML = '<span class="chevron-icon"><span class="codicon codicon-chevron-right"></span></span> ' + escapeHtml(state.strings.reasoningSectionTitle || 'Reasoning');
              var reasoningPre = document.createElement('pre');
              reasoningPre.textContent = reasoningText;
              details.appendChild(summary);
              details.appendChild(reasoningPre);
              container.appendChild(details);
            }
            if (msg.role === 'assistant' && Array.isArray(msg.toolRounds) && msg.toolRounds.length > 0) {
              var toolDetails = document.createElement('details');
              toolDetails.className = 'raw-reasoning-block';
              var toolSummary = document.createElement('summary');
              toolSummary.innerHTML = '<span class="chevron-icon"><span class="codicon codicon-chevron-right"></span></span> ' + escapeHtml(state.strings.toolCallSectionTitle || 'Tool Calls');
              var toolPre = document.createElement('pre');
              toolPre.textContent = JSON.stringify(msg.toolRounds, null, 2);
              toolDetails.appendChild(toolSummary);
              toolDetails.appendChild(toolPre);
              container.appendChild(toolDetails);
            }
            var contentPre = document.createElement('pre');
            contentPre.textContent = String(msg.content || '');
            container.appendChild(contentPre);
            dom.rawModalTitle.textContent = (state.strings.viewRawTextTitle || 'Raw Text') + ' - ' + (msg.role === 'user' ? state.strings.userRole : state.strings.assistantRole);
            dom.rawModalOverlay.classList.add('visible');
          }
          return;
        }
      });

      dom.rawModalClose.addEventListener('click', function() {
        dom.rawModalOverlay.classList.remove('visible');
      });

      dom.rawModalOverlay.addEventListener('click', function(event) {
        if (event.target === dom.rawModalOverlay) {
          dom.rawModalOverlay.classList.remove('visible');
        }
      });

      dom.toolContinuationContinueBtn.addEventListener('click', () => {
        if (!state.awaitingToolContinuation || toolContinuationActionPending) {
          return;
        }
        toolContinuationActionPending = true;
        renderToolContinuationModal();
        vscode.postMessage({ type: 'continueToolCalls' });
      });

      dom.toolContinuationCancelBtn.addEventListener('click', () => {
        if (!state.awaitingToolContinuation || toolContinuationActionPending) {
          return;
        }
        toolContinuationActionPending = true;
        renderToolContinuationModal();
        vscode.postMessage({ type: 'cancelToolCalls' });
      });

      vscode.postMessage({ type: 'ready' });
    </script>
`;
}
