/**
 * Notice / changelog section rendering functions.
 */
export function getNoticeJs(): string {
  return `
      function renderNotice() {
        const strings = runtimeState.strings || {};
        const bulletin = runtimeState.bulletin || {};

        dom.noticeAnnouncementTitle.textContent = strings.noticeAnnouncementTitle || '';
        dom.noticeAnnouncementDescription.textContent = strings.noticeAnnouncementDescription || '';

        const lines = [
          strings.noticeAnnouncementStorageLine1 || '',
          (strings.noticeAnnouncementStorageLine2 || '')
            .replace('{deprecationStartVersion}', bulletin.deprecationStartVersion || '')
            .replace('{removalVersion}', bulletin.removalVersion || ''),
          (strings.noticeAnnouncementStorageLine3 || '').replace('{removalVersion}', bulletin.removalVersion || '')
        ].filter((line) => !!line);
        dom.noticeAnnouncementList.textContent = '';
        lines.forEach((line) => {
          var li = document.createElement('li');
          li.textContent = line;
          dom.noticeAnnouncementList.appendChild(li);
        });

        dom.noticeChangelogTitle.textContent = strings.noticeChangelogTitle || '';

        const markdown = runtimeState.changelogMarkdown || '';
        if (!markdown.trim()) {
          dom.noticeChangelogContent.textContent = '';
          var emptyP = document.createElement('p');
          emptyP.textContent = strings.noticeChangelogEmpty || '';
          dom.noticeChangelogContent.appendChild(emptyP);
          return;
        }
        // Safe: renderMarkdownToHtml is the extension's own markdown parser; content comes from the extension changelog
        dom.noticeChangelogContent.innerHTML = renderMarkdownToHtml(markdown);
      }

      function renderMarkdownToHtml(markdown) {
        const lines = String(markdown || '').replace(/\\r\\n/g, '\\n').split('\\n');
        const html = [];
        const codeTick = String.fromCharCode(96);
        let inCodeBlock = false;
        let codeLang = '';
        let listType = '';

        function closeList() {
          if (listType === 'ul') {
            html.push('</ul>');
          } else if (listType === 'ol') {
            html.push('</ol>');
          }
          listType = '';
        }

        function ensureList(nextType) {
          if (listType === nextType) {
            return;
          }
          closeList();
          html.push(nextType === 'ol' ? '<ol>' : '<ul>');
          listType = nextType;
        }

        for (const rawLine of lines) {
          const line = rawLine || '';

          if (line.trim().startsWith(codeTick + codeTick + codeTick)) {
            if (!inCodeBlock) {
              closeList();
              inCodeBlock = true;
              codeLang = line.trim().slice(3).trim();
              html.push('<pre><code' + (codeLang ? ' class="language-' + escapeHtml(codeLang) + '"' : '') + '>');
            } else {
              inCodeBlock = false;
              codeLang = '';
              html.push('</code></pre>');
            }
            continue;
          }

          if (inCodeBlock) {
            html.push(escapeHtml(line) + '\\n');
            continue;
          }

          if (!line.trim()) {
            closeList();
            continue;
          }

          const heading = line.match(/^(#{1,6}) +(.*)$/);
          if (heading) {
            closeList();
            const level = String(heading[1].length);
            html.push('<h' + level + '>' + renderInlineMarkdown(heading[2]) + '</h' + level + '>');
            continue;
          }

          const ulItem = line.match(/^ *[-*] +(.*)$/);
          if (ulItem) {
            ensureList('ul');
            html.push('<li>' + renderInlineMarkdown(ulItem[1]) + '</li>');
            continue;
          }

          const olItem = line.match(/^ *[0-9]+[.] +(.*)$/);
          if (olItem) {
            ensureList('ol');
            html.push('<li>' + renderInlineMarkdown(olItem[1]) + '</li>');
            continue;
          }

          closeList();
          html.push('<p>' + renderInlineMarkdown(line) + '</p>');
        }

        closeList();
        if (inCodeBlock) {
          html.push('</code></pre>');
        }
        return html.join('');
      }

      function renderInlineMarkdown(text) {
        const codeTick = String.fromCharCode(96);
        let output = escapeHtml(text || '');
        output = output.replace(/[*][*](.+?)[*][*]/g, '<strong>$1</strong>');
        output = output.replace(/[*](.+?)[*]/g, '<em>$1</em>');
        output = output.replace(new RegExp(codeTick + '([^' + codeTick + ']+)' + codeTick, 'g'), '<code>$1</code>');
        return output;
      }
`;
}
