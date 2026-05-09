/**
 * 聊天 WebView HTML body 结构模块。
 *
 * 返回聊天面板的 HTML body 内容，包含消息区域、输入框、会话侧边栏、
 * 工具栏和 Toast 容器等核心 UI 结构。
 */
import { TOAST_CONTAINER_HTML } from './webviewShared';

/** Returns the HTML body for the chat webview panel. */
export function getChatBodyHtml(): string {
  return `
    <div class="layout">
      <section class="content" id="content">
        <section class="stage">
          <div class="messages" id="messages">
            <div class="messages-inner" id="messagesInner"></div>
            <div class="search-bar" id="searchBar">
              <input type="text" id="searchInput" class="search-input" placeholder="" />
              <span class="search-count" id="searchCount"></span>
              <button class="search-nav-btn" id="searchPrevBtn" type="button"><span class="codicon codicon-arrow-up"></span></button>
              <button class="search-nav-btn" id="searchNextBtn" type="button"><span class="codicon codicon-arrow-down"></span></button>
              <button class="search-nav-btn" id="searchCloseBtn" type="button"><span class="codicon codicon-close"></span></button>
            </div>
          </div>
        </section>
      </section>

      <footer class="composer-shell">
        <div class="composer">
          <div class="composer-box">
            <div class="composer-toolbar" id="composerToolbar">
              <div class="composer-toolbar-left">
                <button class="action-btn-icon" id="clearBtn" type="button"><span class="codicon codicon-clear-all"></span></button>
                <button class="action-btn-icon" id="searchBtn" type="button" title="Search (Ctrl+F)"><span class="codicon codicon-search"></span></button>
                <button class="action-btn-icon" id="attachFileBtn" type="button" title="Attach file"><span class="codicon codicon-file-add"></span></button>
                <button class="action-btn-icon" id="attachImageBtn" type="button" title="Attach image"><span class="codicon codicon-device-camera"></span></button>
                <button class="action-btn-icon" id="saveAsTemplateBtn" type="button" title=""><span class="codicon codicon-save-as"></span></button>
              </div>
              <div class="composer-toolbar-right">
                <label class="toggle">
                  <input type="checkbox" id="streamingToggle" />
                  <span id="streamingLabel"></span>
                </label>
              </div>
            </div>
            <div class="image-preview-bar" id="imagePreviewBar"></div>
            <div class="file-preview-bar" id="filePreviewBar"></div>
            <textarea class="composer-textarea" id="composerInput"></textarea>
            <div class="composer-actions">
              <div class="composer-inline-controls">
                <select id="tempModelSelect" class="model-select"></select>
                <span class="chip temp-chip" id="tempModelChip"></span>
                <button class="action-btn-icon temp-params-toggle" id="tempParamsBtn" type="button"><span class="codicon codicon-settings-gear"></span></button>
                <span class="chip temp-chip" id="tempParamsChip"></span>
                <span class="chip mcp-health-chip" id="mcpHealthChip" title=""></span>
                <div class="temp-params-popup" id="tempParamsPopup">
                  <div class="temp-params-popup-header">
                    <span id="tempParamsTitle"></span>
                    <button class="action-btn-icon" id="tempParamsResetBtn" type="button"><span class="codicon codicon-discard"></span></button>
                  </div>
                  <div class="temp-params-popup-body">
                    <label class="temp-params-field"><span id="tempParamsTempLabel"></span><input type="number" id="tempParamsTemp" step="0.1" min="0" max="2"></label>
                    <label class="temp-params-field"><span id="tempParamsTopPLabel"></span><input type="number" id="tempParamsTopP" step="0.1" min="0" max="1"></label>
                    <label class="temp-params-field"><span id="tempParamsMaxTokensLabel"></span><input type="number" id="tempParamsMaxTokens" step="1" min="0" max="65535"></label>
                    <label class="temp-params-field"><span id="tempParamsPresenceLabel"></span><input type="number" id="tempParamsPresence" step="0.1" min="-2" max="2"></label>
                    <label class="temp-params-field"><span id="tempParamsFrequencyLabel"></span><input type="number" id="tempParamsFrequency" step="0.1" min="-2" max="2"></label>
                  </div>
                </div>
              </div>
              <div class="send-group">
                <button class="btn-primary" id="sendBtn" type="button"></button>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
${TOAST_CONTAINER_HTML}
    <div class="raw-modal-overlay" id="rawModalOverlay">
      <div class="raw-modal">
        <div class="raw-modal-header">
          <span class="raw-modal-title" id="rawModalTitle"></span>
          <button class="raw-modal-close" id="rawModalClose" type="button"><span class="codicon codicon-close"></span></button>
        </div>
        <div class="raw-modal-body" id="rawModalBody"></div>
      </div>
    </div>
    <div class="raw-modal-overlay" id="toolContinuationOverlay">
      <div class="raw-modal" style="width:min(520px,90%);max-height:none;">
        <div class="raw-modal-header">
          <span class="raw-modal-title" id="toolContinuationTitle"></span>
        </div>
        <div class="raw-modal-body">
          <div class="confirm-copy" id="toolContinuationDescription"></div>
          <div class="confirm-actions">
            <button class="btn-secondary" id="toolContinuationCancelBtn" type="button"></button>
            <button class="btn-primary" id="toolContinuationContinueBtn" type="button"></button>
          </div>
        </div>
      </div>
    </div>
`;
}
