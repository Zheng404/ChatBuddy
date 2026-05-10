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
      if (dom.dataTabTemplates) {
        dom.dataTabTemplates.addEventListener('click', () => {
          switchDataTab('templates');
        });
      }
      if (dom.templatesListContainer) {
        dom.templatesListContainer.addEventListener('click', (event) => {
          var target = event.target;
          if (!(target instanceof HTMLElement)) { return; }
          var actionEl = target.closest('[data-template-action]');
          if (!actionEl) { return; }
          var action = actionEl.getAttribute('data-template-action');
          var templateId = actionEl.getAttribute('data-template-id');
          if (!templateId) { return; }
          var strings = runtimeState.strings || {};
          var template = (runtimeState.templates || []).find(function(t) { return t && t.id === templateId; });
          if (!template) { return; }
          if (action === 'rename') {
            var newName = window.prompt(strings.templateRenamePrompt || 'Enter new template name', template.name || '');
            if (newName && newName.trim() && newName.trim() !== template.name) {
              vscode.postMessage({ type: 'renameTemplate', templateId: templateId, name: newName.trim() });
            }
          } else if (action === 'delete') {
            var confirmMsg = (strings.templateDeleteConfirm || 'Delete template "{name}"?').replace('{name}', template.name || '');
            if (window.confirm(confirmMsg)) {
              vscode.postMessage({ type: 'deleteTemplate', templateId: templateId });
            }
          }
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
          var settings = (runtimeState.settings && runtimeState.settings.localBackup) || {};
          vscode.postMessage({
            type: 'saveLocalBackupSettings',
            payload: {
              enabled: dom.autoBackupToggle.checked,
              directory: dom.backupDirInput.value.trim(),
              intervalHours: parseInt(dom.intervalInput.value, 10) || 24,
              maxCount: parseInt(dom.maxCountInput.value, 10) || 0,
              maxAgeDays: parseInt(dom.maxAgeInput.value, 10) || 0,
              encryptionEnabled: dom.backupEncryptionToggle.checked
            }
          });
          if (!runtimeState.settings) { runtimeState.settings = {}; }
          if (!runtimeState.settings.localBackup) { runtimeState.settings.localBackup = {}; }
          runtimeState.settings.localBackup.encryptionEnabled = dom.backupEncryptionToggle.checked;
        });
      }
      if (dom.backupPasswordSetBtn) {
        dom.backupPasswordSetBtn.addEventListener('click', () => {
          var strings = runtimeState.strings || {};
          var input = window.prompt(strings.backupPasswordPrompt || 'Enter backup password');
          if (input === null) { return; }
          var trimmed = input.trim();
          if (!trimmed) {
            showToast(strings.backupPasswordEmpty || 'Password cannot be empty.', 'error');
            return;
          }
          vscode.postMessage({ type: 'setBackupPassword', payload: { password: trimmed } });
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
