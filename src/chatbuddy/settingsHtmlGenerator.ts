/**
 * 设置中心 HTML 生成器。
 *
 * 从 settingsCenterPanel 的 getHtml 方法中提取的纯函数。
 */
import * as vscode from 'vscode';
import { DEFAULT_TITLE_SUMMARY_PROMPT } from './modelCatalog';
import { getCodiconStyleText } from './codicon';
import { TOAST_CONTAINER_HTML, getToastScript } from './webviewShared';
import { getSettingsCenterCss } from './settingsCenterStyles';
import { getSettingsCenterJs } from './settingsCenterJs';
import { getNonce, buildCsp } from './utils';

export function getSettingsCenterHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  const csp = buildCsp(webview, nonce);
  const codiconStyle = getCodiconStyleText();

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${codiconStyle}</style>
    <style>${getSettingsCenterCss()}</style>
  </head>
  <body>
    <div class="shell">
      <div class="frame">
        <header class="settings-bar" id="settingsBar">
          <h2 class="settings-bar-title" id="navHeading"></h2>
          <button class="tab-arrow" id="tabArrowLeft" type="button">
            <span class="codicon codicon-chevron-left"></span>
          </button>
          <nav class="settings-tabs" id="settingsTabs">
            <button class="nav-item" id="navModelConfig" type="button" data-section="modelConfig">
              <span class="nav-item-icon"><span class="codicon codicon-hubot"></span></span>
              <span class="nav-item-title" id="navModelConfigTitle"></span>
            </button>
            <button class="nav-item" id="navDefaultModels" type="button" data-section="defaultModels">
              <span class="nav-item-icon"><span class="codicon codicon-symbol-constant"></span></span>
              <span class="nav-item-title" id="navDefaultModelsTitle"></span>
            </button>
            <button class="nav-item" id="navMcp" type="button" data-section="mcp">
              <span class="nav-item-icon"><span class="codicon codicon-plug"></span></span>
              <span class="nav-item-title" id="navMcpTitle"></span>
            </button>
            <button class="nav-item" id="navDataManagement" type="button" data-section="dataManagement">
              <span class="nav-item-icon"><span class="codicon codicon-database"></span></span>
              <span class="nav-item-title" id="navDataManagementTitle"></span>
            </button>
            <button class="nav-item" id="navGeneral" type="button" data-section="general">
              <span class="nav-item-icon"><span class="codicon codicon-settings-gear"></span></span>
              <span class="nav-item-title" id="navGeneralTitle"></span>
            </button>
            <button class="nav-item" id="navAbout" type="button" data-section="about">
              <span class="nav-item-icon"><span class="codicon codicon-info"></span></span>
              <span class="nav-item-title" id="navAboutTitle"></span>
            </button>
          </nav>
          <button class="tab-arrow" id="tabArrowRight" type="button">
            <span class="codicon codicon-chevron-right"></span>
          </button>
        </header>

        <main class="settings-content">
          <section class="settings-pane" id="paneModelConfig" data-section="modelConfig">
            <div class="provider-workspace">
              <aside class="provider-nav">
                <div class="toolbar">
                  <button class="btn-primary" id="addProviderBtn" type="button"></button>
                </div>
                <input id="providerSearch" class="provider-search" type="text" />
                <div class="provider-list" id="providerList"></div>
              </aside>

              <div class="provider-empty" id="providerEmptyState">
                <span class="codicon codicon-server"></span>
                <p id="providerEmptyText"></p>
              </div>

              <section class="editor">
                <div class="editor-tabs">
                  <button class="editor-tab active" id="editorTabConfig" type="button" data-tab="config"></button>
                  <button class="editor-tab" id="editorTabModels" type="button" data-tab="models"></button>
                </div>
                <div class="editor-pane active" data-tab="config">
                  <section class="panel">
                    <div class="panel-header">
                      <div class="panel-header-left">
                        <h2 class="panel-title" id="providerPanelTitle"></h2>
                        <div class="provider-save-status" id="providerSaveStatus" aria-live="polite"></div>
                      </div>
                      <div class="panel-actions">
                        <label class="provider-enabled-toggle" id="providerEnabledToggle">
                          <input type="checkbox" id="providerEnabledCheckbox" />
                          <span id="providerEnabledSwitchLabel"></span>
                        </label>
                        <button class="btn-secondary" id="testConnectionBtn" type="button"></button>
                        <button class="btn-danger" id="deleteProviderBtn" type="button"></button>
                      </div>
                    </div>
                    <div class="field-grid">
                      <div class="field full">
                        <label for="providerName" id="providerNameLabel"></label>
                        <input id="providerName" type="text" />
                      </div>
                      <div class="field full">
                        <label for="apiType" id="apiTypeLabel"></label>
                        <select id="apiType">
                          <option value="chat_completions">chat/completions</option>
                          <option value="responses">responses</option>
                          <option value="gemini">Gemini</option>
                        </select>
                      </div>
                      <div class="field full">
                        <label for="apiKey" id="apiKeyLabel"></label>
                        <div class="field-input-with-action">
                          <input id="apiKey" type="password" />
                          <button class="field-action" id="toggleApiKeyVisibility" type="button" title="Toggle visibility">
                            <span class="codicon codicon-eye"></span>
                          </button>
                        </div>
                      </div>
                      <div class="field full">
                        <label for="baseUrl" id="baseUrlLabel"></label>
                        <input id="baseUrl" type="text" placeholder="https://api.openai.com/v1" />
                      </div>
                    </div>
                  </section>
                </div>
                <div class="editor-pane" data-tab="models">
                  <div class="model-sections">
                    <section class="model-section-card">
                      <div class="model-section-header">
                        <h3 class="model-section-title" id="manualModelsTitle"></h3>
                        <div class="model-section-actions">
                          <button class="btn-secondary" id="addManualModelBtn" type="button"></button>
                        </div>
                      </div>
                      <div class="models-grid" id="manualModelsList"></div>
                    </section>
                    <section class="model-section-card">
                      <div class="model-section-header">
                        <h3 class="model-section-title" id="fetchedModelsTitle"></h3>
                        <div class="model-section-actions">
                          <button class="btn-secondary" id="fetchModelsBtn" type="button"></button>
                        </div>
                      </div>
                      <div class="models-grid" id="fetchedModelsList"></div>
                    </section>
                  </div>
                </div>
              </section>
            </div>
          </section>

          <section class="settings-pane" id="paneDefaultModels" data-section="defaultModels">
            <section class="section-card">
              <h2 class="section-title" id="defaultAssistantModelLabel"></h2>
              <div class="field">
                <select id="defaultAssistantModel"></select>
                <div class="help" id="defaultAssistantModelHelp"></div>
              </div>
            </section>
            <section class="section-card">
              <h2 class="section-title" id="defaultTitleSummaryModelLabel"></h2>
              <div class="field">
                <div class="input-row">
                  <select id="defaultTitleSummaryModel"></select>
                  <button class="btn-secondary" id="editTitleSummaryPromptBtn" type="button"></button>
                </div>
                <div class="help" id="defaultTitleSummaryModelHelp"></div>
              </div>
            </section>
          </section>

          <section class="settings-pane" id="paneMcp" data-section="mcp">
            <div class="section-grid">
              <section class="section-card">
                <h2 class="section-title" id="mcpMaxToolRoundsTitle"></h2>
                <div class="field">
                  <div class="input-row">
                    <input id="mcpMaxToolRounds" type="number" min="1" max="20" />
                    <button class="btn-primary" id="mcpSaveToolRoundsBtn" type="button"></button>
                  </div>
                  <div class="help" id="mcpMaxToolRoundsHelp"></div>
                </div>
              </section>

              <section class="section-card">
                <div class="header-row">
                  <h2 class="section-title" id="mcpServersTitle"></h2>
                  <div class="header-actions">
                    <button class="btn-primary" id="mcpAddGroupBtn" type="button"></button>
                    <button class="btn-primary" id="mcpAddServerBtn" type="button"></button>
                  </div>
                </div>
                <div id="mcpGroupList"></div>
                <div id="mcpServerList"></div>
              </section>
            </div>
          </section>

          <section class="settings-pane" id="paneGeneral" data-section="general">
            <div class="section-grid">
              <section class="section-card">
                <h2 class="section-title" id="languageSectionTitle"></h2>
                <div class="field">
                  <select id="locale"></select>
                </div>
                <div class="help" id="languageHelp"></div>
              </section>

              <section class="section-card">
                <h2 class="section-title" id="sendShortcutSectionTitle"></h2>
                <div class="field">
                  <select id="sendShortcut"></select>
                </div>
                <div class="help" id="sendShortcutHelp"></div>
              </section>

              <section class="section-card">
                <h2 class="section-title" id="chatTabModeSectionTitle"></h2>
                <div class="field">
                  <select id="chatTabMode"></select>
                </div>
                <div class="help" id="chatTabModeHelp"></div>
              </section>

              <section class="section-card">
                <h2 class="section-title" id="timeoutSectionTitle"></h2>
                <div class="field">
                  <select id="timeout"></select>
                </div>
              </section>
            </div>
          </section>

          <section class="settings-pane" id="paneDataManagement" data-section="dataManagement">
            <div class="section-grid">
              <div class="data-tab-container">
                <div class="editor-tabs" id="dataTabs">
                  <button class="editor-tab active" id="dataTabTransfer" data-tab="transfer"></button>
                  <button class="editor-tab" id="dataTabLocal" data-tab="local"></button>
                </div>

                <div class="editor-pane active" data-tab="transfer">
                  <div class="help" id="dataTransferDescription"></div>
                  <div class="data-actions">
                    <button class="btn-secondary" id="exportBtn" type="button"></button>
                    <button class="btn-secondary" id="importBtn" type="button"></button>
                    <button class="btn-secondary" id="importLegacyBtn" type="button"></button>
                  </div>
                  <section class="section-card selective-export-section">
                    <h2 class="section-title" id="selectiveExportTitle"></h2>
                    <p class="help" id="selectiveExportDescription"></p>
                    <div class="selective-export-checks" id="selectiveExportChecks"></div>
                    <div class="data-actions">
                      <button class="btn-secondary" id="selectiveExportBtn" type="button"></button>
                    </div>
                  </section>
                </div>

                <div class="editor-pane" data-tab="local">
                  <section class="section-card">
                    <div class="field">
                      <label id="backupDirLabel"></label>
                      <div class="field-input-with-action">
                        <input id="backupDirInput" type="text" readonly />
                        <button class="field-action" id="browseBackupDirBtn" type="button">
                          <span class="codicon codicon-folder-opened"></span>
                        </button>
                      </div>
                    </div>
                  </section>

                  <section class="section-card">
                    <h2 class="section-title" id="autoBackupSectionTitle"></h2>
                    <div class="field-toggle-row">
                      <input id="autoBackupToggle" type="checkbox" />
                      <label id="autoBackupLabel"></label>
                    </div>
                    <div class="field">
                      <label id="intervalLabel"></label>
                      <input id="intervalInput" type="number" min="1" />
                    </div>
                    <div class="field">
                      <label id="maxCountLabel"></label>
                      <input id="maxCountInput" type="number" min="0" />
                    </div>
                    <div class="field">
                      <label id="maxAgeLabel"></label>
                      <input id="maxAgeInput" type="number" min="0" />
                    </div>
                  </section>

                  <section class="section-card">
                    <h2 class="section-title" id="manualBackupTitle"></h2>
                    <div class="panel-actions">
                      <button class="btn-secondary" id="triggerBackupBtn" type="button"></button>
                      <button class="btn-secondary" id="refreshBackupListBtn" type="button"></button>
                    </div>
                  </section>

                  <section class="section-card">
                    <h2 class="section-title" id="backupEncryptionSectionTitle"></h2>
                    <p class="help" id="backupEncryptionHelp"></p>
                    <div class="field-toggle-row">
                      <input id="backupEncryptionToggle" type="checkbox" />
                      <label id="backupEncryptionLabel"></label>
                    </div>
                    <div class="backup-password-row">
                      <span id="backupPasswordStatusLabel" class="backup-password-status"></span>
                      <button class="btn-secondary" id="backupPasswordSetBtn" type="button"></button>
                      <button class="btn-secondary" id="backupPasswordClearBtn" type="button"></button>
                    </div>
                  </section>

                  <section class="section-card">
                    <h2 class="section-title" id="backupHistoryTitle"></h2>
                    <div id="backupListContainer"></div>
                  </section>
                </div>
              </div>

              <section class="section-card">
                <h2 class="section-title" id="dangerSectionTitle"></h2>
                <div class="danger-copy" id="resetDataDescription"></div>
                <div class="danger-actions">
                  <button class="btn-danger" id="resetBtn" type="button"></button>
                </div>
              </section>
            </div>
          </section>

          <section class="settings-pane" id="paneAbout" data-section="about">
            <div class="section-grid about-layout">
              <section class="section-card about-hero-card">
                <div class="about-grid" id="aboutOverviewGrid"></div>
                <div class="about-notice-shell">
                  <div class="about-notice-grid">
                    <section class="about-info-card">
                      <div class="about-notice-header">
                        <h2 class="section-title" id="noticeAnnouncementTitle"></h2>
                        <p class="help" id="noticeAnnouncementDescription"></p>
                      </div>
                      <ul class="notice-list" id="noticeAnnouncementList"></ul>
                    </section>
                    <section class="about-info-card about-changelog-card">
                      <div class="about-changelog-block">
                        <h3 class="panel-title" id="noticeChangelogTitle"></h3>
                        <div class="changelog-content changelog-markdown" id="noticeChangelogContent"></div>
                      </div>
                    </section>
                  </div>
                </div>
              </section>
            </div>
          </section>
        </main>
      </div>
    </div>

    <div class="modal-backdrop" id="testModelModal" aria-hidden="true">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="testModelModalTitle">
        <h3 class="modal-title" id="testModelModalTitle"></h3>
        <p class="modal-copy" id="testModelModalDescription"></p>
        <div class="field">
          <label for="testModelModalSelect" id="testModelModalLabel"></label>
          <select id="testModelModalSelect"></select>
        </div>
        <div class="panel-actions">
          <button class="btn-secondary" id="cancelTestModelBtn" type="button"></button>
          <button class="btn-primary" id="confirmTestModelBtn" type="button"></button>
        </div>
      </div>
    </div>

    <div class="modal-backdrop" id="discardChangesModal" aria-hidden="true">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="discardChangesModalTitle">
        <h3 class="modal-title" id="discardChangesModalTitle"></h3>
        <p class="modal-copy" id="discardChangesModalDescription"></p>
        <div class="panel-actions">
          <button class="btn-secondary" id="discardChangesStayBtn" type="button"></button>
          <button class="btn-danger" id="discardChangesConfirmBtn" type="button"></button>
        </div>
      </div>
    </div>

    <div class="modal-backdrop" id="fetchModelsModal" aria-hidden="true">
      <div class="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-labelledby="fetchModelsModalTitle">
        <div class="panel-header modal-header">
          <div class="modal-header-copy">
            <h3 class="modal-title" id="fetchModelsModalTitle"></h3>
            <p class="modal-copy" id="fetchModelsModalDescription"></p>
          </div>
          <button class="btn-secondary" id="closeFetchModelsModalBtn" type="button"></button>
        </div>
        <input id="fetchModelsModalSearch" class="provider-search" type="text" />
        <div class="fetch-models-list" id="fetchModelsModalList"></div>
        <div class="fetch-models-error" id="fetchModelsError" style="display:none">
          <p id="fetchModelsErrorText" class="fetch-models-error-text"></p>
          <button class="btn-primary" id="retryFetchModelsBtn" type="button"></button>
        </div>
      </div>
    </div>

    <div class="modal-backdrop" id="manualModelModal" aria-hidden="true">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="manualModelModalTitle">
        <h3 class="modal-title" id="manualModelModalTitle"></h3>
        <div class="field-grid">
          <div class="field full">
            <label for="manualModelId" id="manualModelIdLabel"></label>
            <input id="manualModelId" type="text" />
          </div>
          <div class="field full">
            <label for="manualModelName" id="manualModelNameLabel"></label>
            <input id="manualModelName" type="text" />
          </div>
          <div class="field full">
            <label for="manualModelKind" id="manualModelKindLabel"></label>
            <select id="manualModelKind">
              <option value="chat">Text</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
              <option value="embedding">Embedding</option>
              <option value="rerank">Rerank</option>
            </select>
          </div>
          <div class="field full">
            <label id="manualModelCapabilitiesLabel"></label>
            <div class="capability-checks" id="manualModelCapabilities">
              <label class="cap-check"><input type="checkbox" data-cap="vision" /><span></span></label>
              <label class="cap-check"><input type="checkbox" data-cap="reasoning" /><span></span></label>
              <label class="cap-check"><input type="checkbox" data-cap="tools" /><span></span></label>
              <label class="cap-check"><input type="checkbox" data-cap="webSearch" /><span></span></label>
            </div>
          </div>
        </div>
        <div class="panel-actions">
          <button class="btn-secondary" id="cancelManualModelBtn" type="button"></button>
          <button class="btn-primary" id="saveManualModelBtn" type="button"></button>
        </div>
      </div>
    </div>

    <div class="modal-backdrop" id="mcpServerModal" aria-hidden="true">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="mcpServerModalTitle">
        <h3 class="modal-title" id="mcpServerModalTitle"></h3>
        <p class="modal-copy" id="mcpServerModalDescription"></p>
        <div class="field-grid">
          <div class="field">
            <label for="mcpModalName" id="mcpModalNameLabel"></label>
            <input id="mcpModalName" type="text" />
          </div>
          <div class="field">
            <label for="mcpModalTransport" id="mcpModalTransportLabel"></label>
            <select id="mcpModalTransport">
              <option value="stdio">stdio</option>
              <option value="streamableHttp">streamableHttp</option>
              <option value="sse">sse</option>
            </select>
          </div>
          <div class="field full" id="mcpModalFields"></div>
        </div>
        <div class="panel-actions">
          <button class="btn-secondary" id="mcpModalCancelBtn" type="button"></button>
          <button class="btn-primary" id="mcpModalSaveBtn" type="button"></button>
        </div>
      </div>
    </div>

    <div class="modal-backdrop" id="titleSummaryPromptModal" aria-hidden="true">
      <div class="modal-card" role="dialog" aria-modal="true">
        <h3 class="modal-title" id="titleSummaryPromptModalTitle"></h3>
        <p class="modal-copy" id="titleSummaryPromptModalDescription"></p>
        <div class="field">
          <textarea id="titleSummaryPromptModalTextarea" rows="8"></textarea>
        </div>
        <div class="panel-actions">
          <button class="btn-secondary" id="cancelTitleSummaryPromptBtn" type="button"></button>
          <button class="btn-secondary" id="resetTitleSummaryPromptBtn" type="button"></button>
          <button class="btn-primary" id="saveTitleSummaryPromptBtn" type="button"></button>
        </div>
      </div>
    </div>

    <div class="modal-backdrop" id="addProviderModal" aria-hidden="true">
      <div class="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-labelledby="addProviderModalTitle">
        <h3 class="modal-title" id="addProviderModalTitle"></h3>
        <p class="modal-copy" id="addProviderModalDescription"></p>
        <div class="provider-template-grid" id="providerTemplateGrid"></div>
        <div class="panel-actions">
          <button class="btn-secondary" id="cancelAddProviderBtn" type="button"></button>
        </div>
      </div>
    </div>

${TOAST_CONTAINER_HTML}

    <script nonce="${nonce}">
      ${getSettingsCenterJs(getToastScript(), DEFAULT_TITLE_SUMMARY_PROMPT)}
    </script>
  </body>
</html>`;
}
