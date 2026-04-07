/**
 * MCP server management functions for the settings center webview.
 */
export function getMcpJs(): string {
  return `
      function cloneMcpServers(items) {
        return (Array.isArray(items) ? items : []).map((server) => ({
          id: String(server.id || ''),
          name: String(server.name || ''),
          enabled: server.enabled !== false,
          transport: server.transport === 'streamableHttp' || server.transport === 'sse' ? server.transport : 'stdio',
          command: String(server.command || ''),
          args: Array.isArray(server.args) ? server.args.slice() : [],
          cwd: String(server.cwd || ''),
          env: Array.isArray(server.env) ? server.env.map((e) => ({ key: String(e.key || ''), value: String(e.value || '') })) : [],
          url: String(server.url || ''),
          headers: Array.isArray(server.headers) ? server.headers.map((h) => ({ key: String(h.key || ''), value: String(h.value || '') })) : [],
          timeoutMs: typeof server.timeoutMs === 'number' ? server.timeoutMs : 30000,
          remotePassthroughEnabled: !!server.remotePassthroughEnabled
        }));
      }

      function mcpServersSignature(items) {
        return JSON.stringify(cloneMcpServers(items));
      }

      function syncMcpServersFromState(state) {
        var servers = (state.settings && state.settings.mcp && state.settings.mcp.servers) || [];
        mcpServers = cloneMcpServers(servers);
        mcpProbeResults = [];
        expandedToolServerIdx = -1;
      }

      function renderMcp() {
        var strings = runtimeState.strings || {};
        dom.mcpMaxToolRoundsTitle.textContent = strings.mcpMaxToolRoundsTitle || '';

        dom.mcpMaxToolRoundsHelp.textContent = strings.mcpMaxToolRoundsHelp || '';
        dom.mcpSaveToolRoundsBtn.textContent = strings.saveAction || 'Save';
        dom.mcpServersTitle.textContent = strings.mcpServersTitle || '';
        dom.mcpAddServerBtn.textContent = strings.mcpAddServerAction || '+ Add Server';
        var settings = runtimeState.settings || {};
        var mcp = settings.mcp || {};
        dom.mcpMaxToolRounds.value = String(typeof mcp.maxToolRounds === 'number' ? mcp.maxToolRounds : 5);
        renderMcpServerList();
      }

      function renderMcpServerList() {
        var strings = runtimeState.strings || {};
        if (!mcpServers.length) {
          dom.mcpServerList.innerHTML = '<div class="help">' + escapeHtml(strings.mcpEmptyState || '') + '</div>';
          return;
        }
        dom.mcpServerList.innerHTML = mcpServers.map((server, idx) => {
          var probe = mcpProbeResults[idx];
          var statusDot = '';
          if (probe) {
            statusDot = probe.success
              ? '<span class="mcp-status-dot mcp-status-ok" title="' + escapeHtml(strings.mcpProbeSuccess || '') + '"></span>'
              : '<span class="mcp-status-dot mcp-status-fail" title="' + escapeHtml(probe.error || strings.mcpProbeFailed || '') + '"></span>';
          }
          var toolCountHtml = '';
          if (probe && probe.success) {
            var toolCountText = (strings.mcpToolsCount || '{count} tools').replace('{count}', String(probe.tools.length));
            toolCountHtml = '<span class="mcp-tool-count" data-mcp-action="toggle-tools" data-idx="' + idx + '">' + escapeHtml(toolCountText) + '</span>';
          }
          var enabledLabel = strings.mcpServerEnabledLabel || '';
          var transportLabel = server.transport === 'streamableHttp' ? 'HTTP' : server.transport === 'sse' ? 'SSE' : 'stdio';
          var toolsHtml = renderMcpToolsSection(idx);
          return (
            '<div class="mcp-server-card" data-idx="' + idx + '">' +
              '<div class="mcp-server-card-row">' +
                '<span class="mcp-server-name-display">' + escapeHtml(server.name || strings.mcpServerNewName || '') + '</span>' +
                statusDot +
                toolCountHtml +
                '<span class="pill">' + escapeHtml(transportLabel) + '</span>' +
                '<label class="mcp-server-toggle">' +
                  '<input type="checkbox" data-mcp-toggle-idx="' + idx + '" ' + (server.enabled ? 'checked' : '') + ' />' +
                  '<span>' + escapeHtml(enabledLabel) + '</span>' +
                '</label>' +
                '<div class="mcp-server-actions">' +
                  '<button class="btn-secondary" data-mcp-action="test" data-idx="' + idx + '" type="button">' + escapeHtml(strings.mcpTestServerAction || 'Test') + '</button>' +
                  '<button class="btn-secondary" data-mcp-action="edit" data-idx="' + idx + '" type="button">' + escapeHtml(strings.mcpEditServerAction || 'Edit') + '</button>' +
                  '<button class="btn-danger" data-mcp-action="delete" data-idx="' + idx + '" type="button">' + escapeHtml(strings.mcpDeleteServerAction || 'Delete') + '</button>' +
                '</div>' +
              '</div>' +
              toolsHtml +
            '</div>'
          );
        }).join('');
      }

      function renderMcpToolsSection(idx) {
        var strings = runtimeState.strings || {};
        if (idx !== expandedToolServerIdx) { return ''; }
        var probe = mcpProbeResults[idx];
        if (!probe || !probe.success) { return ''; }
        var html = '<div class="mcp-tools-section">';
        html += '<h4 class="mcp-tools-heading">' + escapeHtml(strings.mcpToolsTitle || 'Tools') + '</h4>';
        if (probe.tools.length) {
          html += '<ul class="mcp-tools-list">';
          for (var t = 0; t < probe.tools.length; t++) {
            html += '<li><strong>' + escapeHtml(probe.tools[t].name) + '</strong>' +
              (probe.tools[t].description ? ' — ' + escapeHtml(probe.tools[t].description) : '') + '</li>';
          }
          html += '</ul>';
        } else {
          html += '<div class="help">' + escapeHtml(strings.mcpNoTools || '') + '</div>';
        }
        if (probe.resources.length) {
          html += '<div class="mcp-tools-heading" style="margin-top:8px">' +
            escapeHtml(strings.mcpResourcesLabel || 'Resources') + ': ' +
            (strings.mcpResourcesCount || '{count}').replace('{count}', String(probe.resources.length)) + '</div>';
        }
        if (probe.prompts.length) {
          html += '<div class="mcp-tools-heading" style="margin-top:4px">' +
            escapeHtml(strings.mcpPromptsLabel || 'Prompts') + ': ' +
            (strings.mcpPromptsCount || '{count}').replace('{count}', String(probe.prompts.length)) + '</div>';
        }
        html += '</div>';
        return html;
      }

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
        dom.mcpServerModal.classList.add('visible');
        dom.mcpServerModal.setAttribute('aria-hidden', 'false');
        dom.mcpModalName.focus();
      }

      function renderMcpModalFields() {
        var strings = runtimeState.strings || {};
        var server = mcpModalDraft;
        if (!server) { return; }
        var transport = dom.mcpModalTransport.value || server.transport || 'stdio';
        var fieldsHtml = '';
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
        fieldsHtml +=
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
      }

      function closeMcpServerModal() {
        dom.mcpServerModal.classList.remove('visible');
        dom.mcpServerModal.setAttribute('aria-hidden', 'true');
        mcpModalDraft = null;
        mcpModalEditIdx = -1;
      }

      function autoSaveMcpServers() {
        vscode.postMessage({ type: 'saveMcpServers', payload: cloneMcpServers(mcpServers) });
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
