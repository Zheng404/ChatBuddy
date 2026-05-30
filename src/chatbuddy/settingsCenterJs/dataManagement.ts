/**
 * Data Management section rendering functions.
 * Includes tab switching, import/export, and local backup management.
 */

export function getDataManagementJs(): string {
  return `
      function switchDataTab(tab) {
        if (tab === 'local') { activeDataTab = 'local'; }
        else if (tab === 'reset') { activeDataTab = 'reset'; }
        else { activeDataTab = 'transfer'; }
        renderDataTabs();
        renderDataTabVisibility();
      }

      function renderDataTabs() {
        var strings = runtimeState.strings || {};
        dom.dataTabTransfer.textContent = strings.dataTabTransfer || 'Import / Export';
        dom.dataTabLocal.textContent = strings.dataTabLocal || 'Local Backup';
        if (dom.dataTabReset) {
          dom.dataTabReset.textContent = strings.dataTabReset || 'Reset';
        }
        dom.dataTabTransfer.classList.toggle('active', activeDataTab === 'transfer');
        dom.dataTabLocal.classList.toggle('active', activeDataTab === 'local');
        if (dom.dataTabReset) {
          dom.dataTabReset.classList.toggle('active', activeDataTab === 'reset');
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
        renderBackupList();
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
        dom.selectiveExportChecks.textContent = '';
        for (var i = 0; i < categories.length; i++) {
          var cat = categories[i];
          var label = document.createElement('label');
          label.className = 'selective-export-check';
          var checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.setAttribute('data-selective-key', cat.key);
          if (selectiveExportCategories[cat.key] !== false) {
            checkbox.checked = true;
          }
          var span = document.createElement('span');
          span.textContent = cat.label;
          label.appendChild(checkbox);
          label.appendChild(span);
          dom.selectiveExportChecks.appendChild(label);
        }
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
        dom.manualBackupTitle.textContent = strings.manualBackupTitle || '';
        dom.triggerBackupBtn.textContent = strings.triggerBackupAction || '';
        dom.refreshBackupListBtn.textContent = strings.refreshBackupListAction || '';
        dom.backupHistoryTitle.textContent = strings.backupHistoryTitle || '';
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
          dom.backupListContainer.textContent = '';
          var emptyDiv = document.createElement('div');
          emptyDiv.className = 'help';
          emptyDiv.textContent = strings.backupListEmpty || 'No backups found.';
          dom.backupListContainer.appendChild(emptyDiv);
          return;
        }
        // Safe: all user content escaped via escapeHtml()
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
