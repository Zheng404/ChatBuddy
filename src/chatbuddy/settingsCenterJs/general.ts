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
        dom.timeoutSectionTitle.textContent = strings.timeoutSection || '';
      }

      function renderSelectOptions(select, options) {
        select.textContent = '';
        (Array.isArray(options) ? options : []).forEach((option) => {
          var opt = document.createElement('option');
          opt.value = option.value || '';
          opt.textContent = option.label || '';
          select.appendChild(opt);
        });
      }

      function renderGeneralValues() {
        const settings = runtimeState.settings || {};
        renderSelectOptions(dom.locale, runtimeState.languageOptions);
        renderSelectOptions(dom.sendShortcut, runtimeState.sendShortcutOptions);
        renderSelectOptions(dom.chatTabMode, runtimeState.chatTabModeOptions);
        renderSelectOptions(dom.timeout, runtimeState.timeoutOptions);
        dom.locale.value = settings.locale || 'auto';
        dom.sendShortcut.value = settings.sendShortcut || 'enter';
        dom.chatTabMode.value = settings.chatTabMode || 'single';
        dom.timeout.value = String(settings.timeoutMs ?? 0);
      }
`;
}
