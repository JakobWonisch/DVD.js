import { render } from 'solid-js/web';
import { App } from './App.js';
import { registerDvdHostElements } from './host/dvdHost.js';
import './styles.css';
/* Registers <crt-effect> (CSS CRT overlay; MIT). */
import 'vault66-crt-effect/element';

registerDvdHostElements();

const root = document.getElementById('root');
if (!root) {
  throw new Error('#root missing');
}

render(() => <App />, root);
