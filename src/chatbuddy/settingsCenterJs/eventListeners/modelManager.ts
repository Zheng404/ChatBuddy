/**
 * Model list management event listeners.
 */
export function getModelManagerJs(): string {
  return `
      // Manual models list
      dom.manualModelsList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const actionTarget = target.closest('[data-model-action]');
        if (!(actionTarget instanceof HTMLElement)) {
          return;
        }
        const action = actionTarget.getAttribute('data-model-action');
        const modelId = actionTarget.getAttribute('data-model-id');
        const provider = getEditingProvider();
        if (!provider || !action || !modelId) {
          return;
        }
        if (action === 'edit') {
          openManualModelModal('edit', modelId);
          return;
        }
        if (action === 'delete') {
          removeProviderModel(provider.id, modelId);
        }
        renderAll();
      });

      // Fetched models list
      dom.fetchedModelsList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        const actionTarget = target.closest('[data-model-action]');
        if (!(actionTarget instanceof HTMLElement)) {
          return;
        }
        const action = actionTarget.getAttribute('data-model-action');
        const modelId = actionTarget.getAttribute('data-model-id');
        const provider = getEditingProvider();
        if (!provider || !action || !modelId) {
          return;
        }
        if (action === 'edit') {
          openManualModelModal('edit', modelId);
          return;
        }
        if (action === 'delete') {
          removeProviderModel(provider.id, modelId);
        }
        renderAll();
      });
`;
}
