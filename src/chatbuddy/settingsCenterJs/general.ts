/**
 * General settings section rendering functions.
 */
export function getGeneralJs(): string {
  return `
      function renderGeneralText() {
        const strings = runtimeState.strings || {};
        dom.languageSectionTitle.textContent = strings.languageSection || '';

        dom.languageHelp.textContent = strings.languageHelp || '';
        dom.sendShortcutSectionTitle.textContent = strings.sendShortcutSection || '';

        dom.sendShortcutHelp.textContent = strings.sendShortcutHelp || '';
        dom.chatTabModeSectionTitle.textContent = strings.chatTabModeSection || '';

        dom.chatTabModeHelp.textContent = strings.chatTabModeHelp || '';
        dom.dataTransferSectionTitle.textContent = strings.dataTransferSectionTitle || '';
        dom.dataTransferDescription.textContent = strings.dataTransferDescription || '';
        dom.dangerSectionTitle.textContent = strings.dangerSectionTitle || '';
        dom.resetDataDescription.textContent = strings.resetDataDescription || '';
        dom.exportBtn.textContent = strings.exportDataAction || '';
        dom.importBtn.textContent = strings.importDataAction || '';
        dom.resetBtn.textContent = strings.resetDataAction || '';
      }

      function renderSelectOptions(select, options) {
        select.innerHTML = (Array.isArray(options) ? options : [])
          .map((option) => '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</option>')
          .join('');
      }

      function renderGeneralValues() {
        const settings = runtimeState.settings || {};
        renderSelectOptions(dom.locale, runtimeState.languageOptions);
        renderSelectOptions(dom.sendShortcut, runtimeState.sendShortcutOptions);
        renderSelectOptions(dom.chatTabMode, runtimeState.chatTabModeOptions);
        dom.locale.value = settings.locale || 'auto';
        dom.sendShortcut.value = settings.sendShortcut || 'enter';
        dom.chatTabMode.value = settings.chatTabMode || 'single';
      }
`;
}
