/**
 * Templates section rendering functions.
 * Extracted from dataManagement.ts for the top-level templates settings page.
 */

export function getTemplatesJs(): string {
  return `
      function renderTemplatesText() {
        renderTemplatesSection();
      }

      function renderTemplatesSection() {
        var strings = runtimeState.strings || {};
        if (dom.navTemplatesTitle) {
          dom.navTemplatesTitle.textContent = strings.navTemplatesTitle || 'Templates';
        }
        if (dom.templatesSectionTitle) {
          dom.templatesSectionTitle.textContent = strings.templatesSectionTitle || 'Templates';
        }
        if (dom.templatesSectionDescription) {
          dom.templatesSectionDescription.textContent = strings.templatesSectionDescription || '';
        }
        if (!dom.templatesListContainer) { return; }
        var templates = (runtimeState.templates) || [];
        if (!templates.length) {
          dom.templatesListContainer.innerHTML = '<div class="help">' + escapeHtml(strings.templatesEmpty || 'No templates yet.') + '</div>';
          return;
        }
        var html = '';
        for (var i = 0; i < templates.length; i++) {
          var t = templates[i] || {};
          html += '<div class="backup-item">'
            + '<div class="backup-item-info">'
            + '<span class="backup-item-name">' + escapeHtml(t.name || '') + '</span>'
            + '<span class="backup-item-meta">' + escapeHtml(t.description || '') + (t.updatedAt ? (t.description ? ' &middot; ' : '') + formatDate(new Date(t.updatedAt).toISOString()) : '') + '</span>'
            + '</div>'
            + '<div class="backup-item-actions">'
            + '<button class="btn-secondary" data-template-action="rename" data-template-id="' + escapeHtml(t.id || '') + '">' + escapeHtml(strings.templateRename || 'Rename') + '</button>'
            + '<button class="btn-danger" data-template-action="delete" data-template-id="' + escapeHtml(t.id || '') + '">' + escapeHtml(strings.templateDelete || 'Delete') + '</button>'
            + '</div>'
            + '</div>';
        }
        dom.templatesListContainer.innerHTML = html;
      }
`;
}
