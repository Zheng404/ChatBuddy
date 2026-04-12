export function getChatEventScript(): string {
  return `
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
`;
}
