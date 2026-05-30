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
          remotePassthroughEnabled: !!server.remotePassthroughEnabled,
          groupId: server.groupId || undefined
        }));
      }

      function cloneMcpGroups(items) {
        return (Array.isArray(items) ? items : []).map((group) => ({
          id: String(group.id || ''),
          name: String(group.name || ''),
          enabled: group.enabled !== false
        }));
      }

      function mcpServersSignature(items) {
        return JSON.stringify(cloneMcpServers(items));
      }

      function mcpGroupsSignature(items) {
        return JSON.stringify(cloneMcpGroups(items));
      }

      function getProbeByServerIdx(idx) {
        var server = mcpServers[idx];
        if (!server || !server.id) { return undefined; }
        for (var i = 0; i < mcpProbeResults.length; i++) {
          if (mcpProbeResults[i] && mcpProbeResults[i].serverId === server.id) {
            return mcpProbeResults[i];
          }
        }
        return undefined;
      }

      function syncMcpServersFromState(state) {
        var servers = (state.settings && state.settings.mcp && state.settings.mcp.servers) || [];
        var groups = (state.settings && state.settings.mcp && state.settings.mcp.groups) || [];
        // 保留仍存在的服务器的探测结果（按 serverId 匹配，不依赖索引）
        var oldProbeResults = mcpProbeResults;
        var newServerIds = new Set(cloneMcpServers(servers).map(function(s) { return s.id; }));
        mcpServers = cloneMcpServers(servers);
        mcpGroups = cloneMcpGroups(groups);
        mcpProbeResults = oldProbeResults.filter(function(r) {
          return r && r.serverId && newServerIds.has(r.serverId);
        });
        if (expandedToolServerIdx >= mcpServers.length) {
          expandedToolServerIdx = -1;
        }
      }

      function renderMcp() {
        var strings = runtimeState.strings || {};
        dom.mcpMaxToolRoundsTitle.textContent = strings.mcpMaxToolRoundsTitle || '';
        dom.mcpMaxToolRoundsHelp.textContent = strings.mcpMaxToolRoundsHelp || '';
        dom.mcpSaveToolRoundsBtn.textContent = strings.saveAction || 'Save';
        dom.mcpServersTitle.textContent = strings.mcpServersTitle || '';
        dom.mcpAddServerBtn.textContent = strings.mcpAddServerAction || '+ Add Server';
        dom.mcpAddGroupBtn.textContent = strings.mcpAddGroupAction || '+ Add Group';
        var settings = runtimeState.settings || {};
        var mcp = settings.mcp || {};
        dom.mcpMaxToolRounds.value = String(typeof mcp.maxToolRounds === 'number' ? mcp.maxToolRounds : 5);
        renderMcpGroups();
        renderMcpServerList();
      }

      function renderMcpGroups() {
        var strings = runtimeState.strings || {};
        if (!mcpGroups.length) {
          dom.mcpGroupList.textContent = '';
          return;
        }
        // Safe: all user content escaped via escapeHtml(); expandIcon is a static arrow character
        dom.mcpGroupList.innerHTML = mcpGroups.map((group) => {
          var isExpanded = expandedGroupIds.has(group.id);
          var expandIcon = isExpanded ? '▼' : '▶';
          var groupServers = mcpServers.filter((s) => s.groupId === group.id);
          var serverCountText = groupServers.length + ' server' + (groupServers.length !== 1 ? 's' : '');
          return (
            '<div class="mcp-group-card" data-group-id="' + escapeHtml(group.id) + '">' +
              '<div class="mcp-group-header">' +
                '<span class="mcp-group-expand" data-mcp-action="toggle-group">' + expandIcon + '</span>' +
                '<span class="mcp-group-name">' + escapeHtml(group.name) + '</span>' +
                '<span class="mcp-group-count">' + escapeHtml(serverCountText) + '</span>' +
                '<label class="mcp-server-toggle">' +
                  '<input type="checkbox" data-mcp-group-toggle="' + escapeHtml(group.id) + '" ' + (group.enabled ? 'checked' : '') + ' />' +
                  '<span>' + escapeHtml(strings.mcpServerEnabledLabel || '') + '</span>' +
                '</label>' +
                '<div class="mcp-server-actions">' +
                  '<button class="btn-danger" data-mcp-action="delete-group" data-group-id="' + escapeHtml(group.id) + '" type="button">' + escapeHtml(strings.mcpDeleteServerAction || 'Delete') + '</button>' +
                '</div>' +
              '</div>' +
              (isExpanded ? renderMcpServersForGroup(group.id) : '') +
            '</div>'
          );
        }).join('');
      }

      function renderMcpServersForGroup(groupId) {
        var strings = runtimeState.strings || {};
        var groupServers = mcpServers.filter((s) => s.groupId === groupId);
        if (!groupServers.length) {
          return '<div class="mcp-group-servers-empty">' + escapeHtml(strings.mcpEmptyState || '') + '</div>';
        }
        return '<div class="mcp-group-servers">' + groupServers.map((server) => {
          var idx = mcpServers.indexOf(server);
          var probe = getProbeByServerIdx(idx);
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
          var moveOptions = mcpGroups.map((g) => '<option value="' + escapeHtml(g.id) + '"' + (g.id === groupId ? ' selected' : '') + '>' + escapeHtml(g.name) + '</option>').join('') +
            '<option value="">' + escapeHtml(strings.mcpUngroupedLabel || 'Ungrouped') + '</option>';
          return (
            '<div class="mcp-server-card mcp-server-in-group" data-idx="' + idx + '">' +
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
              '<div class="mcp-server-move-row">' +
                '<label>' + escapeHtml(strings.mcpMoveToGroup || 'Move to') + '</label>' +
                '<select data-mcp-move-idx="' + idx + '">' + moveOptions + '</select>' +
              '</div>' +
              toolsHtml +
            '</div>'
          );
        }).join('') + '</div>';
      }

      function renderMcpServerList() {
        var strings = runtimeState.strings || {};
        var lastProbeAt = runtimeState.mcpLastProbeAt || 0;
        var lastProbeBanner = '';
        var lastProbeText = '';
        if (lastProbeAt > 0) {
          var d = new Date(lastProbeAt);
          var label = strings.mcpLastProbeAt || 'Last probed: {time}';
          lastProbeText = label.replace('{time}', d.toLocaleString());
          lastProbeBanner = '<div class="help mcp-last-probe">' + escapeHtml(lastProbeText) + '</div>';
        }
        var ungroupedServers = mcpServers.filter((s) => !s.groupId);
        if (!mcpServers.length && !mcpGroups.length) {
          dom.mcpServerList.textContent = '';
          if (lastProbeBanner) {
            var probeDiv = document.createElement('div');
            probeDiv.className = 'help mcp-last-probe';
            probeDiv.textContent = lastProbeText;
            dom.mcpServerList.appendChild(probeDiv);
          }
          var emptyDiv = document.createElement('div');
          emptyDiv.className = 'help';
          emptyDiv.textContent = strings.mcpEmptyState || '';
          dom.mcpServerList.appendChild(emptyDiv);
          return;
        }
        if (!ungroupedServers.length) {
          dom.mcpServerList.textContent = '';
          if (lastProbeBanner) {
            var probeDiv2 = document.createElement('div');
            probeDiv2.className = 'help mcp-last-probe';
            probeDiv2.textContent = lastProbeText;
            dom.mcpServerList.appendChild(probeDiv2);
          }
          return;
        }
        var ungroupedLabel = strings.mcpUngroupedServers || 'Ungrouped Servers';
        // Safe: all user content escaped via escapeHtml(); lastProbeBanner uses escapeHtml() for its text
        dom.mcpServerList.innerHTML = lastProbeBanner +
          '<div class="mcp-ungrouped-section">' +
          '<h3 class="mcp-ungrouped-title">' + escapeHtml(ungroupedLabel) + '</h3>' +
          ungroupedServers.map((server) => {
            var idx = mcpServers.indexOf(server);
            var probe = getProbeByServerIdx(idx);
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
            var moveOptions = mcpGroups.map((g) => '<option value="' + escapeHtml(g.id) + '">' + escapeHtml(g.name) + '</option>').join('');
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
                (moveOptions ? '<div class="mcp-server-move-row"><label>' + escapeHtml(strings.mcpMoveToGroup || 'Move to') + '</label><select data-mcp-move-idx="' + idx + '"><option value="">' + escapeHtml(strings.mcpUngroupedLabel || 'Ungrouped') + '</option>' + moveOptions + '</select></div>' : '') +
                toolsHtml +
              '</div>'
            );
          }).join('') +
          '</div>';
      }

      function renderMcpToolsSection(idx) {
        var strings = runtimeState.strings || {};
        if (idx !== expandedToolServerIdx) { return ''; }
        var probe = getProbeByServerIdx(idx);
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

      function autoSaveMcpGroups() {
        var settings = runtimeState.settings || {};
        var mcp = settings.mcp || {};
        vscode.postMessage({
          type: 'saveMcpServers',
          payload: {
            servers: cloneMcpServers(mcpServers),
            groups: cloneMcpGroups(mcpGroups),
            maxToolRounds: typeof mcp.maxToolRounds === 'number' ? mcp.maxToolRounds : 5
          }
        });
      }

      function addMcpGroup() {
        vscode.postMessage({ type: 'requestAddMcpGroup' });
      }

      function deleteMcpGroup(groupId) {
        var group = mcpGroups.find((g) => g.id === groupId);
        if (!group) { return; }
        vscode.postMessage({ type: 'requestDeleteMcpGroup', payload: { groupId: groupId, groupName: group.name } });
      }

      function doDeleteMcpGroup(groupId) {
        for (var i = 0; i < mcpServers.length; i++) {
          if (mcpServers[i].groupId === groupId) {
            mcpServers[i].groupId = undefined;
          }
        }
        mcpGroups = mcpGroups.filter((g) => g.id !== groupId);
        expandedGroupIds.delete(groupId);
        renderMcpGroups();
        renderMcpServerList();
        autoSaveMcpGroups();
      }

      function toggleGroupExpand(groupId) {
        if (expandedGroupIds.has(groupId)) {
          expandedGroupIds.delete(groupId);
        } else {
          expandedGroupIds.add(groupId);
        }
        renderMcpGroups();
      }

      function moveServerToGroup(serverIdx, groupId) {
        if (serverIdx < 0 || serverIdx >= mcpServers.length) { return; }
        mcpServers[serverIdx].groupId = groupId || undefined;
        renderMcpGroups();
        renderMcpServerList();
        autoSaveMcpGroups();
      }
`;
}
