export function getChatUiScript(): string {
  return `
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
        const imagesDigest = Array.isArray(message.images)
          ? String(message.images.length)
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
          imagesDigest,
          toolRoundsDigest
        ].join('~');
      }

      function buildSessionSyncMarker(payload) {
        const session = payload?.selectedSession;
        const messages = Array.isArray(session?.messages) ? session.messages : [];
        return [
          String(payload?.selectedAssistantId || ''),
          String(payload?.selectedSessionId || ''),
          String(session?.updatedAt || ''),
          String(messages.length),
          messageDigest(messages[messages.length - 1])
        ].join('|');
      }

      function getOptimisticSendForCurrentSession() {
        if (!optimisticSendState) {
          return undefined;
        }
        const currentSessionId = String(state.selectedSessionId || '');
        if (optimisticSendState.sessionId !== currentSessionId) {
          return undefined;
        }
        return optimisticSendState;
      }

      function clearOptimisticSend(options) {
        if (optimisticSendRestoreTimer) {
          clearTimeout(optimisticSendRestoreTimer);
          optimisticSendRestoreTimer = 0;
        }
        const pending = optimisticSendState;
        if (!pending) {
          return false;
        }
        optimisticSendState = undefined;
        if (options?.restoreInput && !String(dom.composerInput.value || '').trim()) {
          dom.composerInput.value = pending.content;
        }
        return true;
      }

      function beginOptimisticSend(content) {
        clearOptimisticSend();
        optimisticSendState = {
          content,
          sessionId: String(state.selectedSessionId || ''),
          startedAt: Date.now(),
          baseMarker: buildSessionSyncMarker(state)
        };
      }

      function scheduleOptimisticSendRestore() {
        if (!optimisticSendState || optimisticSendRestoreTimer) {
          return;
        }
        optimisticSendRestoreTimer = setTimeout(function() {
          if (!clearOptimisticSend({ restoreInput: true })) {
            return;
          }
          renderByDiff(true);
        }, 180);
      }

      function reconcileOptimisticSend(nextState) {
        if (!optimisticSendState) {
          return false;
        }
        const sameSession = String(nextState?.selectedSessionId || '') === optimisticSendState.sessionId;
        const shouldRestore =
          sameSession &&
          !nextState?.isGenerating &&
          buildSessionSyncMarker(nextState) === optimisticSendState.baseMarker;
        return clearOptimisticSend({ restoreInput: shouldRestore });
      }

      function getDisplayedMessages() {
        const current = state.selectedSession?.messages ?? [];
        const pending = getOptimisticSendForCurrentSession();
        if (!pending) {
          return current;
        }
        return current.concat([
          {
            id: 'optimistic-user-message',
            role: 'user',
            content: pending.content,
            timestamp: pending.startedAt
          }
        ]);
      }

      var cachedMessagesSigStatic = '';

      function buildMessagesSignature() {
        const current = getDisplayedMessages();
        const selectedAssistantName = String(state.selectedAssistant?.name || '').trim();
        var staticPart = cachedMessagesSigStatic;
        var staticKey = String(state.locale || '') + '|' + String(state.selectedAssistantId || '') + '|' +
          selectedAssistantName + '|' + String(state.selectedSessionId || '') + '|' +
          String(state.selectedSession?.updatedAt || '') + '|' +
          (state.canChat ? '1' : '0') + '|' + String(state.readOnlyReason || '') + '|' +
          String(state.strings.emptyStateTitle || '') + '|' + String(state.strings.emptyStateBody || '') + '|' +
          String(state.strings.noAssistantSelectedTitle || '') + '|' + String(state.strings.noAssistantSelectedBody || '') + '|' +
          String(state.strings.userRole || '') + '|' + String(state.strings.assistantRole || '') + '|' +
          String(state.strings.systemRole || '') + '|' + String(state.strings.regenerateReplyAction || '') + '|' +
          String(state.strings.regenerateFromMessageAction || '') + '|' + String(state.strings.copyMessageAction || '') + '|' +
          String(state.strings.deleteMessageAction || '') + '|' + String(state.strings.reasoningSectionTitle || '');
        if (staticKey !== cachedMessagesSigStatic) {
          cachedMessagesSigStatic = staticKey;
          staticPart = staticKey;
        }
        return staticPart + '|' + String(current.length) + '|' + messageDigest(current[current.length - 1]);
      }

      function buildComposerSignature() {
        const modelOptionsDigest = (state.modelOptions || [])
          .map((option) => option.ref + '~' + option.label + '~' + JSON.stringify(option.capabilities || {}))
          .join('^');
        const isEditingMessage = !!editingMessageId;
        const isAwaitingSendCommit = !!optimisticSendState;
        return [
          isEditingMessage ? '1' : '0',
          editingMessageId,
          isAwaitingSendCommit ? '1' : '0',
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

      var messageHtmlCache = {};

      function generateMessageHtml(message, latestAssistantId, assistantDisplayName, isGenerating, lastMsg, options) {
        const showCursor = isGenerating && lastMsg && lastMsg.role === 'assistant' && message.id === lastMsg.id;
        const suppressActions = !!(options && options.suppressActions);
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
        const postToolReasoning = (toolRounds && reasoningText)
          ? '<details class="reasoning-block">' +
              '<summary>' + escapeHtml(state.strings.reasoningSectionTitle || '') + '</summary>' +
              '<div class="reasoning-content">' + markdownToHtml(reasoningText) + '</div>' +
            '</details>'
          : '';
        const reasoningBlock = (!toolRounds && message.role === 'assistant' && reasoningText)
          ? '<details class="reasoning-block">' +
              '<summary>' + escapeHtml(state.strings.reasoningSectionTitle || '') + '</summary>' +
              '<div class="reasoning-content">' + markdownToHtml(reasoningText) + '</div>' +
            '</details>'
          : '';
        const messageActions = suppressActions
          ? ''
          : state.canChat ? '' +
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
              '<div class="message-images">' + (Array.isArray(message.images) && message.images.length > 0
                ? message.images.map(function(img) {
                    return '<img class="message-image" src="data:' + img.mimeType + ';base64,' + img.base64 + '" />';
                  }).join('')
                : '') + '</div>' +
              '<div class="message-text">' + markdownToHtml(message.content || '') + ((showCursor && message.id === lastMsg.id) ? '<span class="streaming-cursor"></span>' : '') + '</div>' +
            '</div>' +
          '</div>';
      }

      function renderMessages() {
        const current = state.selectedSession?.messages ?? [];
        const displayedMessages = getDisplayedMessages();
        const optimisticSend = getOptimisticSendForCurrentSession();
        if (!displayedMessages.length) {
          renderEmptyState();
          messageHtmlCache = {};
          return;
        }

        const latestAssistantId = [...current].reverse().find((item) => item.role === 'assistant')?.id || '';
        const assistantDisplayName = String(state.selectedAssistant?.name || '').trim() || state.strings.assistantRole;
        const isGenerating = state.isGenerating;
        const authoritativeLastMsg = current[current.length - 1];
        const lastMsg = displayedMessages[displayedMessages.length - 1];

        const htmlParts = [];
        for (var mi = 0; mi < displayedMessages.length; mi++) {
          var msg = displayedMessages[mi];
          var digest = messageDigest(msg);
          var cacheKey = msg.id + '|' + digest;
          if (isGenerating && msg.id === lastMsg.id) {
            cacheKey += '|cursor';
          }
          if (messageHtmlCache[cacheKey]) {
            htmlParts.push(messageHtmlCache[cacheKey]);
          } else {
            var html = generateMessageHtml(msg, latestAssistantId, assistantDisplayName, isGenerating, lastMsg, {
              suppressActions: msg.id === 'optimistic-user-message'
            });
            messageHtmlCache[cacheKey] = html;
            htmlParts.push(html);
          }
        }

        var currentKeys = {};
        for (var pi = 0; pi < displayedMessages.length; pi++) {
          currentKeys[displayedMessages[pi].id] = true;
        }
        var staleKeys = Object.keys(messageHtmlCache);
        for (var si = 0; si < staleKeys.length; si++) {
          var staleId = staleKeys[si].split('|')[0];
          if (!currentKeys[staleId]) {
            delete messageHtmlCache[staleKeys[si]];
          }
        }

        const showLoadingIndicator =
          !!optimisticSend ||
          (isGenerating && authoritativeLastMsg && authoritativeLastMsg.role === 'assistant' && !authoritativeLastMsg.content);

        dom.messagesInner.innerHTML = htmlParts.join('') + (showLoadingIndicator ? '<div class="loading-indicator-wrapper"><div class="loading-dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>' : '');

        dom.messages.scrollTop = dom.messages.scrollHeight;
        renderEnhancedContent();
      }

      function renderComposer() {
        const isEditingMessage = !!editingMessageId;
        const isAwaitingSendCommit = !!optimisticSendState;
        const isBusy = state.isGenerating || isAwaitingSendCommit;
        const assistantModelRef = String(state.selectedAssistant?.modelRef || '').trim();
        const assistantModelLabel = state.modelLabel || '-';
        const activeModelRef = String(state.sessionTempModelRef || assistantModelRef || '').trim();
        const modelMap = new Map();
        (state.modelOptions || []).forEach((option) => {
          if (!option || !option.ref || modelMap.has(option.ref)) {
            return;
          }
          modelMap.set(option.ref, (option.label || option.ref) + (option.metaLabel || ''));
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
        dom.tempModelSelect.disabled = !state.canChat || isBusy;
        dom.streamingToggle.disabled = !state.canChat || isBusy;
        dom.sendBtn.disabled = isBusy || !state.canChat;
        dom.stopBtn.disabled = !state.isGenerating;
        dom.clearBtn.title = isEditingMessage ? (state.strings.cancelAction || '') : (state.strings.clearSessionAction || '');
        dom.clearBtn.disabled = isEditingMessage
          ? false
          : (!state.canChat || isBusy || !state.selectedSession?.messages?.length);
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
`;
}
