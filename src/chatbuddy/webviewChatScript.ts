/**
 * 聊天 WebView 主脚本组装模块。
 *
 * 将多个 JS 片段（事件处理、Markdown 渲染、UI 交互）组装为单个脚本块，
 * 注入到聊天 WebView 中。包含 KaTeX 和 Mermaid 的初始化逻辑。
 */
import { getToastScript } from './webviewShared';
import { getHtmlEscaperScript } from './utils/html';
import { getChatEventScript } from './webviewChatScriptEvents';
import { getChatMarkdownRendererScript } from './webviewChatScriptMarkdown';
import { getChatUiScript } from './webviewChatScriptUi';

const LATEX_DISPLAY_BLOCK_PATTERN = String.raw`/\\\[([\s\S]+?)\\\]/g`;
const LATEX_INLINE_BLOCK_PATTERN = String.raw`/\\\(([\s\S]+?)\\\)/g`;
const LATEX_ENV_BLOCK_PATTERN = String.raw`/\\begin\{(equation\*?|align\*?|gather\*?|aligned|cases|split|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|array|cd|CD|darray)\}([\s\S]+?)\\end\{\1\}/g`;

export function getChatScript(args: { nonce: string }): string {
  const { nonce } = args;
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
        composerBox: document.querySelector('.composer-box'),
        composerToolbar: document.getElementById('composerToolbar'),
        composerInput: document.getElementById('composerInput'),
        imagePreviewBar: document.getElementById('imagePreviewBar'),
        filePreviewBar: document.getElementById('filePreviewBar'),
        sendBtn: document.getElementById('sendBtn'),
        clearBtn: document.getElementById('clearBtn'),
        attachFileBtn: document.getElementById('attachFileBtn'),
        attachImageBtn: document.getElementById('attachImageBtn'),
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
        toolContinuationContinueBtn: document.getElementById('toolContinuationContinueBtn'),
        searchBar: document.getElementById('searchBar'),
        searchInput: document.getElementById('searchInput'),
        searchCount: document.getElementById('searchCount'),
        searchPrevBtn: document.getElementById('searchPrevBtn'),
        searchNextBtn: document.getElementById('searchNextBtn'),
        searchCloseBtn: document.getElementById('searchCloseBtn'),
        searchBtn: document.getElementById('searchBtn')
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

      // Global error boundary: report unhandled errors to extension host
      window.addEventListener('error', function(e) {
        console.error('[ChatBuddy] unhandled error:', e.error);
        if (vscode && typeof vscode.postMessage === 'function') {
          vscode.postMessage({
            type: 'error',
            payload: { message: e.message || 'Unknown error', source: 'window.onerror' }
          });
        }
      });
      window.addEventListener('unhandledrejection', function(e) {
        console.error('[ChatBuddy] unhandled rejection:', e.reason);
        if (vscode && typeof vscode.postMessage === 'function') {
          vscode.postMessage({
            type: 'error',
            payload: { message: String(e.reason || 'Unknown rejection'), source: 'unhandledrejection' }
          });
        }
      });

      const renderSigs = {
        messages: '',
        composer: ''
      };
      let lastStateError = '';
      let optimisticSendState;
      let optimisticSendRestoreTimer = 0;
      const COMPOSER_MIN_HEIGHT = 100;
      const COMPOSER_MAX_HEIGHT = 340;
      let isResizingComposer = false;
      let composerResizeStartY = 0;
      let composerResizeStartHeight = 0;
      let toolContinuationActionPending = false;
      let editingMessageId = '';
      let editingSessionId = '';
      let pendingImages = [];
      let pendingFiles = [];

      function clearPendingImages() {
        pendingImages = [];
        renderImagePreviews();
      }

      function clearPendingFiles() {
        pendingFiles = [];
        renderFilePreviews();
      }

      function getLanguageFromFileName(fileName) {
        var ext = String(fileName || '').split('.').pop().toLowerCase();
        var map = {
          ts: 'typescript', js: 'javascript', jsx: 'jsx', tsx: 'tsx',
          py: 'python', rs: 'rust', go: 'go', java: 'java',
          cpp: 'cpp', c: 'c', h: 'c', cs: 'csharp',
          rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
          scala: 'scala', html: 'html', css: 'css', scss: 'scss',
          less: 'less', json: 'json', yaml: 'yaml', yml: 'yaml',
          xml: 'xml', sql: 'sql', sh: 'bash', bash: 'bash',
          zsh: 'bash', md: 'markdown', vue: 'vue', svelte: 'svelte',
          dockerfile: 'dockerfile', tf: 'terraform', graphql: 'graphql',
          ini: 'ini', conf: 'ini', cfg: 'ini', properties: 'properties',
          gradle: 'groovy', mvn: 'xml', npmrc: 'ini', gitignore: 'gitignore',
          env: 'bash', lock: 'json', csv: 'csv', svg: 'xml'
        };
        return map[ext] || ext || '';
      }

      function isTextFile(file) {
        if (file.type && file.type.startsWith('text/')) { return true; }
        if (file.type && file.type.startsWith('application/')) {
          var textual = ['json', 'xml', 'javascript', 'typescript', 'yaml', 'yml', 'sql', 'graphql'];
          for (var i = 0; i < textual.length; i++) {
            if (file.type.indexOf(textual[i]) !== -1) { return true; }
          }
        }
        var name = String(file.name || '').toLowerCase();
        var textExts = ['.ts','.js','.jsx','.tsx','.py','.rs','.go','.java','.cpp','.c','.h','.cs',
          '.rb','.php','.swift','.kt','.scala','.html','.css','.scss','.less','.json','.yaml','.yml',
          '.xml','.sql','.sh','.bash','.zsh','.md','.txt','.vue','.svelte','.dockerfile',
          '.tf','.graphql','.ini','.conf','.cfg','.properties','.gradle','.mvn','.npmrc','.gitignore',
          '.env','.lock','.csv','.svg','.dockerignore','.prettierrc','.eslintrc'];
        for (var j = 0; j < textExts.length; j++) {
          if (name.endsWith(textExts[j])) { return true; }
        }
        if (name.indexOf('.') === -1) { return true; }
        return false;
      }

      function renderFilePreviews() {
        dom.filePreviewBar.innerHTML = '';
        if (!pendingFiles.length) {
          dom.filePreviewBar.style.display = 'none';
          return;
        }
        dom.filePreviewBar.style.display = 'flex';
        pendingFiles.forEach(function(file, idx) {
          var item = document.createElement('div');
          item.className = 'file-preview-item';
          var nameEl = document.createElement('span');
          nameEl.className = 'file-preview-name';
          nameEl.textContent = file.name;
          item.appendChild(nameEl);
          var removeBtn = document.createElement('button');
          removeBtn.className = 'file-preview-remove';
          removeBtn.type = 'button';
          removeBtn.innerHTML = '<span class="codicon codicon-close"></span>';
          removeBtn.title = state.strings.fileRemove || '';
          removeBtn.addEventListener('click', function() {
            pendingFiles.splice(idx, 1);
            renderFilePreviews();
          });
          item.appendChild(removeBtn);
          dom.filePreviewBar.appendChild(item);
        });
      }

      function _fmt(template, values) {
        return template.replace(/{([^}]+)}/g, function(_m, key) {
          return values && values[key] !== undefined ? String(values[key]) : '';
        });
      }

      // Note: File drag-and-drop is not supported in VS Code WebViews.
      // Users should use the "Attach files" button or paste files instead.

      function renderImagePreviews() {
        dom.imagePreviewBar.innerHTML = '';
        if (!pendingImages.length) {
          dom.imagePreviewBar.style.display = 'none';
          return;
        }
        dom.imagePreviewBar.style.display = 'flex';
        pendingImages.forEach(function(img, idx) {
          var wrapper = document.createElement('div');
          wrapper.className = 'image-preview-item';
          if (!img.base64) { return; }
          var imgEl = document.createElement('img');
          imgEl.src = 'data:' + img.mimeType + ';base64,' + img.base64;
          imgEl.className = 'image-preview-thumb';
          wrapper.appendChild(imgEl);
          var removeBtn = document.createElement('button');
          removeBtn.className = 'image-preview-remove';
          removeBtn.type = 'button';
          removeBtn.innerHTML = '<span class="codicon codicon-close"></span>';
          removeBtn.title = state.strings.imageRemove || '';
          removeBtn.addEventListener('click', function() {
            pendingImages.splice(idx, 1);
            renderImagePreviews();
          });
          wrapper.appendChild(removeBtn);
          dom.imagePreviewBar.appendChild(wrapper);
        });
      }

      function handleImagePaste(e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) { return; }
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== 0) { continue; }
          var file = items[i].getAsFile();
          if (!file) { continue; }
          e.preventDefault();
          (function(f) {
            var reader = new FileReader();
            reader.onload = function(ev) {
              var dataUrl = ev.target.result;
              var parts = dataUrl.split(',');
              var mimeMatch = parts[0].match(new RegExp(':(.*?);'));
              var mime = mimeMatch ? mimeMatch[1] : 'image/png';
              var b64 = parts[1];
              pendingImages.push({ base64: b64, mimeType: mime });
              renderImagePreviews();
            };
            reader.readAsDataURL(f);
          })(file);
        }
      }

      function handleFilePaste(e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) { return; }
        var handled = false;
        var maxSize = 100 * 1024;
        var maxLines = 500;
        for (var i = 0; i < items.length; i++) {
          if (items[i].kind !== 'file') { continue; }
          var file = items[i].getAsFile();
          if (!file) { continue; }
          if (!isTextFile(file)) { continue; }
          e.preventDefault();
          handled = true;
          (function(f) {
            var reader = new FileReader();
            reader.onload = function(ev) {
              var content = String(ev.target.result || '');
              if (content.length > maxSize) {
                var lines = content.split('\\n');
                if (lines.length > maxLines) {
                  content = lines.slice(0, maxLines).join('\\n') + '\\n// ... (' + (state.strings.fileTooLarge ? state.strings.fileTooLarge.replace(/{name}/g, f.name) : 'truncated') + ')';
                } else {
                  content = content.substring(0, maxSize) + '\\n// ... (' + (state.strings.fileTooLarge ? state.strings.fileTooLarge.replace(/{name}/g, f.name) : 'truncated') + ')';
                }
                var warnTmpl = state.strings.fileTooLarge || 'File too large, truncated: {name}';
                showToast(_fmt(warnTmpl, { name: f.name }), 'warning');
              }
              pendingFiles.push({
                name: f.name,
                content: content,
                language: getLanguageFromFileName(f.name)
              });
              renderFilePreviews();
            };
            reader.onerror = function() {
              var readErrTmpl = state.strings.fileReadError || 'Failed to read file: {name}';
              showToast(_fmt(readErrTmpl, { name: f.name }), 'error');
            };
            reader.readAsText(f);
          })(file);
        }
        return handled;
      }

      function getCurrentModelRef() {
        var tempModelRef = String(state.sessionTempModelRef || '').trim();
        if (tempModelRef) {
          return tempModelRef;
        }
        return String(state.selectedAssistant?.modelRef || '').trim();
      }

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
