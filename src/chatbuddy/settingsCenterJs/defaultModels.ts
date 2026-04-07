/**
 * Default models section and title summary prompt modal functions.
 */
export function getDefaultModelsJs(defaultTitleSummaryPrompt: string): string {
  const escapedPrompt = JSON.stringify(defaultTitleSummaryPrompt);
  return `
      function renderDefaultModels() {
        const strings = runtimeState.strings || {};
        dom.defaultAssistantModelLabel.textContent = strings.defaultAssistantModelLabel || '';

        const defaults = (runtimeState.settings && runtimeState.settings.defaultModels) || {};
        const currentRef =
          defaults.assistant && defaults.assistant.providerId && defaults.assistant.modelId
            ? defaults.assistant.providerId + ':' + defaults.assistant.modelId
            : '';
        const invalidRef = runtimeState.invalidDefaultSelection || '';
        const options = [{ ref: '', label: strings.noneOption || '' }]
          .concat((runtimeState.modelOptions || []).map((option) => {
            const caps = option.capabilities;
            const capSuffix =
              caps && (caps.vision || caps.reasoning || caps.audio || caps.video || caps.tools)
                ? ' [' +
                  [
                    caps.vision ? strings.capabilityVision : '',
                    caps.reasoning ? strings.capabilityReasoning : '',
                    caps.audio ? strings.capabilityAudio : '',
                    caps.video ? strings.capabilityVideo : '',
                    caps.tools ? strings.capabilityTools : ''
                  ]
                    .filter(Boolean)
                    .join(', ') +
                  ']'
                : '';
            return {
              ref: option.ref,
              label: option.label + capSuffix
            };
          }))
          .concat(invalidRef ? [{ ref: invalidRef, label: invalidRef + ' (' + strings.modelUnavailableShort + ')' }] : []);
        const seen = new Set();
        dom.defaultAssistantModel.innerHTML = options
          .filter((option) => {
            if (seen.has(option.ref)) {
              return false;
            }
            seen.add(option.ref);
            return true;
          })
          .map((option) => '<option value="' + escapeHtml(option.ref) + '">' + escapeHtml(option.label) + '</option>')
          .join('');
        dom.defaultAssistantModel.value = currentRef || '';
        dom.defaultAssistantModelHelp.textContent = invalidRef ? strings.invalidDefaultModelHint || '' : '';
        dom.defaultAssistantModelHelp.className = invalidRef ? 'help invalid' : 'help';

        // Title summary section
        dom.defaultTitleSummaryModelLabel.textContent = strings.defaultTitleSummaryModelLabel || '';

        const titleSummaryRef =
          defaults.titleSummary && defaults.titleSummary.providerId && defaults.titleSummary.modelId
            ? defaults.titleSummary.providerId + ':' + defaults.titleSummary.modelId
            : '';
        const seenTs = new Set();
        dom.defaultTitleSummaryModel.innerHTML = options
          .filter((option) => {
            if (seenTs.has(option.ref)) {
              return false;
            }
            seenTs.add(option.ref);
            return true;
          })
          .map((option) => '<option value="' + escapeHtml(option.ref) + '">' + escapeHtml(option.label) + '</option>')
          .join('');
        dom.defaultTitleSummaryModel.value = titleSummaryRef || '';
        dom.defaultTitleSummaryModelHelp.textContent = '';
        dom.defaultTitleSummaryModelHelp.className = 'help';

        // Prompt modal button and labels
        dom.editTitleSummaryPromptBtn.textContent = strings.editTitleSummaryPromptAction || '';
        dom.titleSummaryPromptModalTitle.textContent = strings.titleSummaryPromptModalTitle || '';
        dom.titleSummaryPromptModalDescription.textContent = strings.titleSummaryPromptModalDescription || '';
        dom.cancelTitleSummaryPromptBtn.textContent = strings.cancelAction || 'Cancel';
        dom.resetTitleSummaryPromptBtn.textContent = strings.resetToDefaultAction || 'Reset to Default';
        dom.saveTitleSummaryPromptBtn.textContent = strings.saveAction || 'Save';
      }

      // Title summary prompt modal
      function openTitleSummaryPromptModal() {
        const defaults = (runtimeState.settings && runtimeState.settings.defaultModels) || {};
        dom.titleSummaryPromptModalTextarea.value = defaults.titleSummaryPrompt || ${escapedPrompt};
        dom.titleSummaryPromptModal.classList.add('visible');
        dom.titleSummaryPromptModal.setAttribute('aria-hidden', 'false');
        dom.titleSummaryPromptModalTextarea.focus();
      }

      function closeTitleSummaryPromptModal() {
        dom.titleSummaryPromptModal.classList.remove('visible');
        dom.titleSummaryPromptModal.setAttribute('aria-hidden', 'true');
      }
`;
}
