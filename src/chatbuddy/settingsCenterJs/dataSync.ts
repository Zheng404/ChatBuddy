/**
 * 数据存储目录选项卡的 JS 逻辑。
 *
 * 提供存储模式选择（默认/共享）、迁移确认等 UI 交互。
 */
export function getDataSyncJs(): string {
  return `
      var currentStorageMode = 'default';
      var dataStorageStatus = '';
      var pendingStorageMode = null;

      function renderDataSyncText() {
        var strings = runtimeState.strings || {};
        var el;
        el = document.getElementById('dataStorageTitle');
        if (el) { el.textContent = strings.dataStorageTitle || 'Data Storage'; }
        el = document.getElementById('dataStorageHelp');
        if (el) { el.textContent = strings.dataStorageHelp || 'Choose where to store data. Requires IDE restart.'; }
        el = document.getElementById('storageModeDefaultLabel');
        if (el) { el.textContent = strings.storageModeDefaultLabel || 'Default'; }
        el = document.getElementById('storageModeDefaultDesc');
        if (el) { el.textContent = strings.storageModeDefaultDesc || 'VS Code globalStorage'; }
        el = document.getElementById('storageModeSharedLabel');
        if (el) { el.textContent = strings.storageModeSharedLabel || 'Shared'; }
        el = document.getElementById('storageModeSharedDesc');
        if (el) { el.textContent = strings.storageModeSharedDesc || '~/.ChatBuddy'; }
        el = document.getElementById('dataStorageStatus');
        if (el) { el.textContent = dataStorageStatus || ''; }
        el = document.getElementById('dataStorageMigrateYesBtn');
        if (el) { el.textContent = strings.dataStorageMigrateYesBtn || 'Migrate'; }
        el = document.getElementById('dataStorageMigrateNoBtn');
        if (el) { el.textContent = strings.dataStorageMigrateNoBtn || 'Init Empty'; }
        el = document.getElementById('dataStorageMigrateCancelBtn');
        if (el) { el.textContent = strings.dataStorageMigrateCancelBtn || 'Cancel'; }
      }

      function renderDataSyncValues() {
        var radioDefault = document.getElementById('storageModeDefault');
        var radioShared = document.getElementById('storageModeShared');
        if (radioDefault) { radioDefault.checked = currentStorageMode === 'default'; }
        if (radioShared) { radioShared.checked = currentStorageMode === 'shared'; }
      }

      function updateDataSyncVisibility() {
        /* no-op: kept for compatibility with renderAll() call in stateSync */
      }

      function handleStorageModeChange() {
        var selected = document.querySelector('input[name="storageMode"]:checked');
        if (!selected) { return; }
        var mode = selected.value;
        if (mode === currentStorageMode) { return; }
        vscode.postMessage({ type: 'switchStorageMode', payload: { mode: mode } });
      }

      function handleStorageMigrateYes() {
        if (!pendingStorageMode) { return; }
        vscode.postMessage({ type: 'confirmStorageMigration', payload: { mode: pendingStorageMode, migrate: true } });
      }

      function handleStorageMigrateNo() {
        if (!pendingStorageMode) { return; }
        vscode.postMessage({ type: 'confirmStorageMigration', payload: { mode: pendingStorageMode, migrate: false } });
      }

      function handleStorageMigrateCancel() {
        pendingStorageMode = null;
        renderDataSyncValues();
        var section = document.getElementById('dataStorageMigrationSection');
        if (section) { section.style.display = 'none'; }
      }

      function showStorageMigrationPrompt(targetMode) {
        pendingStorageMode = targetMode;
        var strings = runtimeState.strings || {};
        var promptEl = document.getElementById('dataStorageMigrationPrompt');
        if (promptEl) {
          promptEl.textContent = targetMode === 'shared'
            ? (strings.dataStorageMigrationPromptToShared || 'No data in shared storage. Migrate existing data?')
            : (strings.dataStorageMigrationPromptToDefault || 'No data in default storage. Migrate existing data?');
        }
        var section = document.getElementById('dataStorageMigrationSection');
        if (section) { section.style.display = ''; }
      }
  `;
}
