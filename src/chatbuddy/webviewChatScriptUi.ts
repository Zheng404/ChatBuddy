/**
 * 聊天 WebView UI 交互脚本模块。
 *
 * 提供输入框管理、消息渲染、工具栏交互、会话面板切换、
 * 模型选择下拉、图片粘贴和 Toast 显示等 UI 交互逻辑。
 */
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
        const filesDigest = Array.isArray(message.files)
          ? String(message.files.length) + ':' + message.files.map(function(f) { return f.name || ''; }).join(',')
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
          filesDigest,
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
          if (pending.images && pending.images.length > 0) {
            pendingImages = pending.images.slice();
            renderImagePreviews();
          }
          if (pending.files && pending.files.length > 0) {
            pendingFiles = pending.files.slice();
            renderFilePreviews();
          }
        }
        return true;
      }

      function beginOptimisticSend(content, images, files) {
        clearOptimisticSend();
        optimisticSendState = {
          content,
          images: images && images.length > 0 ? images.slice() : undefined,
          files: files && files.length > 0 ? files.slice() : undefined,
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
            timestamp: pending.startedAt,
            images: pending.images,
            files: pending.files
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
          String(state.sessionTempParams?.temperature ?? ''),
          String(state.sessionTempParams?.topP ?? ''),
          String(state.sessionTempParams?.maxTokens ?? ''),
          String(state.sessionTempParams?.presencePenalty ?? ''),
          String(state.sessionTempParams?.frequencyPenalty ?? ''),
          String(state.sendShortcut || ''),
          modelOptionsDigest,
          String(state.strings.composerPlaceholder || ''),
          String(state.strings.send || ''),
          String(state.strings.stop || ''),
          String(state.strings.streaming || ''),
          String(state.strings.sendShortcutEnter || ''),
          String(state.strings.sendShortcutCtrlEnter || ''),
          String(state.strings.sendShortcutShiftEnter || ''),
          String(state.strings.provider || ''),
          String(state.strings.model || ''),
          String(state.strings.chatModelFollowAssistant || ''),
          String(state.strings.chatTemporaryModelLabel || ''),
          String(state.strings.mcpResourcesAction || ''),
          String(state.strings.mcpPromptsAction || ''),
          String((state.mcpServers || []).length),
          (Array.isArray(state.mcpServers) ? state.mcpServers : []).map(function(s) { s = s || {}; return (s.id || '') + ':' + (s.lastProbe ? (s.lastProbe.success ? 'ok' : 'fail') : '?'); }).join(','),
          String(state.strings.noAssistantSelectedBody || '')
        ].join('|');
      }

      function getCurrentSendShortcutText() {
        if (state.sendShortcut === 'ctrlEnter') {
          return String(state.strings.sendShortcutCtrlEnter || '');
        }
        if (state.sendShortcut === 'shiftEnter') {
          return String(state.strings.sendShortcutShiftEnter || '');
        }
        return String(state.strings.sendShortcutEnter || '');
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
        // Safe: all dynamic content is escaped via escapeHtml(); codiconMarkup() returns static safe HTML
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
      var MESSAGE_HTML_CACHE_MAX = 200;

      function generateMessageHtml(message, latestAssistantId, assistantDisplayName, isGenerating, lastMsg, options) {
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
                    if (!img.base64) { return ''; }
                    var mime = String(img.mimeType || '').toLowerCase();
                    if (['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif'].indexOf(mime) === -1) { return ''; }
                    return '<img class="message-image" src="data:' + escapeHtmlAttr(mime) + ';base64,' + escapeHtmlAttr(img.base64) + '" />';
                  }).join('')
                : '') + '</div>' +
              '<div class="message-files">' + (Array.isArray(message.files) && message.files.length > 0
                ? message.files.map(function(file, fidx) {
                    var fName = escapeHtml(file.name || '');
                    var fLang = escapeHtml(file.language || '');
                    var fContent = escapeHtml(file.content || '');
                    return '<div class="file-attachment">' +
                      '<div class="file-attachment-header" data-action="toggle-file">' +
                        '<span class="codicon codicon-file"></span>' +
                        '<span class="file-attachment-name">' + fName + '</span>' +
                        '<span class="file-attachment-toggle">▼</span>' +
                      '</div>' +
                      '<div class="file-attachment-content" style="display:none;">' +
                        '<pre><code class="language-' + fLang + '">' + fContent + '</code></pre>' +
                      '</div>' +
                    '</div>';
                  }).join('')
                : '') + '</div>' +
              '<div class="message-text">' + markdownToHtml(message.content || '') + '</div>' +
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
            // Evict oldest entries when cache exceeds limit
            var cacheKeys = Object.keys(messageHtmlCache);
            if (cacheKeys.length > MESSAGE_HTML_CACHE_MAX) {
              for (var ei = 0; ei < cacheKeys.length - MESSAGE_HTML_CACHE_MAX; ei++) {
                delete messageHtmlCache[cacheKeys[ei]];
              }
            }
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

        // Safe: htmlParts are generated by generateMessageHtml() which escapes all user content via escapeHtml()
        dom.messagesInner.innerHTML = htmlParts.join('');

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
        dom.tempModelSelect.textContent = '';
        Array.from(modelMap.entries()).forEach(([ref, label]) => {
          var option = document.createElement('option');
          option.value = ref;
          option.textContent = label;
          dom.tempModelSelect.appendChild(option);
        });
        dom.tempModelSelect.value = activeModelRef;

        dom.composerInput.placeholder = state.canChat
          ? state.strings.composerPlaceholder
          : (state.readOnlyReason || state.strings.noAssistantSelectedBody || state.strings.composerPlaceholder);
        const sendShortcutText = getCurrentSendShortcutText();
        dom.streamingLabel.textContent = state.strings.streaming;
        const isTemporaryModel = !!state.sessionTempModelRef;
        dom.tempModelChip.textContent = state.strings.chatTemporaryModelLabel || '';
        dom.tempModelChip.classList.toggle('visible', isTemporaryModel && state.canChat);

        // 临时参数
        var tp = state.sessionTempParams || {};
        var hasTempParams = tp.temperature !== undefined || tp.topP !== undefined || tp.maxTokens !== undefined || tp.presencePenalty !== undefined || tp.frequencyPenalty !== undefined;
        dom.tempParamsChip.textContent = state.strings.tempParamsChipLabel || '';
        dom.tempParamsChip.classList.toggle('visible', hasTempParams && state.canChat);

        // MCP 健康指示器
        var mcpServers = Array.isArray(state.mcpServers) ? state.mcpServers : [];
        if (dom.mcpHealthChip) {
          try {
            if (!mcpServers.length || !state.canChat) {
              dom.mcpHealthChip.classList.remove('visible');
              dom.mcpHealthChip.classList.remove('status-ok');
              dom.mcpHealthChip.classList.remove('status-warn');
              dom.mcpHealthChip.classList.remove('status-error');
              dom.mcpHealthChip.textContent = '';
              dom.mcpHealthChip.title = '';
            } else {
              var okCount = 0;
              var failCount = 0;
              var unknownCount = 0;
              var tooltipLines = [state.strings.mcpHealthTooltipTitle || 'MCP servers'];
              for (var mi = 0; mi < mcpServers.length; mi++) {
                var srv = mcpServers[mi] || {};
                var srvName = srv.name || srv.id || '';
                var probe = srv.lastProbe;
                if (!probe) {
                  unknownCount++;
                  tooltipLines.push('• ' + srvName + ' — ' + (state.strings.mcpHealthNeverProbed || 'Not probed'));
                } else if (probe.success) {
                  okCount++;
                  var okTime = probe.probedAt ? new Date(probe.probedAt).toLocaleString() : '';
                  tooltipLines.push('✓ ' + srvName + (okTime ? ' (' + okTime + ')' : ''));
                } else {
                  failCount++;
                  var failTime = probe.probedAt ? new Date(probe.probedAt).toLocaleString() : '';
                  tooltipLines.push('✗ ' + srvName + (failTime ? ' (' + failTime + ')' : '') + (probe.error ? ' — ' + probe.error : ''));
                }
              }
              var status = failCount > 0 ? 'status-error' : (unknownCount > 0 ? 'status-warn' : 'status-ok');
              dom.mcpHealthChip.classList.remove('status-ok');
              dom.mcpHealthChip.classList.remove('status-warn');
              dom.mcpHealthChip.classList.remove('status-error');
              dom.mcpHealthChip.classList.add('visible');
              dom.mcpHealthChip.classList.add(status);
              var statusLabel = failCount > 0
                ? (state.strings.mcpHealthSomeFailed || 'MCP issue')
                : (unknownCount > 0 ? (state.strings.mcpHealthUnknown || 'MCP unknown') : (state.strings.mcpHealthAllOk || 'MCP OK'));
              dom.mcpHealthChip.textContent = '● ' + statusLabel;
              dom.mcpHealthChip.title = tooltipLines.join('\\n');
            }
          } catch (e) {
            // 保险：MCP 健康指示器渲染失败不应阻塞 composer 其余渲染
            try {
              dom.mcpHealthChip.classList.remove('visible');
              dom.mcpHealthChip.textContent = '';
              dom.mcpHealthChip.title = '';
            } catch (ignore) {}
          }
        }
        dom.tempParamsTitle.textContent = state.strings.tempParamsTitle || '';
        dom.tempParamsTempLabel.textContent = state.strings.temperatureLabel || 'Temperature';
        dom.tempParamsTopPLabel.textContent = state.strings.topPLabel || 'Top P';
        dom.tempParamsMaxTokensLabel.textContent = state.strings.maxTokensLabel || 'Max Tokens';
        dom.tempParamsPresenceLabel.textContent = state.strings.presencePenaltyLabel || 'Presence';
        dom.tempParamsFrequencyLabel.textContent = state.strings.frequencyPenaltyLabel || 'Frequency';
        var assistant = state.selectedAssistant || {};
        dom.tempParamsTemp.value = tp.temperature !== undefined ? tp.temperature : '';
        dom.tempParamsTopP.value = tp.topP !== undefined ? tp.topP : '';
        dom.tempParamsMaxTokens.value = tp.maxTokens !== undefined ? tp.maxTokens : '';
        dom.tempParamsPresence.value = tp.presencePenalty !== undefined ? tp.presencePenalty : '';
        dom.tempParamsFrequency.value = tp.frequencyPenalty !== undefined ? tp.frequencyPenalty : '';
        dom.tempParamsTemp.placeholder = assistant.temperature !== undefined ? String(assistant.temperature) : '';
        dom.tempParamsTopP.placeholder = assistant.topP !== undefined ? String(assistant.topP) : '';
        dom.tempParamsMaxTokens.placeholder = assistant.maxTokens !== undefined ? String(assistant.maxTokens) : '';
        dom.tempParamsPresence.placeholder = assistant.presencePenalty !== undefined ? String(assistant.presencePenalty) : '';
        dom.tempParamsFrequency.placeholder = assistant.frequencyPenalty !== undefined ? String(assistant.frequencyPenalty) : '';
        dom.tempParamsBtn.disabled = !state.canChat || isBusy;
        const activeLabel = modelMap.get(activeModelRef) || assistantModelLabel;
        dom.tempModelSelect.title = state.strings.model + ': ' + activeLabel;
        dom.streamingToggle.checked = !!state.streaming;
        dom.composerInput.disabled = !state.canChat;
        dom.tempModelSelect.disabled = !state.canChat || isBusy;
        dom.streamingToggle.disabled = !state.canChat || isBusy;
        // 发送/停止按钮合二为一：生成中显示停止，否则显示发送
        if (state.isGenerating) {
          dom.sendBtn.classList.remove('btn-primary');
          dom.sendBtn.classList.add('btn-stop');
          dom.sendBtn.textContent = '';
          var stopIcon = document.createElement('span');
          stopIcon.className = 'codicon codicon-debug-stop';
          dom.sendBtn.appendChild(stopIcon);
          var stopLabel = document.createElement('span');
          stopLabel.textContent = state.strings.stop || '';
          dom.sendBtn.appendChild(stopLabel);
          dom.sendBtn.title = state.strings.stop || '';
          dom.sendBtn.disabled = false;
        } else {
          dom.sendBtn.classList.remove('btn-stop');
          dom.sendBtn.classList.add('btn-primary');
          const sendLabel = isEditingMessage
            ? (state.strings.saveAction || state.strings.editMessageAction || state.strings.send || '')
            : (state.strings.send || '');
          dom.sendBtn.textContent = '';
          var sendIcon = document.createElement('span');
          sendIcon.className = 'codicon codicon-send';
          dom.sendBtn.appendChild(sendIcon);
          var sendLabelSpan = document.createElement('span');
          sendLabelSpan.textContent = sendLabel;
          dom.sendBtn.appendChild(sendLabelSpan);
          dom.sendBtn.title = [sendLabel, sendShortcutText].filter(Boolean).join(' · ');
          dom.sendBtn.disabled = !state.canChat;
        }
        dom.clearBtn.title = isEditingMessage ? (state.strings.cancelAction || '') : (state.strings.clearSessionAction || '');
        dom.clearBtn.disabled = isEditingMessage
          ? false
          : (!state.canChat || isBusy || !state.selectedSession?.messages?.length);
        if (dom.composerToolbar) {
          dom.composerToolbar.classList.toggle('generating', !!state.isGenerating);
        }
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
