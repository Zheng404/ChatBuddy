/**
 * Data management and local backup event listeners.
 */
export function getDataManagementJs(): string {
  return `
      // Data management buttons
      dom.exportBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'exportData' });
      });

      dom.importBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'importData' });
      });

      dom.importLegacyBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'importLegacyData' });
      });

      dom.resetBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'reset' });
      });

      // Selective export
      if (dom.selectiveExportChecks) {
        dom.selectiveExportChecks.addEventListener('change', (event) => {
          var target = event.target;
          if (!(target instanceof HTMLInputElement)) { return; }
          var key = target.getAttribute('data-selective-key');
          if (!key) { return; }
          selectiveExportCategories[key] = target.checked;
        });
      }
      if (dom.selectiveExportBtn) {
        dom.selectiveExportBtn.addEventListener('click', () => {
          var keys = ['providers', 'mcp', 'assistants', 'settings'];
          var selected = [];
          for (var i = 0; i < keys.length; i++) {
            if (selectiveExportCategories[keys[i]] !== false) {
              selected.push(keys[i]);
            }
          }
          vscode.postMessage({ type: 'selectiveExport', payload: { categories: selected } });
        });
      }

      // Data management tabs
      dom.dataTabTransfer.addEventListener('click', () => {
        switchDataTab('transfer');
      });
      dom.dataTabLocal.addEventListener('click', () => {
        switchDataTab('local');
      });
      if (dom.dataTabSync) {
        dom.dataTabSync.addEventListener('click', () => {
          switchDataTab('sync');
        });
      }
      // Local backup controls
      var backupAutoSaveTimer = undefined;
      function autoSaveBackupSettings() {
        if (backupAutoSaveTimer) { clearTimeout(backupAutoSaveTimer); }
        backupAutoSaveTimer = setTimeout(function() {
          backupAutoSaveTimer = undefined;
          vscode.postMessage({
            type: 'saveLocalBackupSettings',
            payload: {
              enabled: dom.autoBackupToggle.checked,
              directory: dom.backupDirInput.value.trim(),
              intervalHours: parseInt(dom.intervalInput.value, 10) || 24,
              maxCount: parseInt(dom.maxCountInput.value, 10) || 0,
              maxAgeDays: parseInt(dom.maxAgeInput.value, 10) || 0,
              encryptionEnabled: dom.backupEncryptionToggle ? dom.backupEncryptionToggle.checked : false
            }
          });
        }, 400);
      }

      dom.browseBackupDirBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'browseBackupDir' });
      });

      dom.autoBackupToggle.addEventListener('change', autoSaveBackupSettings);
      dom.intervalInput.addEventListener('change', autoSaveBackupSettings);
      dom.maxCountInput.addEventListener('change', autoSaveBackupSettings);
      dom.maxAgeInput.addEventListener('change', autoSaveBackupSettings);

      // Backup encryption controls
      if (dom.backupEncryptionToggle) {
        dom.backupEncryptionToggle.addEventListener('change', () => {
          if (backupAutoSaveTimer) { clearTimeout(backupAutoSaveTimer); }
          if (!runtimeState.settings) { runtimeState.settings = {}; }
          if (!runtimeState.settings.localBackup) { runtimeState.settings.localBackup = {}; }
          runtimeState.settings.localBackup.encryptionEnabled = dom.backupEncryptionToggle.checked;
          autoSaveBackupSettings();
        });
      }
      if (dom.backupPasswordSetBtn) {
        dom.backupPasswordSetBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'setBackupPassword' });
        });
      }
      if (dom.backupPasswordClearBtn) {
        dom.backupPasswordClearBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'clearBackupPassword' });
        });
      }

      dom.triggerBackupBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'triggerLocalBackup' });
      });

      dom.refreshBackupListBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'refreshBackupList' });
      });

      dom.backupListContainer.addEventListener('click', (event) => {
        var target = event.target;
        if (!(target instanceof HTMLElement)) { return; }
        var actionTarget = target.closest('[data-backup-action]');
        if (!(actionTarget instanceof HTMLElement)) { return; }
        var action = actionTarget.getAttribute('data-backup-action');
        var fileName = actionTarget.getAttribute('data-backup-file');
        if (!action || !fileName) { return; }
        if (action === 'restore') {
          vscode.postMessage({ type: 'restoreLocalBackup', payload: { fileName: fileName } });
          return;
        }
        if (action === 'delete') {
          vscode.postMessage({ type: 'deleteLocalBackup', payload: { fileName: fileName } });
        }
      });
`;
}
