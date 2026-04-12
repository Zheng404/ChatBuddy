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
            codeBlocks.push('<pre><code' + cls + '>' + code + '</code></pre>');
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
              label +
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

      function processMermaidQueue() {
        if (mermaidRendering || !mermaidRenderQueue.length) { return; }
        mermaidRendering = true;
        var el = mermaidRenderQueue.shift();
        if (typeof mermaid === 'undefined') {
          mermaidRendering = false;
          processMermaidQueue();
          return;
        }
        var id = 'mermaid-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
        try {
          mermaid.render(id, el.textContent).then(function(result) {
            el.innerHTML = result.svg;
            el.setAttribute('data-rendered', 'true');
            el.removeAttribute('data-mermaid');
            mermaidRendering = false;
            processMermaidQueue();
          }).catch(function() {
            var pre = document.createElement('pre');
            pre.textContent = el.textContent;
            el.replaceWith(pre);
            mermaidRendering = false;
            processMermaidQueue();
          });
        } catch (e) {
          var pre = document.createElement('pre');
          pre.textContent = el.textContent;
          el.replaceWith(pre);
          mermaidRendering = false;
          processMermaidQueue();
        }
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
`;
}
