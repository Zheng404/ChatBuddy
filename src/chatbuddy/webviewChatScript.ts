import { getToastScript } from './webviewShared';
import { getHtmlEscaperScript } from './utils/html';
import { getChatEventScript } from './webviewChatScriptEvents';
import { getChatMarkdownRendererScript } from './webviewChatScriptMarkdown';
import { getChatUiScript } from './webviewChatScriptUi';

const LATEX_DISPLAY_BLOCK_PATTERN = String.raw`/\\\[([\s\S]+?)\\\]/g`;
const LATEX_INLINE_BLOCK_PATTERN = String.raw`/\\\(([\s\S]+?)\\\)/g`;
const LATEX_ENV_BLOCK_PATTERN = String.raw`/\\begin\{(equation\*?|align\*?|gather\*?|aligned|cases|split|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|array|cd|CD|darray)\}([\s\S]+?)\\end\{\1\}/g`;

export function getChatScript(nonce: string): string {
  return `
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();

      const icons = {
        send: '<span class="codicon codicon-send"></span>',
        stop: '<span class="codicon codicon-debug-stop"></span>',
        regenerateReply: '<span class="codicon codicon-refresh"></span>',
        regenerateFrom: '<span class="codicon codicon-debug-restart"></span>',
        edit: '<span class="codicon codicon-edit"></span>',
        copy: '<span class="codicon codicon-copy"></span>',
        delete: '<span class="codicon codicon-trash"></span>',
        rawText: '<span class="codicon codicon-code"></span>',
        tool: '<span class="codicon codicon-tools"></span>'
      };

      const dom = {
        content: document.getElementById('content'),
        messages: document.getElementById('messages'),
        messagesInner: document.getElementById('messagesInner'),
        composerResizer: document.getElementById('composerResizer'),
        composerInput: document.getElementById('composerInput'),
        sendBtn: document.getElementById('sendBtn'),
        stopBtn: document.getElementById('stopBtn'),
        clearBtn: document.getElementById('clearBtn'),
        tempModelSelect: document.getElementById('tempModelSelect'),
        tempModelChip: document.getElementById('tempModelChip'),
        streamingToggle: document.getElementById('streamingToggle'),
        streamingLabel: document.getElementById('streamingLabel'),
        toastStack: document.getElementById('toastStack'),
        rawModalOverlay: document.getElementById('rawModalOverlay'),
        rawModalTitle: document.getElementById('rawModalTitle'),
        rawModalClose: document.getElementById('rawModalClose'),
        rawModalBody: document.getElementById('rawModalBody'),
        toolContinuationOverlay: document.getElementById('toolContinuationOverlay'),
        toolContinuationTitle: document.getElementById('toolContinuationTitle'),
        toolContinuationDescription: document.getElementById('toolContinuationDescription'),
        toolContinuationCancelBtn: document.getElementById('toolContinuationCancelBtn'),
        toolContinuationContinueBtn: document.getElementById('toolContinuationContinueBtn')
      };

      let state = {
        locale: 'en',
        strings: {},
        assistants: [],
        selectedAssistant: undefined,
        selectedAssistantId: undefined,
        sessions: [],
        selectedSessionId: undefined,
        selectedSession: undefined,
        sessionPanelCollapsed: false,
        providerLabel: '-',
        modelLabel: '-',
        modelOptions: [],
        mcpServers: [],
        sessionTempModelRef: '',
        sendShortcut: 'enter',
        streaming: true,
        isGenerating: false,
        canChat: false,
        awaitingToolContinuation: false,
        pendingToolCallCount: 0,
        toolRoundLimit: 0,
        readOnlyReason: ''
      };

      if (typeof mermaid !== 'undefined') {
        var bg = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background').trim();
        var isDark = !bg || bg < '#888888';
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'loose'
        });
      }

      const renderSigs = {
        messages: '',
        composer: ''
      };
      let lastStateError = '';
      const COMPOSER_MIN_HEIGHT = 100;
      const COMPOSER_MAX_HEIGHT = 340;
      let isResizingComposer = false;
      let composerResizeStartY = 0;
      let composerResizeStartHeight = 0;
      let toolContinuationActionPending = false;
      let editingMessageId = '';
      let editingSessionId = '';

      function clearMessageEditState(clearInput) {
        editingMessageId = '';
        editingSessionId = '';
        if (clearInput) {
          dom.composerInput.value = '';
        }
      }

      function syncMessageEditState() {
        if (!editingMessageId) {
          return false;
        }
        if (!state.selectedSession || state.selectedSession.id !== editingSessionId) {
          clearMessageEditState(true);
          return true;
        }
        const exists = (state.selectedSession.messages || []).some((message) => message.id === editingMessageId);
        if (exists) {
          return false;
        }
        clearMessageEditState(true);
        return true;
      }

      function clampComposerHeight(value) {
        return Math.max(COMPOSER_MIN_HEIGHT, Math.min(COMPOSER_MAX_HEIGHT, Math.round(value)));
      }

${getToastScript()}
${getHtmlEscaperScript()}
${getChatMarkdownRendererScript({
  latexDisplayPattern: LATEX_DISPLAY_BLOCK_PATTERN,
  latexInlinePattern: LATEX_INLINE_BLOCK_PATTERN,
  latexEnvPattern: LATEX_ENV_BLOCK_PATTERN
})}
${getChatUiScript()}
${getChatEventScript()}
    </script>
`;
}
