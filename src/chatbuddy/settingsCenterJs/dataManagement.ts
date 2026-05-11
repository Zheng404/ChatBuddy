/**
 * Data Management section rendering functions.
 * Includes tab switching, import/export, and local backup management.
 */

export function getDataManagementJs(): string {
  return `
      function switchDataTab(tab) {
        if (tab === 'local') { activeDataTab = 'local'; }
        else if (tab === 'templates') { activeDataTab = 'templates'; }
        else { activeDataTab = 'transfer'; }
        renderDataTabs();
        renderDataTabVisibility();
      }

      function renderDataTabs() {
        var strings = runtimeState.strings || {};
        dom.dataTabTransfer.textContent = strings.dataTabTransfer || 'Import / Export';
        dom.dataTabLocal.textContent = strings.dataTabLocal || 'Local Backup';
        if (dom.dataTabTemplates) {
          dom.dataTabTemplates.textContent = strings.dataTabTemplates || 'Templates';
        }
        dom.dataTabTransfer.classList.toggle('active', activeDataTab === 'transfer');
        dom.dataTabLocal.classList.toggle('active', activeDataTab === 'local');
        if (dom.dataTabTemplates) {
          dom.dataTabTemplates.classList.toggle('active', activeDataTab === 'templates');
        }
      }

      function renderDataTabVisibility() {
        var panes = document.querySelectorAll('#paneDataManagement .editor-pane');
        for (var i = 0; i < panes.length; i++) {
          var pane = panes[i];
          var tabAttr = pane.getAttribute('data-tab');
          pane.classList.toggle('active', tabAttr === activeDataTab);
        }
      }

      function renderDataManagementText() {
        var strings = runtimeState.strings || {};
        dom.dataTransferDescription.textContent = strings.dataTransferDescription || '';
        dom.dangerSectionTitle.textContent = strings.dangerSectionTitle || '';
        dom.resetDataDescription.textContent = strings.resetDataDescription || '';
        dom.exportBtn.textContent = strings.exportDataAction || '';
        dom.importBtn.textContent = strings.importDataAction || '';
        dom.importLegacyBtn.textContent = strings.importLegacyDataAction || '';
        dom.resetBtn.textContent = strings.resetDataAction || '';
        renderSelectiveExport();
        renderDataTabs();
        renderDataTabVisibility();
        renderLocalBackupSettings();
        renderManualBackupSection();
        renderBackupList();
        renderTemplatesSection();
      }

      function renderTemplatesSection() {
        var strings = runtimeState.strings || {};
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

      function renderSelectiveExport() {
        var strings = runtimeState.strings || {};
        if (dom.selectiveExportTitle) {
          dom.selectiveExportTitle.textContent = strings.selectiveExportTitle || '';
        }
        if (dom.selectiveExportDescription) {
          dom.selectiveExportDescription.textContent = strings.selectiveExportDescription || '';
        }
        if (dom.selectiveExportBtn) {
          dom.selectiveExportBtn.textContent = strings.selectiveExportAction || '';
        }
        if (!dom.selectiveExportChecks) { return; }
        var categories = [
          { key: 'providers', label: strings.selectiveExportProviders || 'Providers' },
          { key: 'mcp', label: strings.selectiveExportMcp || 'MCP' },
          { key: 'assistants', label: strings.selectiveExportAssistants || 'Assistants' },
          { key: 'settings', label: strings.selectiveExportSettings || 'Settings' }
        ];
        var html = '';
        for (var i = 0; i < categories.length; i++) {
          var cat = categories[i];
          var checked = selectiveExportCategories[cat.key] !== false ? 'checked' : '';
          html += '<label class="selective-export-check"><input type="checkbox" data-selective-key="' + escapeHtml(cat.key) + '" ' + checked + ' />'
            + '<span>' + escapeHtml(cat.label) + '</span></label>';
        }
        dom.selectiveExportChecks.innerHTML = html;
      }

      function renderLocalBackupSettings() {
        var strings = runtimeState.strings || {};
        var settings = (runtimeState.settings && runtimeState.settings.localBackup) || {};
        dom.autoBackupSectionTitle.textContent = strings.autoBackupSectionTitle || '';
        dom.backupDirLabel.textContent = strings.backupDirLabel || '';
        dom.autoBackupLabel.textContent = strings.autoBackupLabel || '';
        dom.intervalLabel.textContent = strings.backupIntervalLabel || '';
        dom.maxCountLabel.textContent = strings.backupMaxCountLabel || '';
        dom.maxAgeLabel.textContent = strings.backupMaxAgeLabel || '';
        dom.backupDirInput.value = settings.directory || '';
        dom.autoBackupToggle.checked = !!settings.enabled;
        dom.intervalInput.value = settings.intervalHours || 24;
        dom.maxCountInput.value = settings.maxCount !== undefined ? settings.maxCount : 10;
        dom.maxAgeInput.value = settings.maxAgeDays !== undefined ? settings.maxAgeDays : 30;
        if (dom.backupEncryptionToggle) {
          dom.backupEncryptionToggle.checked = !!settings.encryptionEnabled;
        }
      }

      function renderManualBackupSection() {
        var strings = runtimeState.strings || {};
        dom.manualBackupTitle.textContent = strings.manualBackupTitle || '';
        dom.triggerBackupBtn.textContent = strings.triggerBackupAction || '';
        dom.refreshBackupListBtn.textContent = strings.refreshBackupListAction || '';
        dom.backupHistoryTitle.textContent = strings.backupHistoryTitle || '';
        renderBackupEncryptionSection();
      }

      function renderBackupEncryptionSection() {
        var strings = runtimeState.strings || {};
        var settings = (runtimeState.settings && runtimeState.settings.localBackup) || {};
        if (dom.backupEncryptionSectionTitle) {
          dom.backupEncryptionSectionTitle.textContent = strings.backupEncryptionSectionTitle || '';
        }
        if (dom.backupEncryptionHelp) {
          dom.backupEncryptionHelp.textContent = strings.backupEncryptionHelp || '';
        }
        if (dom.backupEncryptionLabel) {
          dom.backupEncryptionLabel.textContent = strings.backupEncryptionLabel || '';
        }
        if (dom.backupEncryptionToggle) {
          dom.backupEncryptionToggle.checked = !!settings.encryptionEnabled;
        }
        if (dom.backupPasswordStatusLabel) {
          dom.backupPasswordStatusLabel.textContent = runtimeState.hasBackupPassword
            ? (strings.backupPasswordSet || 'Password set')
            : (strings.backupPasswordNotSet || 'Password not set');
          dom.backupPasswordStatusLabel.className = 'backup-password-status' + (runtimeState.hasBackupPassword ? ' has-password' : '');
        }
        if (dom.backupPasswordSetBtn) {
          dom.backupPasswordSetBtn.textContent = runtimeState.hasBackupPassword
            ? (strings.backupPasswordChangeAction || 'Change Password')
            : (strings.backupPasswordSetAction || 'Set Password');
        }
        if (dom.backupPasswordClearBtn) {
          dom.backupPasswordClearBtn.textContent = strings.backupPasswordClearAction || 'Clear Password';
          dom.backupPasswordClearBtn.style.display = runtimeState.hasBackupPassword ? '' : 'none';
        }
      }

      function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
      }

      function formatDate(isoString) {
        try {
          var d = new Date(isoString);
          return d.toLocaleString();
        } catch (_) {
          return isoString;
        }
      }

      function renderBackupList() {
        var strings = runtimeState.strings || {};
        var items = runtimeState.backupFiles || [];
        if (!items.length) {
          dom.backupListContainer.innerHTML = '<div class="help">' + escapeHtml(strings.backupListEmpty || 'No backups found.') + '</div>';
          return;
        }
        var html = '';
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          html += '<div class="backup-item">'
            + '<div class="backup-item-info">'
            + '<span class="backup-item-name">' + escapeHtml(item.fileName) + '</span>'
            + '<span class="backup-item-meta">' + formatFileSize(item.fileSize) + ' &middot; ' + formatDate(item.createdAt) + '</span>'
            + '</div>'
            + '<div class="backup-item-actions">'
            + '<button class="btn-secondary" data-backup-action="restore" data-backup-file="' + escapeHtml(item.fileName) + '">' + (strings.backupRestoreAction || 'Restore') + '</button>'
            + '<button class="btn-danger" data-backup-action="delete" data-backup-file="' + escapeHtml(item.fileName) + '">' + (strings.backupDeleteAction || 'Delete') + '</button>'
            + '</div>'
            + '</div>';
        }
        dom.backupListContainer.innerHTML = html;
      }
`;
}
