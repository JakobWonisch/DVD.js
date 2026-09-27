import type { Component, ParentProps } from 'solid-js';
import { A, HashRouter, Route } from '@solidjs/router';
import { Catalogue } from './components/Catalogue.js';
import { PlayDisc } from './components/PlayDisc.js';

const Shell: Component<ParentProps> = (props) => (
  <div class="app-shell">
    <header class="topbar">
      <A href="/" class="brand">
        <img src="/img/dvd.js.svg" alt="" width="18" height="18" />
        DVD.js
      </A>
      <nav>
        <A href="/" end>
          Play DVD
        </A>
        <a href="/test.html">Test your browser</a>
        <a href="/parse-ifo.html">Parse IFO files</a>
      </nav>
    </header>
    <main>{props.children}</main>
    <footer>
      <p>
        © 2018 Guillaume Marty (
        <a href="https://github.com/gmarty">https://github.com/gmarty</a>)
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
