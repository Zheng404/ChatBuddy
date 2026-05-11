/**
 * MCP (Model Context Protocol) event listeners.
 */
export function getMcpJs(): string {
  return `
      // MCP event bindings
      dom.mcpSaveToolRoundsBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'saveMcpToolRounds',
          payload: { maxToolRounds: parseInt(dom.mcpMaxToolRounds.value, 10) || 5 }
        });
      });

      dom.mcpAddServerBtn.addEventListener('click', () => {
        openMcpServerModal('add', -1);
      });

      dom.mcpAddGroupBtn.addEventListener('click', () => {
        addMcpGroup();
      });

      dom.mcpGroupList.addEventListener('click', (event) => {
        var target = event.target;
        if (!(target instanceof HTMLElement)) { return; }
        var action = target.getAttribute('data-mcp-action');
        if (action === 'toggle-group') {
          var groupCard = target.closest('.mcp-group-card');
          if (!groupCard) { return; }
          var groupId = groupCard.getAttribute('data-group-id');
          if (groupId) { toggleGroupExpand(groupId); }
          return;
        }
        if (action === 'delete-group') {
          var groupId = target.getAttribute('data-group-id');
          if (groupId) { deleteMcpGroup(groupId); }
          return;
        }
        var card = target.closest('.mcp-server-card');
        if (!card) { return; }
        var idx = parseInt(card.getAttribute('data-idx'), 10);
        if (isNaN(idx) || idx < 0 || idx >= mcpServers.length) { return; }
        if (action === 'test') {
          if (!mcpServers[idx].enabled) { return; }
          vscode.postMessage({
            type: 'testMcpServer',
            payload: { server: mcpServers[idx] }
          });
          return;
        }
        if (action === 'toggle-tools') {
          var probe = getProbeByServerIdx(idx);
          if (probe && probe.success) {
            expandedToolServerIdx = expandedToolServerIdx === idx ? -1 : idx;
            renderMcpGroups();
            renderMcpServerList();
          }
          return;
        }
        if (action === 'edit') {
          openMcpServerModal('edit', idx);
          return;
        }
        if (action === 'delete') {
          var server = mcpServers[idx];
          if (!server) { return; }
          vscode.postMessage({
            type: 'deleteMcpServer',
            payload: {
              serverId: server.id,
              serverName: server.name
            }
          });
          return;
        }
      });

      dom.mcpGroupList.addEventListener('change', (event) => {
        var target = event.target;
        if (!(target instanceof HTMLElement)) { return; }
        var groupToggle = target.getAttribute('data-mcp-group-toggle');
        if (groupToggle !== null && groupToggle !== undefined) {
          var group = mcpGroups.find((g) => g.id === groupToggle);
          if (group) {
            group.enabled = target.checked;
            renderMcpGroups();
            autoSaveMcpGroups();
          }
          return;
        }
        var moveIdx = target.getAttribute('data-mcp-move-idx');
        if (moveIdx !== null && moveIdx !== undefined) {
          var idx = parseInt(moveIdx, 10);
          if (!isNaN(idx) && idx >= 0 && idx < mcpServers.length) {
            var groupId = target.value || undefined;
            moveServerToGroup(idx, groupId);
          }
          return;
        }
        var toggleIdx = target.getAttribute('data-mcp-toggle-idx');
        if (toggleIdx !== null && toggleIdx !== undefined) {
          var idx = parseInt(toggleIdx, 10);
          if (isNaN(idx) || idx < 0 || idx >= mcpServers.length) { return; }
          mcpServers[idx].enabled = target.checked;
          renderMcpGroups();
          autoSaveMcpServers();
        }
      });

      dom.mcpServerList.addEventListener('click', (event) => {
        var target = event.target;
        if (!(target instanceof HTMLElement)) { return; }
        var card = target.closest('.mcp-server-card');
        if (!card) { return; }
        var idx = parseInt(card.getAttribute('data-idx'), 10);
        if (isNaN(idx) || idx < 0 || idx >= mcpServers.length) { return; }
        var action = target.getAttribute('data-mcp-action');
        if (action === 'test') {
          if (!mcpServers[idx].enabled) { return; }
          vscode.postMessage({
            type: 'testMcpServer',
            payload: { server: mcpServers[idx] }
          });
          return;
        }
        if (action === 'toggle-tools') {
          var probe = getProbeByServerIdx(idx);
          if (probe && probe.success) {
            expandedToolServerIdx = expandedToolServerIdx === idx ? -1 : idx;
            renderMcpGroups();
            renderMcpServerList();
          }
          return;
        }
        if (action === 'edit') {
          openMcpServerModal('edit', idx);
          return;
        }
        if (action === 'delete') {
          var server = mcpServers[idx];
          if (!server) { return; }
          vscode.postMessage({
            type: 'deleteMcpServer',
            payload: {
              serverId: server.id,
              serverName: server.name
            }
          });
          return;
        }
      });

      dom.mcpServerList.addEventListener('change', (event) => {
        var target = event.target;
        if (!(target instanceof HTMLElement)) { return; }
        var moveIdx = target.getAttribute('data-mcp-move-idx');
        if (moveIdx !== null && moveIdx !== undefined) {
          var idx = parseInt(moveIdx, 10);
          if (!isNaN(idx) && idx >= 0 && idx < mcpServers.length) {
            var groupId = target.value || undefined;
            moveServerToGroup(idx, groupId);
          }
          return;
        }
        if (!(target instanceof HTMLInputElement)) { return; }
        var toggleIdx = target.getAttribute('data-mcp-toggle-idx');
        if (toggleIdx === null || toggleIdx === undefined) { return; }
        var idx = parseInt(toggleIdx, 10);
        if (isNaN(idx) || idx < 0 || idx >= mcpServers.length) { return; }
        mcpServers[idx].enabled = target.checked;
        renderMcpServerList();
        autoSaveMcpServers();
      });

      dom.mcpModalTransport.addEventListener('change', () => {
        if (mcpModalDraft) {
          mcpModalDraft.transport = dom.mcpModalTransport.value || 'stdio';
          renderMcpModalFields();
        }
      });

      dom.mcpModalCancelBtn.addEventListener('click', () => {
        closeMcpServerModal();
      });

      dom.mcpModalSaveBtn.addEventListener('click', () => {
        confirmMcpServer();
      });

      dom.mcpServerModal.addEventListener('click', (event) => {
        if (event.target === dom.mcpServerModal) {
          closeMcpServerModal();
        }
      });
`;
}
