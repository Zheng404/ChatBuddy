/**
 * 聊天 WebView 事件处理脚本模块。
 *
 * 提供 WebView 内部的事件监听逻辑，包括 VS Code 消息接收、
 * 用户点击/滚动/粘贴等 DOM 事件的响应处理。
 */
export function getChatEventScript(): string {
  return `
      if (window.__chatBuddyListenersAttached) {
        // 脚本被重复注入时，重新发送 ready 以触发状态同步
        vscode.postMessage({ type: 'ready' });
      }
      window.__chatBuddyListenersAttached = true;

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || !message.type) {
          return;
        }
        if (message.type === 'state') {
          const wasGenerating = state.isGenerating;
          const optimisticResolved = reconcileOptimisticSend(message.payload);
          state = message.payload;
          const editStateChanged = syncMessageEditState();
          if (!state.awaitingToolContinuation) {
            toolContinuationActionPending = false;
          }
          renderByDiff(editStateChanged || optimisticResolved);
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
          scheduleOptimisticSendRestore();
          showToast(text, 'error');
        }
        if (message.type === 'toast') {
          const text = typeof message.message === 'string' ? message.message : '';
          showToast(text, message.tone || 'info');
        }
        if (message.type === 'filesSelected') {
          const selectedFiles = message.files;
          if (Array.isArray(selectedFiles) && selectedFiles.length > 0) {
            selectedFiles.forEach(function(file) {
              if (file && file.name && typeof file.content === 'string') {
                pendingFiles.push({
                  name: file.name,
                  content: file.content,
                  language: file.language || getLanguageFromFileName(file.name)
                });
              }
            });
            renderFilePreviews();
          }
        }
        if (message.type === 'imagesSelected') {
          const selectedImages = message.images;
          if (Array.isArray(selectedImages) && selectedImages.length > 0) {
            selectedImages.forEach(function(img) {
              if (img && img.base64 && img.mimeType) {
                pendingImages.push({ base64: img.base64, mimeType: img.mimeType });
              }
            });
            renderImagePreviews();
          }
        }
        if (message.type === 'prefillComposer') {
          const text = typeof message.content === 'string' ? message.content : '';
          if (!text.trim()) {
            return;
          }
          clearMessageEditState(false);
          clearPendingImages();
          clearPendingFiles();
          dom.composerInput.value = text;
          dom.composerInput.focus();
          dom.composerInput.setSelectionRange(dom.composerInput.value.length, dom.composerInput.value.length);
          renderByDiff(true);
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

      // 临时参数面板
      function collectTempParams() {
        var p = {};
        var v;
        v = parseFloat(dom.tempParamsTemp.value);
        if (!isNaN(v)) { p.temperature = v; }
        v = parseFloat(dom.tempParamsTopP.value);
        if (!isNaN(v)) { p.topP = v; }
        v = parseFloat(dom.tempParamsMaxTokens.value);
        if (!isNaN(v)) { p.maxTokens = Math.round(v); }
        v = parseFloat(dom.tempParamsPresence.value);
        if (!isNaN(v)) { p.presencePenalty = v; }
        v = parseFloat(dom.tempParamsFrequency.value);
        if (!isNaN(v)) { p.frequencyPenalty = v; }
        return p;
      }

      function positionTempParamsPopup() {
        try {
          var btnRect = dom.tempParamsBtn.getBoundingClientRect();
          var popupWidth = dom.tempParamsPopup.offsetWidth || 240;
          var popupHeight = dom.tempParamsPopup.offsetHeight || 200;
          var viewportW = window.innerWidth;
          var left = Math.min(Math.max(8, btnRect.left), viewportW - popupWidth - 8);
          var top = btnRect.top - popupHeight - 6;
          if (top < 8) { top = btnRect.bottom + 6; }
          dom.tempParamsPopup.style.left = left + 'px';
          dom.tempParamsPopup.style.top = top + 'px';
        } catch (err) {}
      }

      dom.tempParamsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        var willShow = !dom.tempParamsPopup.classList.contains('visible');
        dom.tempParamsPopup.classList.toggle('visible');
        if (willShow) { positionTempParamsPopup(); }
      });

      window.addEventListener('resize', () => {
        if (dom.tempParamsPopup.classList.contains('visible')) { positionTempParamsPopup(); }
      });

      dom.tempParamsResetBtn.addEventListener('click', () => {
        dom.tempParamsPopup.classList.remove('visible');
        vscode.postMessage({ type: 'clearSessionTempParams' });
      });

      function handleTempParamInput() {
        var params = collectTempParams();
        if (Object.keys(params).length > 0) {
          vscode.postMessage({ type: 'setSessionTempParams', params: params });
        } else {
          vscode.postMessage({ type: 'clearSessionTempParams' });
        }
      }

      [dom.tempParamsTemp, dom.tempParamsTopP, dom.tempParamsMaxTokens, dom.tempParamsPresence, dom.tempParamsFrequency].forEach(function(el) {
        el.addEventListener('change', handleTempParamInput);
      });

      document.addEventListener('click', (e) => {
        if (dom.tempParamsPopup.classList.contains('visible') && !dom.tempParamsPopup.contains(e.target) && e.target !== dom.tempParamsBtn) {
          dom.tempParamsPopup.classList.remove('visible');
        }
      });

      if (dom.attachFileBtn) {
        dom.attachFileBtn.addEventListener('click', () => {
          if (!state.canChat) {
            return;
          }
          vscode.postMessage({ type: 'selectFiles' });
        });
      }

      if (dom.attachImageBtn) {
        dom.attachImageBtn.addEventListener('click', () => {
          if (!state.canChat) {
            return;
          }
          vscode.postMessage({ type: 'selectImages' });
        });
      }

      dom.sendBtn.addEventListener('click', () => {
        if (state.isGenerating) {
          vscode.postMessage({ type: 'stopGeneration' });
          return;
        }
        if (!state.canChat || optimisticSendState) {
          return;
        }
        const content = dom.composerInput.value.trim();
        if (!content && !pendingImages.length && !pendingFiles.length) {
          return;
        }
        if (editingMessageId) {
          const messageId = editingMessageId;
          const editingMsg = state.selectedSession?.messages?.find((message) => message.id === messageId);
          const currentContent = String(editingMsg?.content || '').trim();
          const isUserMsg = editingMsg?.role === 'user';
          clearMessageEditState(true);
          clearPendingImages();
          clearPendingFiles();
          renderByDiff(true);
          if (content === currentContent) {
            return;
          }
          vscode.postMessage({ type: 'editMessage', messageId, newContent: content, regenerate: isUserMsg });
          return;
        }
        const images = pendingImages.length > 0 ? pendingImages.slice() : undefined;
        const files = pendingFiles.length > 0 ? pendingFiles.slice() : undefined;
        dom.composerInput.value = '';
        clearPendingImages();
        clearPendingFiles();
        beginOptimisticSend(content, images, files);
        renderByDiff(true);
        vscode.postMessage({ type: 'sendMessage', content, images, files });
      });

      dom.clearBtn.addEventListener('click', () => {
        if (editingMessageId) {
          clearMessageEditState(true);
          clearPendingImages();
          clearPendingFiles();
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

      dom.composerInput.addEventListener('paste', (event) => {
        handleImagePaste(event);
        handleFilePaste(event);
      });

      if (dom.composerBox) {
        // Note: File drag-and-drop is not supported in VS Code WebViews
        // because VS Code intercepts drag events to open files in editors.
        // Users should use the "Attach files" button or paste files instead.
      }

      dom.composerInput.addEventListener('keydown', (event) => {
        if (!state.canChat) {
          return;
        }
        const shortcutMode = state.sendShortcut;
        let shouldSend = false;
        if (shortcutMode === 'ctrlEnter') {
          shouldSend = event.key === 'Enter' && event.ctrlKey && !event.shiftKey && !event.metaKey;
        } else if (shortcutMode === 'shiftEnter') {
          shouldSend = event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.metaKey;
        } else {
          shouldSend = event.key === 'Enter' && !event.ctrlKey && !event.shiftKey && !event.metaKey;
        }
        if (event.key === 'Escape' && editingMessageId) {
          event.preventDefault();
          clearMessageEditState(true);
          clearPendingImages();
          clearPendingFiles();
          renderByDiff(true);
          return;
        }
        if (shouldSend) {
          event.preventDefault();
          if (!state.canChat || state.isGenerating || optimisticSendState) {
            return;
          }
          const sendContent = dom.composerInput.value.trim();
          if (!sendContent && !pendingImages.length && !pendingFiles.length) {
            return;
          }
          if (editingMessageId) {
            dom.sendBtn.click();
            return;
          }
          const images = pendingImages.length > 0 ? pendingImages.slice() : undefined;
          const files = pendingFiles.length > 0 ? pendingFiles.slice() : undefined;
          dom.composerInput.value = '';
          clearPendingImages();
          clearPendingFiles();
          beginOptimisticSend(sendContent, images, files);
          renderByDiff(true);
          vscode.postMessage({ type: 'sendMessage', content: sendContent, images, files });
        }
      });

      if (dom.composerToolbar) {
        dom.composerToolbar.addEventListener('mousedown', (event) => {
          if (event.button !== 0) {
            return;
          }
          isResizingComposer = true;
          composerResizeStartY = event.clientY;
          composerResizeStartHeight = dom.composerInput.offsetHeight;
          document.body.classList.add('resizing');
          event.preventDefault();
        });
      }

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
        const fileHeader = target.closest('[data-action="toggle-file"]');
        if (fileHeader) {
          fileHeader.classList.toggle('expanded');
          const content = fileHeader.nextElementSibling;
          if (content) {
            content.style.display = content.style.display === 'none' ? 'block' : 'none';
          }
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

      // ── In-message search ──
      var searchMatches = [];
      var searchIndex = -1;
      var searchLastQuery = '';

      function clearSearchHighlights() {
        searchMatches = [];
        searchIndex = -1;
        dom.messagesInner.querySelectorAll('mark.search-highlight').forEach(function(el) {
          var parent = el.parentNode;
          parent.replaceChild(document.createTextNode(el.textContent || ''), el);
          parent.normalize();
        });
      }

      function performSearch(query) {
        clearSearchHighlights();
        if (!query) {
          dom.searchCount.textContent = '';
          return;
        }
        var specialChars = new RegExp('[.*+?^' + String.fromCharCode(36) + '{}()|[\\]\\\\]', 'g');
        var escapedQuery = query.replace(specialChars, '\\\\$&');
        var regex = new RegExp('(' + escapedQuery + ')', 'gi');
        var textNodes = [];
        var walker = document.createTreeWalker(dom.messagesInner, NodeFilter.SHOW_TEXT, null);
        while (walker.nextNode()) { textNodes.push(walker.currentNode); }
        textNodes.forEach(function(node) {
          var text = node.textContent || '';
          if (!regex.test(text)) { return; }
          regex.lastIndex = 0;
          var fragment = document.createDocumentFragment();
          var lastIdx = 0;
          var match;
          while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIdx) {
              fragment.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
            }
            var mark = document.createElement('mark');
            mark.className = 'search-highlight';
            mark.textContent = match[1];
            fragment.appendChild(mark);
            searchMatches.push(mark);
            lastIdx = regex.lastIndex;
          }
          if (lastIdx < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
          }
          node.parentNode.replaceChild(fragment, node);
        });
        searchLastQuery = query;
        if (searchMatches.length > 0) {
          searchIndex = 0;
          searchMatches[0].classList.add('active');
          searchMatches[0].scrollIntoView({ block: 'center' });
          dom.searchCount.textContent = '1/' + searchMatches.length;
        } else {
          dom.searchCount.textContent = '0/0';
        }
      }

      function navigateSearch(delta) {
        if (searchMatches.length === 0) { return; }
        searchMatches[searchIndex].classList.remove('active');
        searchIndex = (searchIndex + delta + searchMatches.length) % searchMatches.length;
        searchMatches[searchIndex].classList.add('active');
        searchMatches[searchIndex].scrollIntoView({ block: 'center' });
        dom.searchCount.textContent = (searchIndex + 1) + '/' + searchMatches.length;
      }

      function openSearch() {
        dom.searchBar.classList.add('visible');
        dom.searchInput.focus();
        dom.searchInput.select();
      }

      function closeSearch() {
        dom.searchBar.classList.remove('visible');
        clearSearchHighlights();
        dom.searchInput.value = '';
        dom.searchCount.textContent = '';
        searchLastQuery = '';
      }

      window.addEventListener('keydown', function(event) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
          event.preventDefault();
          event.stopPropagation();
          openSearch();
        }
        if (event.key === 'Escape' && dom.searchBar.classList.contains('visible')) {
          event.preventDefault();
          closeSearch();
        }
        if (dom.searchBar.classList.contains('visible') && event.key === 'Enter') {
          event.preventDefault();
          navigateSearch(event.shiftKey ? -1 : 1);
        }
      }, true);

      dom.searchInput.addEventListener('input', function() {
        performSearch(dom.searchInput.value);
      });

      dom.searchPrevBtn.addEventListener('click', function() { navigateSearch(-1); });
      dom.searchNextBtn.addEventListener('click', function() { navigateSearch(1); });
      dom.searchCloseBtn.addEventListener('click', closeSearch);
      if (dom.searchBtn) {
        dom.searchBtn.addEventListener('click', openSearch);
      }
`;
}
