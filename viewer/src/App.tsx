import type { Component, ParentProps } from 'solid-js';
import { A, HashRouter, Route } from '@solidjs/router';
import { Catalogue } from './components/Catalogue.js';
import { PlayDisc } from './components/PlayDisc.js';

const Shell: Component<ParentProps> = (props) => (
  <div class="app-shell">
    <header class="topbar">
      <A href="/" class="brand">
        <img src="/img/dvd.js.svg" alt="" width="18" height="18" />
        DVD Menu Archive
      </A>
      <nav>
        <A href="/" end>
          Archive
        </A>
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
    </footer>
  </div>
);

export const App: Component = () => (
  <HashRouter root={Shell}>
    <Route path="/" component={Catalogue} />
    <Route path="/play" component={Catalogue} />
    <Route path="/play/:dvdId" component={PlayDisc} />
  </HashRouter>
);
