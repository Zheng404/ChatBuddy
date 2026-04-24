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
          var probe = mcpProbeResults[idx];
          if (probe && probe.success) {
            expandedToolServerIdx = expandedToolServerIdx === idx ? -1 : idx;
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
