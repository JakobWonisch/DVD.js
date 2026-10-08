import type { Component, ParentProps } from 'solid-js';
import { Show, createSignal } from 'solid-js';
import { A, Route, Router } from '@solidjs/router';
import { ArchivePage, ViewerEmpty } from './components/ArchivePage.js';
import { CopyrightPage } from './components/CopyrightPage.js';
import { PlayDisc } from './components/PlayDisc.js';

const COPYRIGHT_BANNER_HIDE_KEY = 'dvd-menu-archive-hide-copyright-banner';

function readCopyrightBannerHidden(): boolean {
  try {
    return localStorage.getItem(COPYRIGHT_BANNER_HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Migrate legacy `/#/play/:id` bookmarks to history URLs for link previews. */
function migrateLegacyHashRoute(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const hash = window.location.hash || '';
  if (!hash.startsWith('#/')) {
    return;
  }
  const path = hash.slice(1);
  if (
    path === '/' ||
    path === '/copyright' ||
    path === '/copyright/' ||
    /^\/play(\/[^/]+)?\/?$/.test(path)
  ) {
    const target = path === '/' ? '/' : path.replace(/\/$/, '') || '/';
    window.history.replaceState(
      null,
      '',
      target + window.location.search,
    );
  }
}

migrateLegacyHashRoute();

const Shell: Component<ParentProps> = (props) => {
  const [bannerHidden, setBannerHidden] = createSignal(readCopyrightBannerHidden());

  const dismissBanner = () => {
    try {
      localStorage.setItem(COPYRIGHT_BANNER_HIDE_KEY, '1');
    } catch {
      /* private mode / quota — still hide for this session */
    }
    setBannerHidden(true);
  };

  return (
    <div class="app-shell">
      <Show when={!bannerHidden()}>
        <aside class="copyright-banner" role="note">
          <p>
            Copyright holders: we honor valid take-down requests and will remove
            or disable access to identified material promptly.
            {' '}
            <A href="/copyright">How to request removal</A>
          </p>
          <button
            type="button"
            class="copyright-banner__dismiss"
            aria-label="Dismiss copyright notice"
            title="Dismiss"
            onClick={dismissBanner}
          >
            ×
          </button>
        </aside>
      </Show>
      <header class="topbar">
        <A href="/" class="brand">
          <img src="/img/dvd.js.svg" alt="" width="18" height="18" />
          DVD Menu Archive
        </A>
        <nav>
          <A href="/" end>
            Archive
          </A>
          <A href="/copyright">Copyright</A>
        </nav>
      </header>
      <main>{props.children}</main>
      <footer>
        <p class="footer-credits">
          <span>
            © 2026 Jakob Wonisch (
            <a href="https://github.com/JakobWonisch">
              https://github.com/JakobWonisch
            </a>
            )
          </span>
          <span class="footer-credits__sep" aria-hidden="true">
            ·
          </span>
          <span>
            Based on DVD.js © 2018 Guillaume Marty (
            <a href="https://github.com/gmarty">https://github.com/gmarty</a>)
          </span>
        </p>
        <p class="footer-legal">
          <A href="/copyright">Copyright &amp; take-down requests</A>
        </p>
      </footer>
    </div>
  );
};

export const App: Component = () => (
  <Router root={Shell}>
    <Route path="/" component={ArchivePage}>
      <Route path="/" component={ViewerEmpty} />
      <Route path="/play" component={ViewerEmpty} />
      <Route path="/play/:dvdId" component={PlayDisc} />
    </Route>
    <Route path="/copyright" component={CopyrightPage} />
  </Router>
);
