/**
 * Navigation event listeners.
 */
export function getNavJs(): string {
  return `
      // Main navigation
      dom.navModelConfig.addEventListener('click', () => {
        activateSection('modelConfig', true);
      });
      dom.navDefaultModels.addEventListener('click', () => {
        activateSection('defaultModels', true);
      });
      dom.navGeneral.addEventListener('click', () => {
        activateSection('general', true);
      });
      dom.navMcp.addEventListener('click', () => {
        activateSection('mcp', true);
      });
      dom.navDataManagement.addEventListener('click', () => {
        activateSection('dataManagement', true);
      });
      dom.navAbout.addEventListener('click', () => {
        activateSection('about', true);
      });

      // Editor sub-tabs (provider config / models)
      dom.editorTabConfig.addEventListener('click', () => {
        switchEditorTab('config');
      });
      dom.editorTabModels.addEventListener('click', () => {
        switchEditorTab('models');
      });
`;
}
