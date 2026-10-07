import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hideViewerCrashOverlay,
  isViewerCrashOpen,
  runUserVmCommand,
  showViewerCrashOverlay,
  VIEWER_CRASH_HEADING,
} from '../../viewer/src/host/viewerCrash.js';
import { pushVmUndo } from '../../viewer/src/host/vmUndo.js';

/** Minimal element tree for overlay mount tests (node env, no happy-dom). */
function fakeEl(tag: string, className = '') {
  const children: any[] = [];
  const attrs: Record<string, string> = {};
  const listeners: Record<string, Array<(ev: any) => void>> = {};
  const el: any = {
    tagName: tag.toUpperCase(),
    className,
    hidden: false,
    style: { display: '' },
    textContent: '',
    children,
    disabled: false,
    getAttribute(name: string) {
      return attrs[name] ?? null;
    },
    setAttribute(name: string, value: string) {
      attrs[name] = value;
    },
    appendChild(child: any) {
      children.push(child);
      child.parentNode = el;
      return child;
    },
    querySelector(sel: string) {
      const match = (n: any) => {
        if (sel.startsWith('.') && n.className === sel.slice(1)) return true;
        if (sel.startsWith('#') && n.id === sel.slice(1)) return true;
        return false;
      };
      const walk = (nodes: any[]): any => {
        for (const n of nodes) {
          if (match(n)) return n;
          const hit = walk(n.children || []);
          if (hit) return hit;
        }
        return null;
      };
      if (match(el)) return el;
      return walk(children);
    },
    addEventListener(type: string, fn: (ev: any) => void) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type: string, fn: (ev: any) => void) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    click() {
      for (const fn of listeners.click || []) fn({});
    },
    focus() {},
    set innerHTML(html: string) {
      children.length = 0;
      const heading = fakeEl(
        'p',
        'dvd-menu-archive-viewer-crash__heading',
      );
      heading.id = 'dvd-menu-archive-viewer-crash-heading';
      const body = fakeEl('p', 'dvd-menu-archive-viewer-crash__body');
      const detail = fakeEl('p', 'dvd-menu-archive-viewer-crash__detail');
      const actions = fakeEl(
        'div',
        'dvd-menu-archive-viewer-crash__actions',
      );
      const report = fakeEl(
        'button',
        'dvd-menu-archive-viewer-crash__btn dvd-menu-archive-viewer-crash__btn--report',
      );
      // querySelector matches exact className — set primary class for btn--report lookup
      report.className = 'dvd-menu-archive-viewer-crash__btn--report';
      const back = fakeEl(
        'button',
        'dvd-menu-archive-viewer-crash__btn--back',
      );
      const status = fakeEl('p', 'dvd-menu-archive-viewer-crash__status');
      actions.appendChild(report);
      actions.appendChild(back);
      const card = fakeEl('div', 'dvd-menu-archive-viewer-crash__card');
      card.appendChild(heading);
      card.appendChild(body);
      card.appendChild(detail);
      card.appendChild(actions);
      card.appendChild(status);
      el.appendChild(card);
      void html;
    },
    get innerHTML() {
      return '';
    },
  };
  return el;
}

describe('viewer crash overlay', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalDocument === undefined) {
      // @ts-expect-error cleanup
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
    if (originalWindow === undefined) {
      // @ts-expect-error cleanup
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
  });

  function installDoc() {
    const keyListeners: Array<(ev: any) => void> = [];
    const doc: any = {
      createElement(tag: string) {
        return fakeEl(tag);
      },
      addEventListener(type: string, fn: (ev: any) => void) {
        if (type === 'keydown') keyListeners.push(fn);
      },
      removeEventListener(type: string, fn: (ev: any) => void) {
        if (type === 'keydown') {
          const i = keyListeners.indexOf(fn);
          if (i >= 0) keyListeners.splice(i, 1);
        }
      },
    };
    globalThis.document = doc;
    return { doc, keyListeners };
  }

  it('shows dialog and Go back restores prior VM state', () => {
    installDoc();
    const stage = fakeEl('div', 'player-stage');
    const host: any = stage;
    host.closest = (sel: string) =>
      sel === '.player-stage' ? stage : null;

    const g: any = {
      domain: 1,
      pgc: 2,
      lang: 'en',
      pgcSpace: 'menu',
      cellN: 2,
      pgN: 2,
      gprm: Array(16).fill(0),
      gprm_mode: Array(16).fill(0),
      sprm: { HL_BTNN: 0x0400 },
      t: null,
      stillTimer: null,
    };
    (globalThis as any).window = g;

    pushVmUndo(host, g);
    g.domain = 99;

    showViewerCrashOverlay(host, { detail: 'TypeError: boom' });
    expect(isViewerCrashOpen(host)).toBe(true);
    const heading = stage.querySelector(
      '.dvd-menu-archive-viewer-crash__heading',
    );
    expect(heading?.textContent).toBe(VIEWER_CRASH_HEADING);

    const back = stage.querySelector(
      '.dvd-menu-archive-viewer-crash__btn--back',
    );
    back.click();
    expect(isViewerCrashOpen(host)).toBe(false);
    expect(g.domain).toBe(1);
  });

  it('runUserVmCommand catches throws and opens crash UI', () => {
    installDoc();
    const stage = fakeEl('div', 'player-stage');
    const host: any = stage;
    host.closest = (sel: string) =>
      sel === '.player-stage' ? stage : null;

    const ok = runUserVmCommand(host, () => {
      throw new Error('nav exploded');
    });
    expect(ok).toBe(false);
    expect(isViewerCrashOpen(host)).toBe(true);
    hideViewerCrashOverlay(host);
  });

  it('Report button invokes onReport', async () => {
    installDoc();
    const stage = fakeEl('div', 'player-stage');
    const host: any = stage;
    host.closest = (sel: string) =>
      sel === '.player-stage' ? stage : null;

    const onReport = vi.fn(async () => {});
    showViewerCrashOverlay(host, { onReport });
    const report = stage.querySelector(
      '.dvd-menu-archive-viewer-crash__btn--report',
    );
    report.click();
    await vi.waitFor(() => expect(onReport).toHaveBeenCalled());
  });
});
