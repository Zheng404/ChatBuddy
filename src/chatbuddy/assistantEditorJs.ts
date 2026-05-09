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
              <label for="failoverModelRefs" id="failoverModelsLabel"></label>
              <div class="failover-help" id="failoverModelsHelp"></div>
              <div class="failover-check-list" id="failoverModelCheckList"></div>
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

        <section class="section collapsible-section">
          <button class="collapsible-header" id="advancedToggle" type="button">
            <h2 class="section-title" id="advancedSectionTitle"></h2>
            <span class="collapsible-icon codicon codicon-chevron-down"></span>
          </button>
          <div class="collapsible-body" id="advancedBody">
            <div class="field-grid">
              <div class="field full">
                <label class="sub-section-label" id="overridesSubSectionLabel"></label>
              </div>
              <div class="field full">
                <label for="overridesApiKey" id="overridesApiKeyLabel"></label>
                <input id="overridesApiKey" type="password" autocomplete="off" />
              </div>
              <div class="field full">
                <label for="overridesBaseUrl" id="overridesBaseUrlLabel"></label>
                <input id="overridesBaseUrl" type="text" />
              </div>
              <div class="field full">
                <label for="overridesModel" id="overridesModelLabel"></label>
                <input id="overridesModel" type="text" />
              </div>
              <div class="field">
                <label for="overridesTemperature" id="overridesTemperatureLabel"></label>
                <input id="overridesTemperature" type="number" min="0" max="2" step="0.1" />
              </div>
              <div class="field full">
                <label class="sub-section-label" id="advancedParamsSubSectionLabel"></label>
              </div>
              <div class="field full">
                <label for="stopSequences" id="stopSequencesLabel"></label>
                <input id="stopSequences" type="text" />
              </div>
              <div class="field">
                <label for="seed" id="seedLabel"></label>
                <input id="seed" type="number" step="1" />
              </div>
              <div class="field">
                <label for="responseFormat" id="responseFormatLabel"></label>
                <select id="responseFormat">
                  <option value="">-</option>
                  <option value="text">text</option>
                  <option value="json_object">json_object</option>
                </select>
              </div>
              <div class="field">
                <label for="toolChoice" id="toolChoiceLabel"></label>
                <select id="toolChoice">
                  <option value="">-</option>
                  <option value="auto">auto</option>
                  <option value="none">none</option>
                  <option value="required">required</option>
                </select>
              </div>
              <div class="field">
                <label for="geminiSafetyLevel" id="geminiSafetyLevelLabel"></label>
                <select id="geminiSafetyLevel">
                  <option value="">-</option>
                  <option value="default">default</option>
                  <option value="none">none</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </div>
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
        failoverModelsLabel: document.getElementById('failoverModelsLabel'),
        failoverModelsHelp: document.getElementById('failoverModelsHelp'),
        failoverModelCheckList: document.getElementById('failoverModelCheckList'),
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
        toastStack: document.getElementById('toastStack'),
        advancedToggle: document.getElementById('advancedToggle'),
        advancedSectionTitle: document.getElementById('advancedSectionTitle'),
        advancedBody: document.getElementById('advancedBody'),
        overridesSubSectionLabel: document.getElementById('overridesSubSectionLabel'),
        overridesApiKeyLabel: document.getElementById('overridesApiKeyLabel'),
        overridesBaseUrlLabel: document.getElementById('overridesBaseUrlLabel'),
        overridesModelLabel: document.getElementById('overridesModelLabel'),
        overridesTemperatureLabel: document.getElementById('overridesTemperatureLabel'),
        advancedParamsSubSectionLabel: document.getElementById('advancedParamsSubSectionLabel'),
        stopSequencesLabel: document.getElementById('stopSequencesLabel'),
        seedLabel: document.getElementById('seedLabel'),
        responseFormatLabel: document.getElementById('responseFormatLabel'),
        toolChoiceLabel: document.getElementById('toolChoiceLabel'),
        geminiSafetyLevelLabel: document.getElementById('geminiSafetyLevelLabel'),
        overridesApiKey: document.getElementById('overridesApiKey'),
        overridesBaseUrl: document.getElementById('overridesBaseUrl'),
        overridesModel: document.getElementById('overridesModel'),
        overridesTemperature: document.getElementById('overridesTemperature'),
        stopSequences: document.getElementById('stopSequences'),
        seed: document.getElementById('seed'),
        responseFormat: document.getElementById('responseFormat'),
        toolChoice: document.getElementById('toolChoice'),
        geminiSafetyLevel: document.getElementById('geminiSafetyLevel')
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
        dom.failoverModelsLabel.textContent = strings.failoverModelsLabel || 'Failover Models';
        dom.failoverModelsHelp.textContent = strings.failoverModelsHelp || '';
        dom.mcpServersLabel.textContent = strings.mcpServersLabel || 'MCP Servers';
        dom.temperatureLabel.textContent = strings.temperatureLabel;
        dom.topPLabel.textContent = strings.topPLabel;
        dom.maxTokensLabel.textContent = strings.maxTokensLabel;
        dom.contextCountLabel.textContent = strings.contextCountLabel;
        dom.presencePenaltyLabel.textContent = strings.presencePenaltyLabel;
        dom.frequencyPenaltyLabel.textContent = strings.frequencyPenaltyLabel;
        dom.advancedSectionTitle.textContent = strings.assistantAdvancedSection || 'Advanced';
        dom.overridesSubSectionLabel.textContent = strings.assistantOverridesSubSection || 'Provider Overrides';
        dom.overridesApiKeyLabel.textContent = strings.assistantOverridesApiKey || 'API Key Override';
        dom.overridesBaseUrlLabel.textContent = strings.assistantOverridesBaseUrl || 'Base URL Override';
        dom.overridesModelLabel.textContent = strings.assistantOverridesModel || 'Model Override';
        dom.overridesTemperatureLabel.textContent = strings.assistantOverridesTemperature || 'Temperature Override';
        dom.advancedParamsSubSectionLabel.textContent = strings.assistantAdvancedParamsSubSection || 'Advanced Parameters';
        dom.stopSequencesLabel.textContent = strings.assistantStopSequencesLabel || 'Stop Sequences';
        dom.seedLabel.textContent = strings.assistantSeedLabel || 'Seed';
        dom.responseFormatLabel.textContent = strings.assistantResponseFormatLabel || 'Response Format';
        dom.toolChoiceLabel.textContent = strings.assistantToolChoiceLabel || 'Tool Choice';
        dom.geminiSafetyLevelLabel.textContent = strings.assistantGeminiSafetyLevelLabel || 'Gemini Safety';
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
        // Render failover model checkboxes (exclude currently selected primary model)
        const primaryRef = dom.modelRef.value || state.assistant?.modelRef;
        dom.failoverModelCheckList.innerHTML = (state.models || []).filter((model) => model.ref !== primaryRef).map((model) => {
          return '<label class="failover-check-item">' +
            '<input type="checkbox" value="' + escapeHtml(model.ref) + '" />' +
            '<span>' + escapeHtml(model.label + (model.metaLabel || '')) + '</span>' +
          '</label>';
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
        const failoverIds = new Set(assistant.failoverModelRefs || []);
        Array.from(dom.failoverModelCheckList.querySelectorAll('input[type="checkbox"]')).forEach((cb) => {
          cb.checked = failoverIds.has(cb.value);
        });
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
        const overrides = assistant.overrides || {};
        dom.overridesApiKey.value = overrides.apiKey || '';
        dom.overridesBaseUrl.value = overrides.baseUrl || '';
        dom.overridesModel.value = overrides.model || '';
        dom.overridesTemperature.value = overrides.temperature !== undefined ? String(overrides.temperature) : '';
        dom.stopSequences.value = (assistant.stopSequences || []).join(', ');
        dom.seed.value = assistant.seed !== undefined ? String(assistant.seed) : '';
        dom.responseFormat.value = assistant.responseFormat?.type === 'json_object' ? 'json_object' : (assistant.responseFormat?.type === 'text' ? 'text' : '');
        dom.toolChoice.value = typeof assistant.toolChoice === 'string' ? assistant.toolChoice : '';
        dom.geminiSafetyLevel.value = typeof assistant.geminiSafetyLevel === 'string' ? assistant.geminiSafetyLevel : '';
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
          frequencyPenalty: Number.parseFloat(dom.frequencyPenalty.value),
          overrides: (function() {
            const apiKey = (dom.overridesApiKey.value || '').trim();
            const baseUrl = (dom.overridesBaseUrl.value || '').trim();
            const model = (dom.overridesModel.value || '').trim();
            const temperatureRaw = dom.overridesTemperature.value.trim();
            const temperature = temperatureRaw !== '' ? Number.parseFloat(temperatureRaw) : undefined;
            if (!apiKey && !baseUrl && !model && temperature === undefined) {
              return undefined;
            }
            const result = {};
            if (apiKey) { result.apiKey = apiKey; }
            if (baseUrl) { result.baseUrl = baseUrl; }
            if (model) { result.model = model; }
            if (temperature !== undefined && !Number.isNaN(temperature)) { result.temperature = temperature; }
            return result;
          })(),
          stopSequences: (function() {
            const raw = (dom.stopSequences.value || '').trim();
            if (!raw) { return undefined; }
            const items = raw.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
            return items.length > 0 ? items : undefined;
          })(),
          seed: (function() {
            const raw = dom.seed.value.trim();
            if (!raw) { return undefined; }
            const val = Number.parseInt(raw, 10);
            return Number.isNaN(val) ? undefined : val;
          })(),
          responseFormat: dom.responseFormat.value || undefined,
          toolChoice: dom.toolChoice.value || undefined,
          geminiSafetyLevel: dom.geminiSafetyLevel.value || undefined,
          failoverModelRefs: Array.from(dom.failoverModelCheckList.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value).filter(Boolean)
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

      dom.advancedToggle.addEventListener('click', () => {
        const isOpen = dom.advancedBody.classList.toggle('open');
        dom.advancedToggle.classList.toggle('collapsed', !isOpen);
      });

      vscode.postMessage({ type: 'ready' });
`;
}
