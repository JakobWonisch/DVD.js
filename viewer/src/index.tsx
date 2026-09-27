import { render } from 'solid-js/web';
import { App } from './App.js';
import { registerDvdHostElements } from './host/dvdHost.js';
import './styles.css';

registerDvdHostElements();

const root = document.getElementById('root');
if (!root) {
  throw new Error('#root missing');
}

render(() => <App />, root);
