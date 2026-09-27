/**
 * Native <x-menu> — keeps the tag name expected by generated vm.js.
 */

class XMenuElement extends HTMLElement {
  connectedCallback(): void {
    if (!this.style.display) {
      this.style.display = 'none';
    }
    this.hidden = true;
  }

  show(): void {
    this.hidden = false;
    this.style.display = 'flex';
  }

  hide(): void {
    this.style.display = 'none';
    this.hidden = true;
  }
}

export function registerXMenu(): void {
  if (!customElements.get('x-menu')) {
    customElements.define('x-menu', XMenuElement);
  }
}

export type { XMenuElement };
