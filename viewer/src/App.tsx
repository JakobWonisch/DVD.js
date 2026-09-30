import type { Component, ParentProps } from 'solid-js';
import { Show } from 'solid-js';
import { A, HashRouter, Route, useLocation } from '@solidjs/router';
import { Catalogue } from './components/Catalogue.js';
import { CopyrightPage } from './components/CopyrightPage.js';
import { PlayDisc } from './components/PlayDisc.js';

const Shell: Component<ParentProps> = (props) => {
  const location = useLocation();
  const hideBanner = () =>
    location.pathname.startsWith('/play/') &&
    location.pathname !== '/play' &&
    location.pathname !== '/play/';

  return (
    <div class="app-shell">
      <Show when={!hideBanner()}>
        <aside class="copyright-banner" role="note">
          <p>
            Copyright holders: we honor valid take-down requests and will remove
            or disable access to identified material promptly.
            {' '}
            <A href="/copyright">How to request removal</A>
          </p>
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
  <HashRouter root={Shell}>
    <Route path="/" component={Catalogue} />
    <Route path="/play" component={Catalogue} />
    <Route path="/play/:dvdId" component={PlayDisc} />
    <Route path="/copyright" component={CopyrightPage} />
  </HashRouter>
);
