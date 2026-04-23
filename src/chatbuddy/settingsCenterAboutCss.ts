/**
 * 设置中心 About 页面样式。
 *
 * 从 settingsCenterStyles.ts 中提取的 About 页面专属样式。
 */
export function getSettingsCenterAboutCss(): string {
  return `
      .about-grid {
        display: grid;
        gap: 14px;
        margin-top: 0;
      }

      .about-layout {
        display: block;
      }

      .about-hero-panel {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(320px, 396px);
        gap: 20px;
        padding: 18px;
        border: 1px solid var(--border);
        border-radius: var(--radius-xl);
        background: color-mix(in srgb, var(--bg) 97%, white 3%);
      }

      .about-hero-copy {
        min-width: 0;
        display: grid;
        align-content: center;
        gap: 10px;
      }

      .about-headline-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }

      .about-headline {
        margin: 0;
        font-size: 28px;
        line-height: 1.08;
        font-weight: 750;
        color: var(--fg);
      }

      .about-version-pill {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 0 13px;
        border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--border) 66%);
        border-radius: var(--radius-pill);
        background: color-mix(in srgb, var(--accent) 13%, var(--bg) 87%);
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 18%, transparent 82%);
        color: color-mix(in srgb, var(--accent) 78%, var(--fg) 22%);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.03em;
      }

      .about-license-pill {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 0 13px;
        border: 1px solid color-mix(in srgb, var(--accent) 16%, var(--border) 84%);
        border-radius: var(--radius-pill);
        background: color-mix(in srgb, var(--panel-bg-strong) 88%, var(--accent) 12%);
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 16%, transparent 84%);
        color: var(--fg);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.03em;
      }

      .about-hero-text {
        margin: 0;
        max-width: 48ch;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }

      .about-hero-author {
        margin: 2px 0 0;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 12px;
        line-height: 1.5;
      }

      .about-hero-author-label {
        color: var(--muted);
      }

      .about-hero-author-name {
        color: var(--fg);
        font-weight: 600;
      }

      .about-hero-author-link {
        color: inherit;
        text-decoration: none;
        border-bottom: 1px solid transparent;
        transition:
          color 120ms ease,
          border-color 120ms ease;
      }

      .about-hero-author-link:hover {
        color: var(--accent);
        border-bottom-color: color-mix(in srgb, var(--accent) 45%, transparent 55%);
      }

      .about-hero-aside {
        display: grid;
        align-content: center;
      }

      .about-link-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .about-link-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        text-decoration: none;
        min-height: 40px;
        padding: 9px 10px;
        text-align: center;
        white-space: normal;
        line-height: 1.25;
        font-size: 11px;
        font-weight: 700;
        text-wrap: balance;
      }

      .about-link-btn.btn-primary {
        box-shadow: inset 0 1px 0 color-mix(in srgb, white 18%, transparent 82%);
      }

      .about-link-btn.btn-primary:hover {
        text-decoration: none;
      }

      .about-meta-chip,
      .about-notice-header .section-title,
      .about-changelog-block .panel-title {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 0 10px;
        border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border) 82%);
        border-radius: var(--radius-pill);
        background: color-mix(in srgb, var(--accent) 5%, transparent 95%);
        color: var(--muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
      }

      .about-meta-chip-muted {
        border-color: color-mix(in srgb, var(--border) 88%, transparent 12%);
        background: color-mix(in srgb, var(--bg) 92%, white 8%);
      }

      .about-notice-header .section-title,
      .about-changelog-block .panel-title {
        display: block;
        min-height: 0;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        text-transform: uppercase;
      }

      .about-notice-shell {
        margin-top: 14px;
        display: grid;
        gap: 16px;
      }

      .about-notice-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 12px;
      }

      .about-info-card {
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 14px;
        background: color-mix(in srgb, var(--bg) 97%, white 3%);
      }

      .about-notice-header .section-title,
      .about-changelog-block .panel-title {
        margin: 0 0 8px;
      }

      .about-notice-header .help,
      .about-changelog-block .help {
        margin: 0;
      }

      .about-notice-shell .notice-list {
        margin: 0;
        padding-left: 18px;
      }

      .about-info-card .changelog-content {
        margin-top: 0;
      }

      .about-changelog-block {
        display: grid;
        gap: 10px;
      }`;
}
