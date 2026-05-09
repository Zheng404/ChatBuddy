/**
 * MCP server modal open/render/bind/sync/close/confirm logic
 * for the settings center webview.
 */
export function getMcpModalJs(): string {
  return `
      function openMcpServerModal(mode, idx) {
        mcpModalMode = mode;
        mcpModalEditIdx = typeof idx === 'number' ? idx : -1;
        var strings = runtimeState.strings || {};
        var isNew = mode === 'add';
        var server = isNew
          ? { id: 'mcp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9), name: strings.mcpServerNewName || 'New Server', enabled: true, transport: 'stdio', command: '', args: [], cwd: '', env: [], url: '', headers: [], timeoutMs: 30000, remotePassthroughEnabled: false }
          : (mcpServers[idx] ? cloneMcpServers([mcpServers[idx]])[0] : null);
        if (!server) { return; }
        mcpModalDraft = server;
        dom.mcpServerModalTitle.textContent = isNew ? (strings.mcpAddServerModalTitle || 'Add MCP Server') : (strings.mcpEditServerModalTitle || 'Edit MCP Server');
        dom.mcpServerModalDescription.textContent = isNew ? (strings.mcpAddServerModalDescription || '') : (strings.mcpEditServerModalDescription || '');
        dom.mcpModalNameLabel.textContent = strings.mcpServerNameLabel || '';
        dom.mcpModalTransportLabel.textContent = strings.mcpServerTransportLabel || '';
        dom.mcpModalName.value = server.name || '';
        dom.mcpModalTransport.value = server.transport || 'stdio';
        dom.mcpModalCancelBtn.textContent = strings.cancelAction || 'Cancel';
        dom.mcpModalSaveBtn.textContent = strings.saveAction || 'Save';
        renderMcpModalFields();
        openModal(dom.mcpServerModal, dom.mcpModalName);
      }

      function renderMcpModalFields() {
        var strings = runtimeState.strings || {};
        var server = mcpModalDraft;
        if (!server) { return; }
        var transport = dom.mcpModalTransport.value || server.transport || 'stdio';
        var fieldsHtml = '';
        var transportHelp = '';
        if (transport === 'stdio') {
          transportHelp = strings.mcpTransportStdioHelp || '';
        } else if (transport === 'streamableHttp') {
          transportHelp = strings.mcpTransportHttpHelp || '';
        } else if (transport === 'sse') {
          transportHelp = strings.mcpTransportSseHelp || '';
        }
        if (transportHelp) {
          fieldsHtml += '<div class="help mcp-transport-help">' + escapeHtml(transportHelp) + '</div>';
        }
        if (transport === 'stdio') {
          fieldsHtml +=
            '<div class="field full">' +
              '<label>' + escapeHtml(strings.mcpServerCommandLabel || '') + '</label>' +
              '<input id="mcpModalCommand" type="text" value="' + escapeHtml(server.command || '') + '" />' +
            '</div>' +
            '<div class="field full">' +
              '<label>' + escapeHtml(strings.mcpServerArgsLabel || '') + '</label>' +
              '<div id="mcpModalArgsList">' +
                (server.args || []).map((arg, i) =>
                  '<div class="mcp-kv-row">' +
                    '<input class="mcp-kv-input" type="text" value="' + escapeHtml(arg) + '" data-arg-idx="' + i + '" />' +
                    '<button class="mcp-kv-remove" data-remove-arg="' + i + '" type="button">x</button>' +
                  '</div>'
                ).join('') +
              '</div>' +
              '<button class="mcp-add-row-btn" id="mcpModalAddArgBtn" type="button">' + escapeHtml(strings.mcpAddArgAction || '+ Arg') + '</button>' +
            '</div>' +
            '<div class="field full">' +
              '<label>' + escapeHtml(strings.mcpServerEnvLabel || '') + '</label>' +
              '<div id="mcpModalEnvList">' +
                (server.env || []).map((entry, i) =>
                  '<div class="mcp-kv-row">' +
                    '<input class="mcp-kv-input" type="text" placeholder="KEY" value="' + escapeHtml(entry.key) + '" data-env-key-idx="' + i + '" />' +
                    '<input class="mcp-kv-input" type="text" placeholder="VALUE" value="' + escapeHtml(entry.value) + '" data-env-val-idx="' + i + '" />' +
                    '<button class="mcp-kv-remove" data-remove-env="' + i + '" type="button">x</button>' +
                  '</div>'
                ).join('') +
              '</div>' +
              '<button class="mcp-add-row-btn" id="mcpModalAddEnvBtn" type="button">' + escapeHtml(strings.mcpAddEnvAction || '+ Variable') + '</button>' +
            '</div>';
        } else {
          fieldsHtml +=
            '<div class="field full">' +
              '<label>' + escapeHtml(strings.mcpServerUrlLabel || '') + '</label>' +
              '<input id="mcpModalUrl" type="text" value="' + escapeHtml(server.url || '') + '" />' +
            '</div>' +
            '<div class="field full">' +
              '<label>' + escapeHtml(strings.mcpServerHeadersLabel || '') + '</label>' +
              '<div id="mcpModalHeadersList">' +
                (server.headers || []).map((entry, i) =>
                  '<div class="mcp-kv-row">' +
                    '<input class="mcp-kv-input" type="text" placeholder="KEY" value="' + escapeHtml(entry.key) + '" data-hdr-key-idx="' + i + '" />' +
                    '<input class="mcp-kv-input" type="text" placeholder="VALUE" value="' + escapeHtml(entry.value) + '" data-hdr-val-idx="' + i + '" />' +
                    '<button class="mcp-kv-remove" data-remove-hdr="' + i + '" type="button">x</button>' +
                  '</div>'
                ).join('') +
              '</div>' +
              '<button class="mcp-add-row-btn" id="mcpModalAddHeaderBtn" type="button">' + escapeHtml(strings.mcpAddHeaderAction || '+ Header') + '</button>' +
            '</div>';
        }
        var groupOptions = '<option value="">' + escapeHtml(strings.mcpUngroupedLabel || 'Ungrouped') + '</option>' +
          mcpGroups.map((g) => '<option value="' + escapeHtml(g.id) + '"' + (g.id === server.groupId ? ' selected' : '') + '>' + escapeHtml(g.name) + '</option>').join('');
        fieldsHtml +=
          '<div class="field">' +
            '<label>' + escapeHtml(strings.mcpMoveToGroup || 'Group') + '</label>' +
            '<select id="mcpModalGroup">' + groupOptions + '</select>' +
          '</div>' +
          '<div class="field">' +
            '<label>' + escapeHtml(strings.mcpServerTimeoutLabel || '') + '</label>' +
            '<input id="mcpModalTimeout" type="number" min="1000" value="' + String(server.timeoutMs || 30000) + '" />' +
          '</div>';
        var modalFieldsContainer = document.getElementById('mcpModalFields');
        if (modalFieldsContainer) { modalFieldsContainer.innerHTML = fieldsHtml; }
        bindMcpModalFieldEvents();
      }

      function bindMcpModalFieldEvents() {
        var addArgBtn = document.getElementById('mcpModalAddArgBtn');
        if (addArgBtn) {
          addArgBtn.addEventListener('click', () => {
            if (!mcpModalDraft) { return; }
            syncMcpModalDraftFromFields();
            mcpModalDraft.args = mcpModalDraft.args || [];
            mcpModalDraft.args.push('');
            renderMcpModalFields();
            var lastArg = document.querySelector('[data-arg-idx="' + (mcpModalDraft.args.length - 1) + '"]');
            if (lastArg) { lastArg.focus(); }
          });
        }
        var addEnvBtn = document.getElementById('mcpModalAddEnvBtn');
        if (addEnvBtn) {
          addEnvBtn.addEventListener('click', () => {
            if (!mcpModalDraft) { return; }
            syncMcpModalDraftFromFields();
            mcpModalDraft.env = mcpModalDraft.env || [];
            mcpModalDraft.env.push({ key: '', value: '' });
            renderMcpModalFields();
            var lastEnvKey = document.querySelector('[data-env-key-idx="' + (mcpModalDraft.env.length - 1) + '"]');
            if (lastEnvKey) { lastEnvKey.focus(); }
          });
        }
        var addHeaderBtn = document.getElementById('mcpModalAddHeaderBtn');
        if (addHeaderBtn) {
          addHeaderBtn.addEventListener('click', () => {
            if (!mcpModalDraft) { return; }
            syncMcpModalDraftFromFields();
            mcpModalDraft.headers = mcpModalDraft.headers || [];
            mcpModalDraft.headers.push({ key: '', value: '' });
            renderMcpModalFields();
            var lastHdrKey = document.querySelector('[data-hdr-key-idx="' + (mcpModalDraft.headers.length - 1) + '"]');
            if (lastHdrKey) { lastHdrKey.focus(); }
          });
        }
        document.querySelectorAll('.mcp-kv-remove[data-remove-arg]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (!mcpModalDraft) { return; }
            syncMcpModalDraftFromFields();
            var idx = parseInt(btn.getAttribute('data-remove-arg') || '0', 10);
            mcpModalDraft.args = mcpModalDraft.args || [];
            mcpModalDraft.args.splice(idx, 1);
            renderMcpModalFields();
          });
        });
        document.querySelectorAll('.mcp-kv-remove[data-remove-env]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (!mcpModalDraft) { return; }
            syncMcpModalDraftFromFields();
            var idx = parseInt(btn.getAttribute('data-remove-env') || '0', 10);
            mcpModalDraft.env = mcpModalDraft.env || [];
            mcpModalDraft.env.splice(idx, 1);
            renderMcpModalFields();
          });
        });
        document.querySelectorAll('.mcp-kv-remove[data-remove-hdr]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (!mcpModalDraft) { return; }
            syncMcpModalDraftFromFields();
            var idx = parseInt(btn.getAttribute('data-remove-hdr') || '0', 10);
            mcpModalDraft.headers = mcpModalDraft.headers || [];
            mcpModalDraft.headers.splice(idx, 1);
            renderMcpModalFields();
          });
        });
      }

      function syncMcpModalDraftFromFields() {
        if (!mcpModalDraft) { return; }
        mcpModalDraft.name = (dom.mcpModalName.value || '').trim();
        mcpModalDraft.transport = dom.mcpModalTransport.value || 'stdio';
        if (mcpModalDraft.transport === 'stdio') {
          var cmdEl = document.getElementById('mcpModalCommand');
          mcpModalDraft.command = cmdEl ? cmdEl.value : '';
          var argEls = document.querySelectorAll('[data-arg-idx]');
          mcpModalDraft.args = Array.from(argEls).map((el) => el.value);
          var envKeyEls = document.querySelectorAll('[data-env-key-idx]');
          var envValEls = document.querySelectorAll('[data-env-val-idx]');
          mcpModalDraft.env = Array.from(envKeyEls).map((el, i) => ({
            key: el.value,
            value: envValEls[i] ? envValEls[i].value : ''
          }));
        } else {
          var urlEl = document.getElementById('mcpModalUrl');
          mcpModalDraft.url = urlEl ? urlEl.value : '';
          var hdrKeyEls = document.querySelectorAll('[data-hdr-key-idx]');
          var hdrValEls = document.querySelectorAll('[data-hdr-val-idx]');
          mcpModalDraft.headers = Array.from(hdrKeyEls).map((el, i) => ({
            key: el.value,
            value: hdrValEls[i] ? hdrValEls[i].value : ''
          }));
        }
        var timeoutEl = document.getElementById('mcpModalTimeout');
        mcpModalDraft.timeoutMs = timeoutEl ? Math.max(1000, parseInt(timeoutEl.value, 10) || 30000) : 30000;
        var groupEl = document.getElementById('mcpModalGroup');
        mcpModalDraft.groupId = groupEl && groupEl.value ? groupEl.value : undefined;
      }

      function closeMcpServerModal() {
        closeModal(dom.mcpServerModal);
        mcpModalDraft = null;
        mcpModalEditIdx = -1;
      }

      function confirmMcpServer() {
        syncMcpModalDraftFromFields();
        if (!mcpModalDraft) { closeMcpServerModal(); return; }
        var strings = runtimeState.strings || {};
        if (!mcpModalDraft.name.trim()) {
          showToast(strings.mcpServerNameRequired || 'Server name is required.', 'error');
          return;
        }
        var wasMode = mcpModalMode;
        var wasIdx = mcpModalEditIdx;
        if (wasMode === 'add') {
          mcpServers.push(cloneMcpServers([mcpModalDraft])[0]);
        } else if (wasIdx >= 0 && wasIdx < mcpServers.length) {
          mcpServers[wasIdx] = cloneMcpServers([mcpModalDraft])[0];
        }
        closeMcpServerModal();
        renderMcpGroups();
        renderMcpServerList();
        autoSaveMcpServers();
        var savedServer = (wasMode === 'add')
          ? mcpServers[mcpServers.length - 1]
          : mcpServers[wasIdx];
        if (savedServer && savedServer.enabled) {
          vscode.postMessage({
            type: 'testMcpServer',
            payload: { server: savedServer }
          });
        }
      }
`;
}
