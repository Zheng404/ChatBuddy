import { TOAST_CONTAINER_HTML } from './webviewShared';

/** Returns the HTML body for the chat webview panel. */
export function getChatBodyHtml(): string {
  return `
    <div class="layout">
      <section class="content" id="content">
        <section class="stage">
          <div class="messages" id="messages">
            <div class="messages-inner" id="messagesInner"></div>
          </div>
        </section>
      </section>

      <footer class="composer-shell">
        <div class="composer">
          <div class="composer-box">
            <div class="composer-resizer" id="composerResizer"></div>
            <textarea class="composer-textarea" id="composerInput"></textarea>
            <div class="composer-actions">
              <div class="composer-inline-controls">
                <button class="action-btn-icon" id="clearBtn" type="button"><span class="codicon codicon-clear-all"></span></button>
                <select id="tempModelSelect" class="model-select"></select>
                <span class="chip temp-chip" id="tempModelChip"></span>
              </div>
              <div class="send-group">
                <label class="toggle">
                  <input type="checkbox" id="streamingToggle" />
                  <span id="streamingLabel"></span>
                </label>
                <button class="action-btn secondary" id="stopBtn" type="button"></button>
                <button class="action-btn primary" id="sendBtn" type="button"></button>
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
            <button class="action-btn secondary" id="toolContinuationCancelBtn" type="button"></button>
            <button class="action-btn primary" id="toolContinuationContinueBtn" type="button"></button>
          </div>
        </div>
      </div>
    </div>
`;
}
