import { getHtmlEscaperScript } from '../utils/html';

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
        navDefaultModels: document.getElementById('navDefaultModels'),
        navDefaultModelsTitle: document.getElementById('navDefaultModelsTitle'),
        navGeneral: document.getElementById('navGeneral'),
        navGeneralTitle: document.getElementById('navGeneralTitle'),
        paneModelConfig: document.getElementById('paneModelConfig'),
        paneDefaultModels: document.getElementById('paneDefaultModels'),
        paneGeneral: document.getElementById('paneGeneral'),
        languageSectionTitle: document.getElementById('languageSectionTitle'),

        languageHelp: document.getElementById('languageHelp'),
        sendShortcutSectionTitle: document.getElementById('sendShortcutSectionTitle'),

        sendShortcutHelp: document.getElementById('sendShortcutHelp'),
        chatTabModeSectionTitle: document.getElementById('chatTabModeSectionTitle'),

        chatTabModeHelp: document.getElementById('chatTabModeHelp'),
        dataTransferDescription: document.getElementById('dataTransferDescription'),
        dangerSectionTitle: document.getElementById('dangerSectionTitle'),
        resetDataDescription: document.getElementById('resetDataDescription'),
        exportBtn: document.getElementById('exportBtn'),
        importBtn: document.getElementById('importBtn'),
        importLegacyBtn: document.getElementById('importLegacyBtn'),
        resetBtn: document.getElementById('resetBtn'),
        dataTabTransfer: document.getElementById('dataTabTransfer'),
        dataTabLocal: document.getElementById('dataTabLocal'),
        backupDirLabel: document.getElementById('backupDirLabel'),
        backupDirInput: document.getElementById('backupDirInput'),
        browseBackupDirBtn: document.getElementById('browseBackupDirBtn'),
        autoBackupLabel: document.getElementById('autoBackupLabel'),
        autoBackupToggle: document.getElementById('autoBackupToggle'),
        intervalLabel: document.getElementById('intervalLabel'),
        intervalInput: document.getElementById('intervalInput'),
        maxCountLabel: document.getElementById('maxCountLabel'),
        maxCountInput: document.getElementById('maxCountInput'),
        maxAgeLabel: document.getElementById('maxAgeLabel'),
        maxAgeInput: document.getElementById('maxAgeInput'),
        manualBackupTitle: document.getElementById('manualBackupTitle'),
        triggerBackupBtn: document.getElementById('triggerBackupBtn'),
        refreshBackupListBtn: document.getElementById('refreshBackupListBtn'),
        backupHistoryTitle: document.getElementById('backupHistoryTitle'),
        backupListContainer: document.getElementById('backupListContainer'),
        autoBackupSectionTitle: document.getElementById('autoBackupSectionTitle'),
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
        providerSaveStatus: document.getElementById('providerSaveStatus'),
        providerPanelTitle: document.getElementById('providerPanelTitle'),
        providerEmptyState: document.getElementById('providerEmptyState'),
        providerEmptyText: document.getElementById('providerEmptyText'),
        providerEnabledCheckbox: document.getElementById('providerEnabledCheckbox'),
        providerEnabledSwitchLabel: document.getElementById('providerEnabledSwitchLabel'),
        saveProviderBtn: document.getElementById('saveProviderBtn'),
        testConnectionBtn: document.getElementById('testConnectionBtn'),
        fetchModelsBtn: document.getElementById('fetchModelsBtn'),
        deleteProviderBtn: document.getElementById('deleteProviderBtn'),
        providerNameLabel: document.getElementById('providerNameLabel'),
        apiTypeLabel: document.getElementById('apiTypeLabel'),
        apiKeyLabel: document.getElementById('apiKeyLabel'),
        baseUrlLabel: document.getElementById('baseUrlLabel'),
        providerName: document.getElementById('providerName'),
        apiType: document.getElementById('apiType'),
        apiKey: document.getElementById('apiKey'),
        baseUrl: document.getElementById('baseUrl'),
        editorTabConfig: document.getElementById('editorTabConfig'),
        editorTabModels: document.getElementById('editorTabModels'),
        addManualModelBtn: document.getElementById('addManualModelBtn'),
        manualModelsTitle: document.getElementById('manualModelsTitle'),
        manualModelsList: document.getElementById('manualModelsList'),
        fetchedModelsTitle: document.getElementById('fetchedModelsTitle'),
        fetchedModelsList: document.getElementById('fetchedModelsList'),
        fetchModelsModal: document.getElementById('fetchModelsModal'),
        fetchModelsModalTitle: document.getElementById('fetchModelsModalTitle'),
        fetchModelsModalDescription: document.getElementById('fetchModelsModalDescription'),
        fetchModelsModalSearch: document.getElementById('fetchModelsModalSearch'),
        fetchModelsModalList: document.getElementById('fetchModelsModalList'),
        closeFetchModelsModalBtn: document.getElementById('closeFetchModelsModalBtn'),
        manualModelModal: document.getElementById('manualModelModal'),
        manualModelModalTitle: document.getElementById('manualModelModalTitle'),
        manualModelIdLabel: document.getElementById('manualModelIdLabel'),
        manualModelId: document.getElementById('manualModelId'),
        manualModelNameLabel: document.getElementById('manualModelNameLabel'),
        manualModelName: document.getElementById('manualModelName'),
        manualModelCapabilitiesLabel: document.getElementById('manualModelCapabilitiesLabel'),
        manualModelCapabilities: document.getElementById('manualModelCapabilities'),
        manualModelKindLabel: document.getElementById('manualModelKindLabel'),
        manualModelKind: document.getElementById('manualModelKind'),
        cancelManualModelBtn: document.getElementById('cancelManualModelBtn'),
        saveManualModelBtn: document.getElementById('saveManualModelBtn'),
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
        navDataManagement: document.getElementById('navDataManagement'),
        navDataManagementTitle: document.getElementById('navDataManagementTitle'),
        paneDataManagement: document.getElementById('paneDataManagement'),
        navAbout: document.getElementById('navAbout'),
        navAboutTitle: document.getElementById('navAboutTitle'),
        paneMcp: document.getElementById('paneMcp'),
        paneAbout: document.getElementById('paneAbout'),
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
        noticeAnnouncementTitle: document.getElementById('noticeAnnouncementTitle'),
        noticeAnnouncementDescription: document.getElementById('noticeAnnouncementDescription'),
        noticeAnnouncementList: document.getElementById('noticeAnnouncementList'),
        noticeChangelogTitle: document.getElementById('noticeChangelogTitle'),
        noticeChangelogContent: document.getElementById('noticeChangelogContent'),
        aboutOverviewGrid: document.getElementById('aboutOverviewGrid'),
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
        bulletin: {
          deprecationStartVersion: '',
          removalVersion: ''
        },
        about: {
          appName: '',
          version: '',
          author: '',
          authorUrl: '',
          publisher: '',
          license: '',
          repositoryUrl: '',
          marketplaceUrl: '',
          openVsxUrl: ''
        },
        changelogMarkdown: '',
        notice: '',
        noticeTone: 'info',
        backupFiles: []
      };
      let activeSection = 'general';
      let activeDataTab = 'transfer';
      let providers = [];
      let persistedProvidersById = {};
      let dirtyProviderIds = new Set();
      let providerAutosaveTimer = 0;
      let providerAutosaveTargetId = '';
      let providerSaveStatusById = {};
      let fetchedModelsByProvider = {};
      let testModelByProviderId = {};
      let testModelModalProviderId = '';
      let fetchModelsModalProviderId = '';
      let fetchModelsSearchKeyword = '';
      let isFetchingProviderModels = false;
      let manualModelModalState = null;
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
${getHtmlEscaperScript()}

      function normalizeSectionValue(section) {
        return section === 'modelConfig' || section === 'defaultModels' || section === 'general' || section === 'dataManagement' || section === 'mcp' || section === 'about' ? section : 'general';
      }

      function openModal(modalEl, focusEl) {
        if (!modalEl) { return; }
        modalEl.classList.add('visible');
        modalEl.setAttribute('aria-hidden', 'false');
        if (focusEl && typeof focusEl.focus === 'function') {
          focusEl.focus();
        }
      }

      function closeModal(modalEl) {
        if (!modalEl) { return; }
        modalEl.classList.remove('visible');
        modalEl.setAttribute('aria-hidden', 'true');
      }

      function renderNav() {
        const strings = runtimeState.strings || {};
        dom.navHeading.textContent = strings.settingsViewTitle || '';
        dom.navModelConfigTitle.textContent = strings.modelConfigTitle || '';
        dom.navDefaultModelsTitle.textContent = strings.defaultModelsTitle || '';
        dom.navGeneralTitle.textContent = strings.settingsTitle || '';
        dom.navMcpTitle.textContent = strings.mcpTitle || 'MCP';
        dom.navDataManagementTitle.textContent = strings.dataManagementTitle || 'Data';
        dom.navAboutTitle.textContent = strings.aboutTitle || 'About';

        const items = [dom.navModelConfig, dom.navDefaultModels, dom.navMcp, dom.navDataManagement, dom.navGeneral, dom.navAbout];
        for (const item of items) {
          const isActive = item.getAttribute('data-section') === activeSection;
          item.classList.toggle('active', isActive);
          item.setAttribute('aria-current', isActive ? 'page' : 'false');
        }

      }

      function renderSectionVisibility() {
        const panes = [dom.paneModelConfig, dom.paneDefaultModels, dom.paneGeneral, dom.paneDataManagement, dom.paneMcp, dom.paneAbout];
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
