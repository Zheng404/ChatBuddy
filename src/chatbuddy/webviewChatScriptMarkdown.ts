/**
 * 聊天 WebView Markdown 渲染脚本模块。
 *
 * 提供消息内容的 Markdown 解析与渲染逻辑，支持代码块高亮、
 * KaTeX 数学公式、Mermaid 图表和 Markdown 基础语法。
 */
export function getChatMarkdownRendererScript(args: {
  latexDisplayPattern: string;
  latexInlinePattern: string;
  latexEnvPattern: string;
}): string {
  const { latexDisplayPattern, latexInlinePattern, latexEnvPattern } = args;
  return `
      function decodeHtmlEntities(input) {
        return String(input || '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#0*39;/g, "'");
      }

      function formatTemplate(template, values) {
        return String(template || '').replace(/\\{(\\w+)\\}/g, (_, key) => values[key] || '');
      }

      function normalizeCodicon(icon) {
        const raw = String(icon || '').trim().toLowerCase();
        if (!raw || !/^[a-z0-9-]+$/.test(raw)) {
          return 'account';
        }
        return raw;
      }

      function codiconMarkup(icon) {
        const normalized = normalizeCodicon(icon);
        return '<span class="codicon codicon-' + escapeHtml(normalized) + '"></span>';
      }

      function formatDate(ts) {
        try {
          const locale = state.locale === 'zh-CN' ? 'zh-CN' : 'en-US';
          return new Intl.DateTimeFormat(locale, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }).format(new Date(ts));
        } catch {
          return '';
        }
      }

      function markdownToHtml(input) {
        const source = String(input || '');

        const latexBlocks = [];
        var protectedSource = source;
        var latexCodeBlockRe = new RegExp('[\\\\x60]{3}(latex|tex|math)\\\\n([\\\\s\\\\S]*?)[\\\\x60]{3}', 'g');
        protectedSource = protectedSource.replace(latexCodeBlockRe, function(_, lang, code) {
          var tex = code.trim();
          if (/^\\$\\$([\\s\\S]+)\\$\\$$/.test(tex)) {
            tex = tex.replace(/^\\$\\$/, '').replace(/\\$\\$$/, '').trim();
          } else if (/^\\$(?!\\$)([\\s\\S]+)\\$$/.test(tex)) {
            tex = tex.replace(/^\\$/, '').replace(/\\$$/, '').trim();
          }
          var marker = '@@LATEX_' + latexBlocks.length + '@@';
          latexBlocks.push({ display: true, tex: tex });
          return marker;
        });
        protectedSource = protectedSource.replace(${latexDisplayPattern}, function(_, tex) {
          var marker = '@@LATEX_' + latexBlocks.length + '@@';
          latexBlocks.push({ display: true, tex: tex });
          return marker;
        });
        protectedSource = protectedSource.replace(${latexInlinePattern}, function(_, tex) {
          var marker = '@@LATEX_' + latexBlocks.length + '@@';
          latexBlocks.push({ display: false, tex: tex });
          return marker;
        });
        protectedSource = protectedSource.replace(/\\$\\$([\\s\\S]+?)\\$\\$/g, function(_, tex) {
          var marker = '@@LATEX_' + latexBlocks.length + '@@';
          latexBlocks.push({ display: true, tex: tex });
          return marker;
        });
        protectedSource = protectedSource.replace(/(?<![a-zA-Z0-9_$])\\$(?!\\$)([^$\\n]+?)\\$(?![a-zA-Z0-9_$])/g, function(_, tex) {
          var marker = '@@LATEX_' + latexBlocks.length + '@@';
          latexBlocks.push({ display: false, tex: tex });
          return marker;
        });
        protectedSource = protectedSource.replace(${latexEnvPattern}, function(match) {
          var marker = '@@LATEX_' + latexBlocks.length + '@@';
          latexBlocks.push({ display: true, tex: match });
          return marker;
        });

        const codeBlocks = [];
        const codeBlockPattern = new RegExp('[\\\\x60]{3}([a-zA-Z0-9_-]*)\\\\n([\\\\s\\\\S]*?)[\\\\x60]{3}', 'g');
        let escaped = escapeHtml(protectedSource).replace(codeBlockPattern, (_, lang, code) => {
          var marker = '@@CODE_BLOCK_' + codeBlocks.length + '@@';
          if (lang === 'mermaid') {
            codeBlocks.push('<div class="mermaid-placeholder" data-mermaid>' + code + '</div>');
          } else {
            const cls = lang ? ' class="lang-' + lang + '"' : '';
            const langLabel = lang ? '<span class="code-block-lang">' + escapeHtml(lang) + '</span>' : '';
            codeBlocks.push('<div class="code-block-wrapper">' + langLabel + '<button class="code-block-copy" type="button" title="Copy"><span class="codicon codicon-copy"></span></button><pre><code' + cls + '>' + code + '</code></pre></div>');
          }
          return marker;
        });

        const toSafeHref = (raw, allowDataImage, allowDataVideo) => {
          const value = decodeHtmlEntities(raw).trim();
          if (!value) {
            return '';
          }
          if (allowDataImage && /^data:image\\/[a-z0-9.+-]+;base64,[a-z0-9+/=\\s]+$/i.test(value)) {
            return value.replace(/\\s+/g, '');
          }
          if (allowDataVideo && /^data:video\\/[a-z0-9.+-]+;base64,[a-z0-9+/=\\s]+$/i.test(value)) {
            return value.replace(/\\s+/g, '');
          }
          let parsed;
          try {
            parsed = new URL(value);
          } catch {
            return '';
          }
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return '';
          }
          return parsed.toString();
        };

        const applyInlineMarkdown = (text) => {
          let html = String(text || '');

          html = html.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, (full, alt, rawUrl) => {
            const mediaType = String(alt || '').trim().toLowerCase();
            const altText = decodeHtmlEntities(alt).trim();
            if (mediaType === 'video') {
              const safeUrl = toSafeHref(rawUrl, false, true);
              if (!safeUrl) {
                return full;
              }
              return '<video controls preload="metadata" src="' + escapeHtmlAttr(safeUrl) + '"></video>';
            }
            const safeUrl = toSafeHref(rawUrl, true, false);
            if (!safeUrl) {
              return full;
            }
            return (
              '<img src="' +
              escapeHtmlAttr(safeUrl) +
              '" alt="' +
              escapeHtmlAttr(altText) +
              '" loading="lazy" />'
            );
          });

          html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, (full, label, rawUrl) => {
            const safeUrl = toSafeHref(rawUrl, false, false);
            if (!safeUrl) {
              return full;
            }
            return (
              '<a href="' +
              escapeHtmlAttr(safeUrl) +
              '" target="_blank" rel="noopener noreferrer">' +
              escapeHtml(label) +
              '</a>'
            );
          });

          html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
          html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
          html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
          return html;
        };

        const splitMarkdownTableRow = (line) => {
          let raw = String(line || '').trim();
          if (!raw.includes('|')) {
            return [];
          }
          if (raw.startsWith('|')) {
            raw = raw.slice(1);
          }
          if (raw.endsWith('|')) {
            raw = raw.slice(0, -1);
          }

          const cells = [];
          let current = '';
          for (let index = 0; index < raw.length; index += 1) {
            const ch = raw[index];
            if (ch === '\\\\' && raw[index + 1] === '|') {
              current += '|';
              index += 1;
              continue;
            }
            if (ch === '|') {
              cells.push(current.trim());
              current = '';
              continue;
            }
            current += ch;
          }
          cells.push(current.trim());
          return cells;
        };

        const isMarkdownTableSeparator = (line) => {
          const cells = splitMarkdownTableRow(line);
          if (cells.length < 2) {
            return false;
          }
          return cells.every((cell) => /^:?-{3,}:?$/.test(String(cell || '').replace(/\\s+/g, '')));
        };

        const isMarkdownTableRow = (line) => splitMarkdownTableRow(line).length >= 2;

        const normalizeTableCellCount = (cells, expectedCount) => {
          const normalized = cells.slice(0, expectedCount);
          while (normalized.length < expectedCount) {
            normalized.push('');
          }
          return normalized;
        };

        const resolveTableAlignment = (separatorCell) => {
          const marker = String(separatorCell || '').replace(/\\s+/g, '');
          if (marker.startsWith(':') && marker.endsWith(':')) {
            return 'is-center';
          }
          if (marker.endsWith(':')) {
            return 'is-right';
          }
          if (marker.startsWith(':')) {
            return 'is-left';
          }
          return '';
        };

        const renderMarkdownTableBlock = (headers, separators, rows) => {
          const alignments = separators.map(resolveTableAlignment);
          const renderCells = (tag, cells) => normalizeTableCellCount(cells, headers.length)
            .map((cell, index) => {
              const alignment = alignments[index] ? ' class="' + alignments[index] + '"' : '';
              const rendered = applyInlineMarkdown(cell);
              return '<' + tag + alignment + '>' + (rendered || '&nbsp;') + '</' + tag + '>';
            })
            .join('');
          const headHtml = '<thead><tr>' + renderCells('th', headers) + '</tr></thead>';
          const bodyHtml = rows.length > 0
            ? '<tbody>' + rows.map((row) => '<tr>' + renderCells('td', row) + '</tr>').join('') + '</tbody>'
            : '';
          return '<div class="markdown-table-wrap"><table class="markdown-table">' + headHtml + bodyHtml + '</table></div>';
        };

        const tableBlocks = [];
        const renderMarkdownTables = (text) => {
          const lines = String(text || '').split('\\n');
          const chunks = [];
          for (let index = 0; index < lines.length; index += 1) {
            const headerLine = lines[index];
            const separatorLine = lines[index + 1];
            if (!isMarkdownTableRow(headerLine) || !isMarkdownTableSeparator(separatorLine)) {
              chunks.push(headerLine);
              continue;
            }

            const headers = splitMarkdownTableRow(headerLine);
            const separators = splitMarkdownTableRow(separatorLine);
            if (headers.length < 2 || headers.length !== separators.length) {
              chunks.push(headerLine);
              continue;
            }

            const rows = [];
            index += 2;
            while (index < lines.length) {
              const rowLine = lines[index];
              if (!isMarkdownTableRow(rowLine) || isMarkdownTableSeparator(rowLine)) {
                break;
              }
              rows.push(splitMarkdownTableRow(rowLine));
              index += 1;
            }
            index -= 1;

            const marker = '@@TABLE_' + tableBlocks.length + '@@';
            tableBlocks.push(renderMarkdownTableBlock(headers, separators, rows));
            chunks.push(marker);
          }
          return chunks.join('\\n');
        };

        const TASK_LIST_ITEM_PATTERN = /^\\s*[-*+]\\s+\\[([xX ])\\]\\s*(.*)$/;
        const renderMarkdownTaskListBlock = (items) => {
          const body = items
            .map((item) => {
              const checkedClass = item.checked ? ' is-checked' : '';
              const text = applyInlineMarkdown(item.text || '');
              return (
                '<li class="task-list-item' +
                checkedClass +
                '">' +
                '<span class="task-checkbox' +
                checkedClass +
                '" aria-hidden="true"></span>' +
                '<span class="task-list-text">' +
                (text || '&nbsp;') +
                '</span>' +
                '</li>'
              );
            })
            .join('');
          return '<ul class="task-list">' + body + '</ul>';
        };

        const taskListBlocks = [];
        const renderMarkdownTaskLists = (text) => {
          const lines = String(text || '').split('\\n');
          const chunks = [];
          for (let index = 0; index < lines.length; index += 1) {
            const match = lines[index].match(TASK_LIST_ITEM_PATTERN);
            if (!match) {
              chunks.push(lines[index]);
              continue;
            }

            const items = [];
            while (index < lines.length) {
              const itemMatch = lines[index].match(TASK_LIST_ITEM_PATTERN);
              if (!itemMatch) {
                break;
              }
              items.push({
                checked: String(itemMatch[1] || '').toLowerCase() === 'x',
                text: String(itemMatch[2] || '').trim()
              });
              index += 1;
            }
            index -= 1;

            const marker = '@@TASK_LIST_' + taskListBlocks.length + '@@';
            taskListBlocks.push(renderMarkdownTaskListBlock(items));
            chunks.push(marker);
          }
          return chunks.join('\\n');
        };

        escaped = renderMarkdownTables(escaped);
        escaped = renderMarkdownTaskLists(escaped);

        escaped = escaped.replace(/^(#{1,6})\\s+(.+)$/gm, (m, hashes, txt) => {
          const lv = hashes.length;
          return '<h' + lv + '>' + txt + '</h' + lv + '>';
        });
        escaped = applyInlineMarkdown(escaped);

        escaped = escaped.replace(/\\n\\n/g, '@@PARA@@');
        escaped = escaped.replace(/\\n/g, '<br/>');
        escaped = escaped.replace(/@@PARA@@/g, '<br/>');

        escaped = escaped.replace(/@@CODE_BLOCK_(\\d+)@@/g, (_, index) => {
          const value = codeBlocks[Number(index)];
          return typeof value === 'string' ? value : '';
        });

        escaped = escaped.replace(/@@TABLE_(\\d+)@@/g, (_, index) => {
          const value = tableBlocks[Number(index)];
          return typeof value === 'string' ? value : '';
        });

        escaped = escaped.replace(/@@TASK_LIST_(\\d+)@@/g, (_, index) => {
          const value = taskListBlocks[Number(index)];
          return typeof value === 'string' ? value : '';
        });

        escaped = escaped.replace(/@@LATEX_(\\d+)@@/g, function(_, index) {
          var item = latexBlocks[Number(index)];
          if (!item) { return ''; }
          if (item.display) {
            return '<div class="math-block" data-latex-display data-raw-tex="' + escapeHtmlAttr(item.tex) + '">' + escapeHtml(item.tex) + '</div>';
          }
          return '<span class="katex-inline" data-latex-inline data-raw-tex="' + escapeHtmlAttr(item.tex) + '">' + escapeHtml(item.tex) + '</span>';
        });

        escaped = escaped.replace(/<br\\/>\\s*<(h[1-6]|pre|div|ul|ol|li|blockquote|table|hr)/g, '<$1');
        escaped = escaped.replace(/<\\/(h[1-6]|pre|div|ul|ol|li|blockquote|table|hr)>\\s*<br\\/>/g, '</$1>');

        return escaped;
      }

      var renderEnhancedScheduled = false;
      function renderEnhancedContent() {
        if (renderEnhancedScheduled) { return; }
        renderEnhancedScheduled = true;
        requestAnimationFrame(function() {
          renderEnhancedScheduled = false;
          renderEnhancedContentImpl();
        });
      }

      var mermaidRenderQueue = [];
      var mermaidRendering = false;
      var mermaidInitialized = false;
      var mermaidLoadPromise;

      function isMermaidDarkTheme() {
        var background = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background').trim();
        if (!background) {
          return true;
        }
        var rgb = background.match(/^rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/i);
        if (rgb) {
          return ((Number(rgb[1]) + Number(rgb[2]) + Number(rgb[3])) / 3) < 136;
        }
        var hex = background.replace('#', '').trim();
        if (hex.length === 3) {
          hex = hex.split('').map(function(part) { return part + part; }).join('');
        }
        if (hex.length !== 6) {
          return true;
        }
        var red = parseInt(hex.slice(0, 2), 16);
        var green = parseInt(hex.slice(2, 4), 16);
        var blue = parseInt(hex.slice(4, 6), 16);
        return ((red + green + blue) / 3) < 136;
      }

      function getMermaidInstance() {
        if (typeof mermaid !== 'undefined' && typeof mermaid.initialize === 'function') {
          return mermaid;
        }
        if (typeof window !== 'undefined' && window.__mermaid) {
          return window.__mermaid;
        }
        return undefined;
      }

      function ensureMermaidInitialized() {
        if (mermaidInitialized) {
          return true;
        }
        var m = getMermaidInstance();
        if (!m) {
          return false;
        }
        try {
          m.initialize({
            startOnLoad: false,
            theme: isMermaidDarkTheme() ? 'dark' : 'default',
            securityLevel: 'strict'
          });
          mermaidInitialized = true;
          return true;
        } catch (err) {
          console.error('[Mermaid] initialize failed:', err);
          return false;
        }
      }

      function ensureMermaidReady() {
        if (mermaidLoadPromise) {
          return mermaidLoadPromise;
        }
        // ESM module loaded via <script type="module">; poll until ready
        mermaidLoadPromise = new Promise(function(resolve) {
          var attempts = 0;
          var maxAttempts = 100; // 10 seconds
          var interval = setInterval(function() {
            attempts++;
            var m = getMermaidInstance();
            if (m) {
              clearInterval(interval);
              var ready = ensureMermaidInitialized();
              if (!ready) {
                console.error('[Mermaid] instance found but initialization failed');
              }
              resolve(ready);
            } else if (attempts >= maxAttempts) {
              clearInterval(interval);
              console.error('[Mermaid] timeout waiting for ESM module after 10s');
              resolve(false);
            }
          }, 100);
        });
        return mermaidLoadPromise;
      }

      /**
       * Sanitize SVG output from Mermaid to prevent XSS.
       * Strips <script>, <iframe>, <object>, <embed> tags and on* event handlers.
       */
      function sanitizeSvg(svg) {
        var temp = document.createElement('div');
        temp.innerHTML = svg;
        var dangerous = temp.querySelectorAll('script, iframe, object, embed, foreignObject');
        for (var i = 0; i < dangerous.length; i++) { dangerous[i].remove(); }
        var all = temp.querySelectorAll('*');
        for (var j = 0; j < all.length; j++) {
          var attrs = all[j].attributes;
          for (var k = attrs.length - 1; k >= 0; k--) {
            var name = attrs[k].name.toLowerCase();
            var value = String(attrs[k].value || '').trim().toLowerCase();
            if (name.indexOf('on') === 0 ||
                ((name === 'href' || name === 'xlink:href') && value.indexOf('javascript:') === 0)) {
              all[j].removeAttribute(attrs[k].name);
            }
          }
        }
        return temp.innerHTML;
      }

      function replaceMermaidWithCode(el, errorMessage) {
        if (!el) {
          return;
        }
        var code = el.textContent || '';
        var wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';
        var errorLabel = '';
        if (errorMessage) {
          errorLabel = '<span class="code-block-lang mermaid-error">Mermaid ⚠ ' + escapeHtml(String(errorMessage)) + '</span>';
        } else {
          errorLabel = '<span class="code-block-lang mermaid-error">Mermaid</span>';
        }
        wrapper.innerHTML = errorLabel +
          '<button class="code-block-copy" type="button" title="Copy"><span class="codicon codicon-copy"></span></button>' +
          '<pre><code class="lang-mermaid">' + escapeHtml(code) + '</code></pre>';
        el.replaceWith(wrapper);
      }

      function processMermaidQueue() {
        if (mermaidRendering || !mermaidRenderQueue.length) { return; }
        mermaidRendering = true;
        var el = mermaidRenderQueue.shift();
        ensureMermaidReady().then(function(ready) {
          if (!ready) {
            console.error('[Mermaid] not ready, skipping render');
            replaceMermaidWithCode(el, 'Load failed');
            mermaidRendering = false;
            processMermaidQueue();
            return;
          }
          var m = getMermaidInstance();
          if (!m || typeof m.render !== 'function') {
            console.error('[Mermaid] render function not available');
            replaceMermaidWithCode(el, 'Unavailable');
            mermaidRendering = false;
            processMermaidQueue();
            return;
          }
          var id = 'mermaid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
          var text = (el.textContent || '').trim();
          if (!text) {
            console.error('[Mermaid] empty diagram text');
            replaceMermaidWithCode(el, 'Empty');
            mermaidRendering = false;
            processMermaidQueue();
            return;
          }
          try {
            m.render(id, text, el).then(function(result) {
              if (!result || !result.svg) {
                console.error('[Mermaid] render returned empty result for diagram:', text.slice(0, 100));
                replaceMermaidWithCode(el, 'Empty result');
                mermaidRendering = false;
                processMermaidQueue();
                return;
              }
              el.innerHTML = sanitizeSvg(result.svg);
              // Bind interactive functions (click events, tooltips, etc.)
              if (result.bindFunctions && typeof result.bindFunctions === 'function') {
                try {
                  result.bindFunctions(el);
                } catch (bindErr) {
                  console.error('[Mermaid] bindFunctions failed:', bindErr);
                }
              }
              el.setAttribute('data-rendered', 'true');
              el.removeAttribute('data-mermaid');
              mermaidRendering = false;
              processMermaidQueue();
            }).catch(function(err) {
              console.error('[Mermaid] render rejected:', err);
              replaceMermaidWithCode(el, 'Render error');
              mermaidRendering = false;
              processMermaidQueue();
            });
          } catch (e) {
            console.error('[Mermaid] render threw:', e);
            replaceMermaidWithCode(el, 'Exception');
            mermaidRendering = false;
            processMermaidQueue();
          }
        });
      }

      function renderEnhancedContentImpl() {
        dom.messagesInner.querySelectorAll('pre code.lang-latex, pre code.lang-tex, pre code.lang-math').forEach(function(codeEl) {
          var preEl = codeEl.parentNode;
          if (preEl && preEl.tagName === 'PRE') {
            preEl.outerHTML = codeEl.innerHTML;
          }
        });
        dom.messagesInner.querySelectorAll('[data-latex-inline]').forEach(function(el) {
          if (el.getAttribute('data-rendered')) { return; }
          if (typeof katex === 'undefined') { return; }
          var raw = el.getAttribute('data-raw-tex') || el.textContent;
          try {
            katex.render(el.textContent, el, { throwOnError: true, displayMode: false });
            el.setAttribute('data-rendered', 'true');
            el.removeAttribute('data-latex-inline');
            el.removeAttribute('data-raw-tex');
          } catch (e) {
            el.textContent = '$' + raw + '$';
            el.removeAttribute('data-latex-inline');
          }
        });
        dom.messagesInner.querySelectorAll('[data-latex-display]').forEach(function(el) {
          if (el.getAttribute('data-rendered')) { return; }
          if (typeof katex === 'undefined') { return; }
          var raw = el.getAttribute('data-raw-tex') || el.textContent;
          try {
            katex.render(el.textContent, el, { throwOnError: true, displayMode: true });
            el.setAttribute('data-rendered', 'true');
            el.removeAttribute('data-latex-display');
            el.removeAttribute('data-raw-tex');
          } catch (e) {
            el.textContent = raw;
            el.setAttribute('data-latex-failed', 'true');
            el.removeAttribute('data-latex-display');
          }
        });
        dom.messagesInner.querySelectorAll('[data-mermaid]').forEach(function(el) {
          if (el.getAttribute('data-rendered')) { return; }
          el.setAttribute('data-rendered', 'true');
          mermaidRenderQueue.push(el);
        });
        processMermaidQueue();
      }

      // Code block copy button (event delegation, bound once)
      var codeBlockCopyListenerAttached = false;
      function attachCodeBlockCopyListener() {
        if (codeBlockCopyListenerAttached) { return; }
        codeBlockCopyListenerAttached = true;
        dom.messagesInner.addEventListener('click', function(e) {
          var btn = e.target.closest('.code-block-copy');
          if (!btn) { return; }
          var wrapper = btn.closest('.code-block-wrapper');
          if (!wrapper) { return; }
          var codeEl = wrapper.querySelector('pre code');
          if (!codeEl) { return; }
          var text = codeEl.textContent || '';
          navigator.clipboard.writeText(text).then(function() {
            btn.innerHTML = '<span class="codicon codicon-check"></span>';
            btn.classList.add('copied');
            setTimeout(function() {
              btn.innerHTML = '<span class="codicon codicon-copy"></span>';
              btn.classList.remove('copied');
            }, 1500);
          });
        });
      }
      attachCodeBlockCopyListener();
`;
}
