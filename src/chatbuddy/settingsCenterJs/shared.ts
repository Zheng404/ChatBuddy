/**
 * Shared variables, utilities, and navigation for the settings center webview.
 * Must be loaded first as other modules depend on these declarations.
 */
export function getSharedJs(): string {
  return `
      const vscode = acquireVsCodeApi();
      const dom = {
        navHeading: document.getElementById('navHeading'),
        navModelConfig: document.getElementById('navModelConfig'),
        navModelConfigTitle: document.getElementById('navModelConfigTitle'),
        navModelConfigDescription: document.getElementById('navModelConfigDescription'),
        navDefaultModels: document.getElementById('navDefaultModels'),
        navDefaultModelsTitle: document.getElementById('navDefaultModelsTitle'),
        navDefaultModelsDescription: document.getElementById('navDefaultModelsDescription'),
        navGeneral: document.getElementById('navGeneral'),
        navGeneralTitle: document.getElementById('navGeneralTitle'),
        navGeneralDescription: document.getElementById('navGeneralDescription'),
        paneModelConfig: document.getElementById('paneModelConfig'),
        paneDefaultModels: document.getElementById('paneDefaultModels'),
        paneGeneral: document.getElementById('paneGeneral'),
        languageSectionTitle: document.getElementById('languageSectionTitle'),

        languageHelp: document.getElementById('languageHelp'),
        sendShortcutSectionTitle: document.getElementById('sendShortcutSectionTitle'),

        sendShortcutHelp: document.getElementById('sendShortcutHelp'),
        chatTabModeSectionTitle: document.getElementById('chatTabModeSectionTitle'),

        chatTabModeHelp: document.getElementById('chatTabModeHelp'),
        dataTransferSectionTitle: document.getElementById('dataTransferSectionTitle'),
        dataTransferDescription: document.getElementById('dataTransferDescription'),
        dangerSectionTitle: document.getElementById('dangerSectionTitle'),
        resetDataDescription: document.getElementById('resetDataDescription'),
        exportBtn: document.getElementById('exportBtn'),
        importBtn: document.getElementById('importBtn'),
        resetBtn: document.getElementById('resetBtn'),
        locale: document.getElementById('locale'),
        sendShortcut: document.getElementById('sendShortcut'),
        chatTabMode: document.getElementById('chatTabMode'),
        defaultAssistantModelLabel: document.getElementById('defaultAssistantModelLabel'),
        defaultAssistantModel: document.getElementById('defaultAssistantModel'),
        defaultAssistantModelHelp: document.getElementById('defaultAssistantModelHelp'),
        defaultTitleSummaryModelLabel: document.getElementById('defaultTitleSummaryModelLabel'),
        defaultTitleSummaryModel: document.getElementById('defaultTitleSummaryModel'),
        defaultTitleSummaryModelHelp: document.getElementById('defaultTitleSummaryModelHelp'),
        editTitleSummaryPromptBtn: document.getElementById('editTitleSummaryPromptBtn'),
        titleSummaryPromptModal: document.getElementById('titleSummaryPromptModal'),
        titleSummaryPromptModalTitle: document.getElementById('titleSummaryPromptModalTitle'),
        titleSummaryPromptModalDescription: document.getElementById('titleSummaryPromptModalDescription'),
        titleSummaryPromptModalTextarea: document.getElementById('titleSummaryPromptModalTextarea'),
        cancelTitleSummaryPromptBtn: document.getElementById('cancelTitleSummaryPromptBtn'),
        resetTitleSummaryPromptBtn: document.getElementById('resetTitleSummaryPromptBtn'),
        saveTitleSummaryPromptBtn: document.getElementById('saveTitleSummaryPromptBtn'),
        addProviderBtn: document.getElementById('addProviderBtn'),
        providerSearch: document.getElementById('providerSearch'),
        providerList: document.getElementById('providerList'),
        providerPanelTitle: document.getElementById('providerPanelTitle'),
        saveProviderBtn: document.getElementById('saveProviderBtn'),
        testConnectionBtn: document.getElementById('testConnectionBtn'),
        fetchModelsBtn: document.getElementById('fetchModelsBtn'),
        deleteProviderBtn: document.getElementById('deleteProviderBtn'),
        providerNameLabel: document.getElementById('providerNameLabel'),
        apiTypeLabel: document.getElementById('apiTypeLabel'),
        apiKeyLabel: document.getElementById('apiKeyLabel'),
        baseUrlLabel: document.getElementById('baseUrlLabel'),
        baseUrlHelp: document.getElementById('baseUrlHelp'),
        providerName: document.getElementById('providerName'),
        apiType: document.getElementById('apiType'),
        apiKey: document.getElementById('apiKey'),
        baseUrl: document.getElementById('baseUrl'),
        modelsPanelTitle: document.getElementById('modelsPanelTitle'),
        modelsHelp: document.getElementById('modelsHelp'),
        modelsList: document.getElementById('modelsList'),
        testModelModal: document.getElementById('testModelModal'),
        testModelModalTitle: document.getElementById('testModelModalTitle'),
        testModelModalDescription: document.getElementById('testModelModalDescription'),
        testModelModalLabel: document.getElementById('testModelModalLabel'),
        testModelModalSelect: document.getElementById('testModelModalSelect'),
        cancelTestModelBtn: document.getElementById('cancelTestModelBtn'),
        confirmTestModelBtn: document.getElementById('confirmTestModelBtn'),
        discardChangesModal: document.getElementById('discardChangesModal'),
        discardChangesModalTitle: document.getElementById('discardChangesModalTitle'),
        discardChangesModalDescription: document.getElementById('discardChangesModalDescription'),
        discardChangesStayBtn: document.getElementById('discardChangesStayBtn'),
        discardChangesConfirmBtn: document.getElementById('discardChangesConfirmBtn'),
        navMcp: document.getElementById('navMcp'),
        navMcpTitle: document.getElementById('navMcpTitle'),
        navMcpDescription: document.getElementById('navMcpDescription'),
        paneMcp: document.getElementById('paneMcp'),
        mcpMaxToolRoundsTitle: document.getElementById('mcpMaxToolRoundsTitle'),

        mcpMaxToolRoundsHelp: document.getElementById('mcpMaxToolRoundsHelp'),
        mcpMaxToolRounds: document.getElementById('mcpMaxToolRounds'),
        mcpSaveToolRoundsBtn: document.getElementById('mcpSaveToolRoundsBtn'),
        mcpServersTitle: document.getElementById('mcpServersTitle'),
        mcpServerList: document.getElementById('mcpServerList'),
        mcpAddServerBtn: document.getElementById('mcpAddServerBtn'),
        mcpServerModal: document.getElementById('mcpServerModal'),
        mcpServerModalTitle: document.getElementById('mcpServerModalTitle'),
        mcpServerModalDescription: document.getElementById('mcpServerModalDescription'),
        mcpModalNameLabel: document.getElementById('mcpModalNameLabel'),
        mcpModalTransportLabel: document.getElementById('mcpModalTransportLabel'),
        mcpModalName: document.getElementById('mcpModalName'),
        mcpModalTransport: document.getElementById('mcpModalTransport'),
        mcpModalCancelBtn: document.getElementById('mcpModalCancelBtn'),
        mcpModalSaveBtn: document.getElementById('mcpModalSaveBtn'),
        toastStack: document.getElementById('toastStack')
      };

      let runtimeState = {
        strings: {},
        activeSection: 'general',
        languageOptions: [],
        sendShortcutOptions: [],
        chatTabModeOptions: [],
        settings: {
          providers: [],
          defaultModels: {},
          locale: 'auto',
          sendShortcut: 'enter',
          chatTabMode: 'single'
        },
        modelOptions: [],
        invalidDefaultSelection: '',
        notice: '',
        noticeTone: 'info'
      };
      let activeSection = 'general';
      let providers = [];
      let persistedProvidersById = {};
      let dirtyProviderIds = new Set();
      let fetchedModelsByProvider = {};
      let testModelByProviderId = {};
      let testModelModalProviderId = '';
      let discardModalResolver = null;
      let providerEditorId = '';
      let searchKeyword = '';
      let lastToastNotice = '';
      let mcpServers = [];
      let mcpModalMode = 'add';
      let mcpModalEditIdx = -1;
      let mcpModalDraft = null;
      let mcpProbeResults = [];
      let expandedToolServerIdx = -1;
`;
}

/**
 * Shared utility functions and navigation rendering.
 */
export function getSharedUtilsJs(toastScript: string): string {
  return `
      ${toastScript}

      function escapeHtml(input) {
        return String(input)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function normalizeSectionValue(section) {
        return section === 'modelConfig' || section === 'defaultModels' || section === 'general' || section === 'mcp' ? section : 'general';
      }

      function renderNav() {
        const strings = runtimeState.strings || {};
        dom.navHeading.textContent = strings.settingsViewTitle || '';
        dom.navModelConfigTitle.textContent = strings.modelConfigTitle || '';
        dom.navModelConfigDescription.textContent = strings.modelConfigDescription || '';
        dom.navDefaultModelsTitle.textContent = strings.defaultModelsTitle || '';
        dom.navDefaultModelsDescription.textContent = strings.defaultModelsDescription || '';
        dom.navGeneralTitle.textContent = strings.settingsTitle || '';
        dom.navGeneralDescription.textContent = strings.settingsDescription || '';
        dom.navMcpTitle.textContent = strings.mcpTitle || 'MCP';
        dom.navMcpDescription.textContent = strings.mcpDescription || '';

        const items = [dom.navModelConfig, dom.navDefaultModels, dom.navMcp, dom.navGeneral];
        for (const item of items) {
          const isActive = item.getAttribute('data-section') === activeSection;
          item.classList.toggle('active', isActive);
          item.setAttribute('aria-current', isActive ? 'page' : 'false');
        }
      }

      function renderSectionVisibility() {
        const panes = [dom.paneModelConfig, dom.paneDefaultModels, dom.paneGeneral, dom.paneMcp];
        for (const pane of panes) {
          const isActive = pane.getAttribute('data-section') === activeSection;
          pane.classList.toggle('active', isActive);
        }
      }

      function activateSection(section, notifyHost) {
        activeSection = normalizeSectionValue(section);
        renderNav();
        renderSectionVisibility();
        if (notifyHost) {
          vscode.postMessage({
            type: 'switchSection',
            section: activeSection
          });
        }
      }
`;
}
