/**
 * Data storage event listeners.
 */
export function getDataSyncListenersJs(): string {
  return `
      // Data storage mode radio buttons
      var storageModeRadios = document.querySelectorAll('input[name="storageMode"]');
      for (var i = 0; i < storageModeRadios.length; i++) {
        storageModeRadios[i].addEventListener('change', handleStorageModeChange);
      }

      // Migration confirmation buttons
      var migrateYesBtn = document.getElementById('dataStorageMigrateYesBtn');
      if (migrateYesBtn) {
        migrateYesBtn.addEventListener('click', handleStorageMigrateYes);
      }
      var migrateNoBtn = document.getElementById('dataStorageMigrateNoBtn');
      if (migrateNoBtn) {
        migrateNoBtn.addEventListener('click', handleStorageMigrateNo);
      }
      var migrateCancelBtn = document.getElementById('dataStorageMigrateCancelBtn');
      if (migrateCancelBtn) {
        migrateCancelBtn.addEventListener('click', handleStorageMigrateCancel);
      }
`;
}
