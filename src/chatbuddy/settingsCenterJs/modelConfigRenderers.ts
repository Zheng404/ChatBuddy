/**
 * Shared rendering helpers for the model config section of the settings center webview.
 * Provider-specific rendering in modelConfigProviderRenderer.ts,
 * model-specific rendering in modelConfigModelsRenderer.ts.
 */
export function getModelConfigRenderersJs(): string {
  return `
      function renderModelEmptyState(messageKey) {
        return '<div class="model-empty">' + escapeHtml(runtimeState.strings[messageKey] || '') + '</div>';
      }

      function renderKindPill(kind) {
        var effectiveKind = kind || 'chat';
        var label = getKindLabel(effectiveKind);
        if (!label) {
          return '';
        }
        return '<span class="kind-pill kind-' + effectiveKind + '">' + escapeHtml(label) + '</span>';
      }

      function renderCapabilityPills(capabilities, interactivePrefix) {
        const caps = capabilities || {};
        return getCapabilityDescriptors()
          .map((cap) => {
            const active = caps[cap.key] ? ' active' : '';
            const attrs = interactivePrefix
              ? ' data-' + interactivePrefix + '-cap="' + escapeHtml(cap.key) + '"'
              : '';
            const checkCls = interactivePrefix ? ' cap-check' : '';
            return (
              '<button class="cap-pill ' +
              cap.cls +
              active +
              checkCls +
              '" type="button"' +
              attrs +
              ' title="' +
              escapeHtml(cap.label) +
              '">' +
              escapeHtml(cap.label) +
              '</button>'
            );
          })
          .join('');
      }

      function renderCapabilitySummary(capabilities) {
        const caps = capabilities || {};
        const activeCaps = getCapabilityDescriptors().filter((cap) => caps[cap.key]);
        if (!activeCaps.length) {
          return '<span class="help">' + escapeHtml(runtimeState.strings.noneOption || '') + '</span>';
        }
        return activeCaps
          .map((cap) => {
            return (
              '<span class="cap-pill ' +
              cap.cls +
              ' active" title="' +
              escapeHtml(cap.label) +
              '">' +
              escapeHtml(cap.label) +
              '</span>'
            );
          })
          .join('');
      }

      function renderEditorTabs() {
        const strings = runtimeState.strings || {};
        dom.editorTabConfig.textContent = strings.providerConfigSectionTitle || 'Config';
        dom.editorTabModels.textContent = strings.providerModelsSectionTitle || 'Models';
        dom.editorTabConfig.classList.toggle('active', editorTab === 'config');
        dom.editorTabModels.classList.toggle('active', editorTab === 'models');
      }

      function renderEditorTabVisibility() {
        const panes = document.querySelectorAll('.editor-pane');
        for (const pane of panes) {
          pane.classList.toggle('active', pane.getAttribute('data-tab') === editorTab);
        }
      }
`;
}
