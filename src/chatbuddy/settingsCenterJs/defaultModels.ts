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
        // Safe: buildModelSelectOptions escapes all values via escapeHtml()
        dom.defaultAssistantModel.innerHTML = buildModelSelectOptions(invalidRef);
        dom.defaultAssistantModel.value = currentRef || '';
        dom.defaultAssistantModelHelp.textContent = invalidRef ? strings.invalidDefaultModelHint || '' : '';
        dom.defaultAssistantModelHelp.className = invalidRef ? 'help invalid' : 'help';

        // Title summary section
        dom.defaultTitleSummaryModelLabel.textContent = strings.defaultTitleSummaryModelLabel || '';

        const titleSummaryRef =
          defaults.titleSummary && defaults.titleSummary.providerId && defaults.titleSummary.modelId
            ? defaults.titleSummary.providerId + ':' + defaults.titleSummary.modelId
            : '';
        // Safe: buildModelSelectOptions escapes all values via escapeHtml()
        dom.defaultTitleSummaryModel.innerHTML = buildModelSelectOptions('');
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
        openModal(dom.titleSummaryPromptModal, dom.titleSummaryPromptModalTextarea);
      }

      function closeTitleSummaryPromptModal() {
        closeModal(dom.titleSummaryPromptModal);
      }
`;
}
