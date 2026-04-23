/**
 * 助手编辑器 WebView JavaScript 脚本。
 *
 * 从 assistantEditorPanel 的 getHtml 方法中提取的客户端 JS。
 */
import { TOAST_CONTAINER_HTML, getToastScript } from './webviewShared';
import { getHtmlEscaperScript } from './utils';

export function getAssistantEditorHtmlBody(): string {
  return `    <div class="shell">
      <div class="hero">
        <div>
          <h1 class="hero-title" id="title"></h1>
          <div class="hero-copy" id="description"></div>
        </div>
        <button class="btn-primary" id="saveBtn" type="button"></button>
      </div>

      <div class="grid">
        <section class="section">
          <h2 class="section-title" id="baseSectionTitle"></h2>
          <div class="field-grid">
            <div class="field">
              <label for="name" id="nameLabel"></label>
              <input id="name" type="text" />
            </div>
            <div class="field">
              <label id="avatarLabel"></label>
              <div class="avatar-picker">
                <div class="avatar-preview" id="avatarPreview">
                  <span class="avatar-preview-icon codicon" id="avatarPreviewIcon"></span>
                  <span class="avatar-preview-text" id="avatarPreviewText"></span>
                </div>
                <button id="avatarSelectBtn" class="btn-secondary" type="button"></button>
              </div>
              <input id="avatar" type="hidden" />
            </div>
            <div class="field full">
              <label for="groupId" id="groupLabel"></label>
              <select id="groupId"></select>
            </div>
            <div class="field full">
              <label for="note" id="noteLabel"></label>
              <textarea id="note" class="note-textarea"></textarea>
            </div>
          </div>
        </section>

        <section class="section">
          <h2 class="section-title" id="modelSectionTitle"></h2>
          <div class="field-grid">
            <div class="field full">
              <label for="modelRef" id="modelLabel"></label>
              <select id="modelRef"></select>
            </div>
            <div class="field full">
              <div class="checkbox-row">
                <input id="streaming" type="checkbox" />
                <label for="streaming" id="streamingLabel"></label>
              </div>
            </div>
          </div>
        </section>

        <section class="section">
          <h2 class="section-title" id="mcpSectionTitle"></h2>
          <div class="field-grid">
            <div class="field full">
              <label id="mcpServersLabel"></label>
              <div class="mcp-server-check-list" id="mcpServerCheckList"></div>
            </div>
          </div>
        </section>

        <section class="section">
          <h2 class="section-title" id="promptSectionTitle"></h2>
          <div class="field-grid">
            <div class="field full">
              <label for="greeting" id="greetingLabel"></label>
              <textarea id="greeting"></textarea>
            </div>
            <div class="field full">
              <label for="systemPrompt" id="promptLabel"></label>
              <textarea id="systemPrompt"></textarea>
            </div>
            <div class="field full">
              <label for="questionPrefix" id="questionPrefixLabel"></label>
              <textarea id="questionPrefix"></textarea>
            </div>
          </div>
        </section>

        <section class="section">
          <h2 class="section-title" id="paramsSectionTitle"></h2>
          <div class="field-grid">
            <div class="field">
              <label for="temperature" id="temperatureLabel"></label>
              <input id="temperature" type="number" min="0" max="2" step="0.1" />
            </div>
            <div class="field">
              <label for="topP" id="topPLabel"></label>
              <input id="topP" type="number" min="0" max="1" step="0.1" />
            </div>
            <div class="field">
              <label for="maxTokens" id="maxTokensLabel"></label>
              <input id="maxTokens" type="number" min="0" max="65535" step="1" />
            </div>
            <div class="field">
              <label for="contextCount" id="contextCountLabel"></label>
              <input id="contextCount" type="number" min="0" step="1" />
            </div>
            <div class="field">
              <label for="presencePenalty" id="presencePenaltyLabel"></label>
              <input id="presencePenalty" type="number" min="-2" max="2" step="0.1" />
            </div>
            <div class="field">
              <label for="frequencyPenalty" id="frequencyPenaltyLabel"></label>
              <input id="frequencyPenalty" type="number" min="-2" max="2" step="0.1" />
            </div>
          </div>
        </section>
      </div>

    </div>
${TOAST_CONTAINER_HTML}`;
}

export function getAssistantEditorJs(): string {
  return `
      const vscode = acquireVsCodeApi();
      const dom = {
        title: document.getElementById('title'),
        description: document.getElementById('description'),
        saveBtn: document.getElementById('saveBtn'),
        baseSectionTitle: document.getElementById('baseSectionTitle'),
        promptSectionTitle: document.getElementById('promptSectionTitle'),
        modelSectionTitle: document.getElementById('modelSectionTitle'),
        mcpSectionTitle: document.getElementById('mcpSectionTitle'),
        paramsSectionTitle: document.getElementById('paramsSectionTitle'),
        nameLabel: document.getElementById('nameLabel'),
        noteLabel: document.getElementById('noteLabel'),
        avatarLabel: document.getElementById('avatarLabel'),
        avatarSelectBtn: document.getElementById('avatarSelectBtn'),
        greetingLabel: document.getElementById('greetingLabel'),
        promptLabel: document.getElementById('promptLabel'),
        questionPrefixLabel: document.getElementById('questionPrefixLabel'),
        groupLabel: document.getElementById('groupLabel'),
        modelLabel: document.getElementById('modelLabel'),
        streamingLabel: document.getElementById('streamingLabel'),
        mcpServersLabel: document.getElementById('mcpServersLabel'),
        temperatureLabel: document.getElementById('temperatureLabel'),
        topPLabel: document.getElementById('topPLabel'),
        maxTokensLabel: document.getElementById('maxTokensLabel'),
        contextCountLabel: document.getElementById('contextCountLabel'),
        presencePenaltyLabel: document.getElementById('presencePenaltyLabel'),
        frequencyPenaltyLabel: document.getElementById('frequencyPenaltyLabel'),
        name: document.getElementById('name'),
        note: document.getElementById('note'),
        avatar: document.getElementById('avatar'),
        avatarPreviewIcon: document.getElementById('avatarPreviewIcon'),
        avatarPreviewText: document.getElementById('avatarPreviewText'),
        greeting: document.getElementById('greeting'),
        systemPrompt: document.getElementById('systemPrompt'),
        questionPrefix: document.getElementById('questionPrefix'),
        groupId: document.getElementById('groupId'),
        modelRef: document.getElementById('modelRef'),
        streaming: document.getElementById('streaming'),
        mcpServerCheckList: document.getElementById('mcpServerCheckList'),
        temperature: document.getElementById('temperature'),
        topP: document.getElementById('topP'),
        maxTokens: document.getElementById('maxTokens'),
        contextCount: document.getElementById('contextCount'),
        presencePenalty: document.getElementById('presencePenalty'),
        frequencyPenalty: document.getElementById('frequencyPenalty'),
        toastStack: document.getElementById('toastStack')
      };

      let state = null;
      let lastToastNotice = '';

${getToastScript()}
${getHtmlEscaperScript()}

      function renderText(strings) {
        dom.title.textContent = strings.assistantEditorTitle;
        dom.description.textContent = strings.assistantEditorDescription;
        dom.saveBtn.textContent = strings.assistantSaveAction;
        dom.baseSectionTitle.textContent = strings.assistantBaseSection;
        dom.promptSectionTitle.textContent = strings.assistantPromptSection;
        dom.modelSectionTitle.textContent = strings.assistantModelSection;
        dom.mcpSectionTitle.textContent = strings.assistantMcpSection || 'MCP';
        dom.paramsSectionTitle.textContent = strings.assistantParamsSection;
        dom.nameLabel.textContent = strings.assistantNameLabel;
        dom.noteLabel.textContent = strings.assistantNoteLabel;
        dom.avatarLabel.textContent = strings.assistantAvatarLabel;
        dom.avatarSelectBtn.textContent = strings.assistantAvatarSelectAction;
        dom.greetingLabel.textContent = strings.assistantGreetingLabel;
        dom.promptLabel.textContent = strings.assistantPromptLabel;
        dom.questionPrefixLabel.textContent = strings.assistantQuestionPrefixLabel;
        dom.groupLabel.textContent = strings.assistantGroupLabel;
        dom.modelLabel.textContent = strings.assistantModelLabel;
        dom.streamingLabel.textContent = strings.assistantStreamingLabel;
        dom.mcpServersLabel.textContent = strings.mcpServersLabel || 'MCP Servers';
        dom.temperatureLabel.textContent = strings.temperatureLabel;
        dom.topPLabel.textContent = strings.topPLabel;
        dom.maxTokensLabel.textContent = strings.maxTokensLabel;
        dom.contextCountLabel.textContent = strings.contextCountLabel;
        dom.presencePenaltyLabel.textContent = strings.presencePenaltyLabel;
        dom.frequencyPenaltyLabel.textContent = strings.frequencyPenaltyLabel;
        dom.saveBtn.title = strings.assistantSaveAction;
        dom.avatarSelectBtn.title = strings.assistantAvatarSelectAction;
        dom.groupId.title = strings.assistantGroupLabel;
        dom.modelRef.title = strings.assistantModelLabel;
      }

      function renderOptions() {
        dom.groupId.innerHTML = (state.groups || []).map((group) => {
          return '<option value="' + escapeHtml(group.id) + '">' + escapeHtml(group.name) + '</option>';
        }).join('');
        dom.modelRef.innerHTML = (state.models || []).map((model) => {
          return '<option value="' + escapeHtml(model.ref) + '">' + escapeHtml(model.label + (model.metaLabel || '')) + '</option>';
        }).join('');
        dom.mcpServerCheckList.innerHTML = (state.mcpServers || []).map((server) => {
          const transportLabel = server.transport === 'streamableHttp'
            ? 'HTTP'
            : server.transport === 'sse'
              ? 'SSE'
              : 'stdio';
          return '<label class="mcp-server-check-item">' +
            '<input type="checkbox" value="' + escapeHtml(server.id) + '" />' +
            '<span>' + escapeHtml(server.name) + '</span>' +
            '<span class="mcp-server-transport">' + escapeHtml(transportLabel) + '</span>' +
          '</label>';
        }).join('');
      }

      function ensureModelOption(modelRef) {
        if (!modelRef) {
          return;
        }
        const exists = Array.from(dom.modelRef.options).some((option) => option.value === modelRef);
        if (!exists) {
          const option = document.createElement('option');
          option.value = modelRef;
          option.textContent = modelRef;
          dom.modelRef.appendChild(option);
        }
      }

      function normalizeAvatarValue(value) {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw || !/^[a-z0-9-]+$/.test(raw)) {
          return 'account';
        }
        return raw;
      }

      function renderAvatarPreview() {
        const avatar = normalizeAvatarValue(dom.avatar.value);
        dom.avatar.value = avatar;
        dom.avatarPreviewIcon.className = 'avatar-preview-icon codicon codicon-' + avatar;
        const beforeContent = window.getComputedStyle(dom.avatarPreviewIcon, '::before').content;
        const hasGlyph = Boolean(beforeContent && beforeContent !== 'none' && beforeContent !== '""');
        if (!hasGlyph && avatar !== 'account') {
          dom.avatar.value = 'account';
          dom.avatarPreviewIcon.className = 'avatar-preview-icon codicon codicon-account';
          dom.avatarPreviewText.textContent = 'account';
          return;
        }
        dom.avatarPreviewText.textContent = avatar;
      }

      function renderValues() {
        const assistant = state.assistant;
        dom.name.value = assistant.name || '';
        dom.note.value = assistant.note || '';
        dom.avatar.value = normalizeAvatarValue(assistant.avatar || 'account');
        dom.greeting.value = assistant.greeting || '';
        dom.systemPrompt.value = assistant.systemPrompt || '';
        dom.questionPrefix.value = assistant.questionPrefix || '';
        dom.groupId.value = assistant.groupId || '';
        ensureModelOption(assistant.modelRef);
        dom.modelRef.value = assistant.modelRef || '';
        dom.streaming.checked = !!assistant.streaming;
        const enabledIds = new Set(assistant.enabledMcpServerIds || []);
        Array.from(dom.mcpServerCheckList.querySelectorAll('input[type="checkbox"]')).forEach((cb) => {
          cb.checked = enabledIds.has(cb.value);
        });
        dom.temperature.value = String(assistant.temperature ?? 0.7);
        dom.topP.value = String(assistant.topP ?? 1);
        dom.maxTokens.value = String(assistant.maxTokens ?? 0);
        dom.contextCount.value = String(assistant.contextCount ?? 16);
        dom.presencePenalty.value = String(assistant.presencePenalty ?? 0);
        dom.frequencyPenalty.value = String(assistant.frequencyPenalty ?? 0);
        renderAvatarPreview();
      }

      function renderAll() {
        renderText(state.strings);
        renderOptions();
        renderValues();
      }

      function collectPayload() {
        return {
          name: dom.name.value,
          note: dom.note.value,
          avatar: dom.avatar.value.trim(),
          greeting: dom.greeting.value,
          systemPrompt: dom.systemPrompt.value,
          questionPrefix: dom.questionPrefix.value,
          groupId: dom.groupId.value,
          modelRef: dom.modelRef.value,
          streaming: !!dom.streaming.checked,
          enabledMcpServerIds: Array.from(dom.mcpServerCheckList.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value),
          temperature: Number.parseFloat(dom.temperature.value),
          topP: Number.parseFloat(dom.topP.value),
          maxTokens: Number.parseInt(dom.maxTokens.value, 10),
          contextCount: Number.parseInt(dom.contextCount.value, 10),
          presencePenalty: Number.parseFloat(dom.presencePenalty.value),
          frequencyPenalty: Number.parseFloat(dom.frequencyPenalty.value)
        };
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type === 'avatarPicked') {
          const pickedIcon = message?.payload?.icon;
          if (typeof pickedIcon === 'string' && pickedIcon.trim()) {
            dom.avatar.value = normalizeAvatarValue(pickedIcon);
            renderAvatarPreview();
          }
          return;
        }
        if (message?.type !== 'state') {
          return;
        }
        state = message.payload;
        renderAll();
        if (state.notice) {
          const tone = state.notice === state.strings.assistantSaved ? 'success' : 'error';
          if (state.notice !== lastToastNotice) {
            showToast(state.notice, tone);
          }
          lastToastNotice = state.notice;
        } else {
          lastToastNotice = '';
        }
      });

      dom.avatarSelectBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'pickAvatar',
          currentAvatar: dom.avatar.value
        });
      });

      dom.saveBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'save',
          payload: collectPayload()
        });
      });

      vscode.postMessage({ type: 'ready' });
`;
}
