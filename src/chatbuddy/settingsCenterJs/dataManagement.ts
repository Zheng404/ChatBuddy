/**
 * Data Management section rendering functions.
 * Includes tab switching, import/export, and local backup management.
 */

export function getDataManagementJs(): string {
  return `
      function switchDataTab(tab) {
        activeDataTab = tab === 'local' ? 'local' : 'transfer';
        renderDataTabs();
        renderDataTabVisibility();
      }

      function renderDataTabs() {
        var strings = runtimeState.strings || {};
        dom.dataTabTransfer.textContent = strings.dataTabTransfer || 'Import / Export';
        dom.dataTabLocal.textContent = strings.dataTabLocal || 'Local Backup';
        dom.dataTabTransfer.classList.toggle('active', activeDataTab === 'transfer');
        dom.dataTabLocal.classList.toggle('active', activeDataTab === 'local');
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
        renderDataTabs();
        renderDataTabVisibility();
        renderLocalBackupSettings();
        renderManualBackupSection();
        renderBackupList();
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
      }

      function renderManualBackupSection() {
        var strings = runtimeState.strings || {};
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
          dom.backupListContainer.innerHTML = '<div class="help">' + (strings.backupListEmpty || 'No backups found.') + '</div>';
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
