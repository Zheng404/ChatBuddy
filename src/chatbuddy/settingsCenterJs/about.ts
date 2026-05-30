/**
 * About section rendering functions.
 */
export function getAboutJs(): string {
  return `
      function renderAbout() {
        const strings = runtimeState.strings || {};
        const about = runtimeState.about || {};

        const headline = escapeHtml(about.appName || strings.appName || 'ChatBuddy');
        const version = escapeHtml(about.version || '');
        const author = escapeHtml(about.author || about.publisher || '');
        const authorUrl = about.authorUrl || '';
        const license = escapeHtml(about.license || '');
        const repositoryUrl = (about.repositoryUrl || '').replace(/\\.git$/i, '');
        const marketplaceUrl = about.marketplaceUrl || '';
        const openVsxUrl = about.openVsxUrl || '';

        const actionLinksHtml = [
          marketplaceUrl
            ? (
                '<a class="btn-primary about-link-btn" href="' + escapeHtmlAttr(marketplaceUrl) + '" target="_blank" rel="noreferrer">' +
                  escapeHtml(strings.aboutMarketplaceAction || '') +
                '</a>'
              )
            : '',
          openVsxUrl
            ? (
                '<a class="btn-primary about-link-btn" href="' + escapeHtmlAttr(openVsxUrl) + '" target="_blank" rel="noreferrer">' +
                  escapeHtml(strings.aboutOpenVsxAction || '') +
                '</a>'
              )
            : '',
          repositoryUrl
            ? (
                '<a class="btn-primary about-link-btn" href="' + escapeHtmlAttr(repositoryUrl) + '" target="_blank" rel="noreferrer">' +
                  escapeHtml(strings.aboutRepositoryAction || '') +
                '</a>'
              )
            : ''
        ].filter((item) => !!item).join('');

        // Safe: all user content escaped via escapeHtml() and escapeHtmlAttr()
        dom.aboutOverviewGrid.innerHTML =
          '<div class="about-hero-panel">' +
            '<div class="about-hero-copy">' +
              '<div class="about-headline-row">' +
                '<h3 class="about-headline">' + headline + '</h3>' +
                (version ? '<span class="about-version-pill">v' + version + '</span>' : '') +
                (license ? '<span class="about-license-pill">' + license + '</span>' : '') +
              '</div>' +
              '<p class="about-hero-text">' + escapeHtml(strings.aboutHeroText || '') + '</p>' +
              (
                author
                  ? (
                      '<p class="about-hero-author">' +
                        '<span class="about-hero-author-label">' + escapeHtml(strings.aboutAuthorLabel || '') + '</span>' +
                        (
                          authorUrl
                            ? (
                                '<a class="about-hero-author-link" href="' + escapeHtmlAttr(authorUrl) + '" target="_blank" rel="noreferrer">' +
                                  '<span class="about-hero-author-name">' + author + '</span>' +
                                '</a>'
                              )
                            : '<span class="about-hero-author-name">' + author + '</span>'
                        ) +
                      '</p>'
                    )
                  : ''
              ) +
            '</div>' +
            (
              actionLinksHtml
                ? (
                    '<div class="about-hero-aside">' +
                      '<div class="about-link-grid">' + actionLinksHtml + '</div>' +
                    '</div>'
                  )
                : ''
            ) +
          '</div>';
      }
`;
}
