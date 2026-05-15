/**
 * Templates section event listeners.
 * Handles rename/delete actions on the top-level templates settings page.
 */
export function getTemplatesListenersJs(): string {
  return `
      // Template actions (rename / delete)
      if (dom.templatesListContainer) {
        dom.templatesListContainer.addEventListener('click', (event) => {
          var target = event.target;
          if (!(target instanceof HTMLElement)) { return; }
          var actionEl = target.closest('[data-template-action]');
          if (!actionEl) { return; }
          var action = actionEl.getAttribute('data-template-action');
          var templateId = actionEl.getAttribute('data-template-id');
          if (!templateId) { return; }
          var template = (runtimeState.templates || []).find(function(t) { return t && t.id === templateId; });
          if (!template) { return; }
          if (action === 'rename') {
            vscode.postMessage({ type: 'renameTemplate', templateId: templateId, currentName: template.name || '' });
          } else if (action === 'delete') {
            vscode.postMessage({ type: 'deleteTemplate', templateId: templateId, templateName: template.name || '' });
          }
        });
      }
`;
}
