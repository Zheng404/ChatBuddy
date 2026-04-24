/**
 * MCP server data utilities, state synchronization, and rendering
 * for the settings center webview.
 * Modal logic in mcpModal.ts.
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
          var transportLabel = server.transport === 'streamableHttp' ? (strings.mcpTransportHttp || 'HTTP') : server.transport === 'sse' ? (strings.mcpTransportSse || 'SSE') : (strings.mcpTransportStdio || 'stdio');
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

      function autoSaveMcpServers() {
        vscode.postMessage({ type: 'saveMcpServers', payload: cloneMcpServers(mcpServers) });
      }
`;
}
