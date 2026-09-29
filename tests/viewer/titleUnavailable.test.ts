import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TITLE_UNAVAILABLE_HEADING,
  TITLE_UNAVAILABLE_MESSAGE,
  TITLE_UNAVAILABLE_OK_LABEL,
  beginUserButtonNav,
  captureMenuResumeState,
  clearMissingTitleSkip,
  clearUserButtonNav,
  escapeToVmgmTitleMenu,
  hideTitleUnavailableOverlay,
  resolveTitleUnavailableRoot,
  restoreMenuResumeState,
  scheduleMenuPostAfterStill,
  shouldHoldAfterMenuMotion,
  showTitleUnavailableOverlay,
  tryAutoSkipMissingTitle,
} from '../../viewer/src/host/titleUnavailable.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('tryAutoSkipMissingTitle', () => {
  it('auto-follows missing title PGC post when not from a button', async () => {
    vi.useFakeTimers();
    const post = vi.fn();
    const host: { _dvdjsMissingTitleSkip?: Set<string>; onmenu?: () => void } =
      {};
    const ok = tryAutoSkipMissingTitle(
      host,
      { domain: 4, pgc: 2, PGCIUT: { 4: { 2: { post } } } },
      false,
    );
    expect(ok).toBe(true);
    expect(host._dvdjsMissingTitleSkip?.has('4:2')).toBe(true);
    await vi.runAllTimersAsync();
    expect(post).toHaveBeenCalledOnce();
  });

  it('breaks Avatar-style missing-title cycles via onmenu', async () => {
    vi.useFakeTimers();
    const onmenu = vi.fn();
    const post = vi.fn();
    const host = { onmenu };
    const g = { domain: 5, pgc: 4, PGCIUT: { 5: { 4: { post } } } };

    expect(tryAutoSkipMissingTitle(host, g, false)).toBe(true);
    await vi.runAllTimersAsync();
    expect(post).toHaveBeenCalledOnce();

    // Same title PGC again (PGC9 → JumpTT → missing → post → PGC9 → …)
    expect(tryAutoSkipMissingTitle(host, g, false)).toBe(true);
    expect(onmenu).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledOnce(); // not called again
  });

  it('does not auto-skip when JumpTT came from a menu button', () => {
    const post = vi.fn();
    const host = {};
    expect(
      tryAutoSkipMissingTitle(
        host,
        { domain: 4, pgc: 2, PGCIUT: { 4: { 2: { post } } } },
        true,
      ),
    ).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('shows the unavailable dialog when missing-title post throws', async () => {
    vi.useFakeTimers();
    const originalDocument = globalThis.document;
    const children: any[] = [];
    const host: any = {
      querySelector: (sel: string) =>
        children.find((c) => c.className === sel.slice(1)) || null,
      closest: () => null,
      appendChild: (n: any) => {
        children.push(n);
        return n;
      },
      style: {},
    };
    // Minimal document for overlay createElement / keydown.
    const keyListeners: Array<(ev: any) => void> = [];
    globalThis.document = {
      createElement: (tag: string) => {
        const kids: any[] = [];
        const el: any = {
          tagName: tag,
          className: '',
          hidden: false,
          style: { display: '' },
          textContent: '',
          children: kids,
          setAttribute() {},
          getAttribute: () => null,
          appendChild(c: any) {
            kids.push(c);
            return c;
          },
          querySelector(sel: string) {
            const walk = (nodes: any[]): any => {
              for (const n of nodes) {
                if (sel.startsWith('.') && n.className === sel.slice(1)) {
                  return n;
                }
                const hit = walk(n.children || []);
                if (hit) return hit;
              }
              return null;
            };
            return walk(kids);
          },
          addEventListener() {},
          focus() {},
          set innerHTML(_html: string) {
            const heading = {
              className: 'dvdjs-title-unavailable__heading',
              textContent: '',
              children: [],
            };
            const body = {
              className: 'dvdjs-title-unavailable__body',
              textContent: '',
              children: [],
            };
            const btn = {
              className: 'dvdjs-title-unavailable__btn',
              children: [],
              addEventListener() {},
              focus() {},
            };
            const card = {
              className: 'dvdjs-title-unavailable__card',
              children: [heading, body, btn],
              querySelector(sel: string) {
                return (
                  card.children.find(
                    (c: any) => c.className === sel.slice(1),
                  ) || null
                );
              },
            };
            kids.length = 0;
            kids.push(card);
            el.querySelector = (sel: string) => {
              if (sel.startsWith('.') && el.className === sel.slice(1)) {
                return el;
              }
              return card.querySelector(sel);
            };
          },
        };
        return el;
      },
      addEventListener: (type: string, fn: (ev: any) => void) => {
        if (type === 'keydown') keyListeners.push(fn);
      },
      removeEventListener: (type: string, fn: (ev: any) => void) => {
        if (type === 'keydown') {
          const i = keyListeners.indexOf(fn);
          if (i >= 0) keyListeners.splice(i, 1);
        }
      },
    } as any;

    const post = vi.fn(() => {
      throw new TypeError("can't access property 2, MPGCIUT[0][lang] is undefined");
    });
    tryAutoSkipMissingTitle(
      host,
      { domain: 4, pgc: 2, lang: 'en', PGCIUT: { 4: { 2: { post } } }, MPGCIUT: { 0: { de: {} } } },
      false,
    );
    await vi.runAllTimersAsync();
    expect(post).toHaveBeenCalledOnce();
    expect(children.some((c) => c.className === 'dvdjs-title-unavailable')).toBe(
      true,
    );

    if (originalDocument === undefined) {
      // @ts-expect-error cleanup
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  });

  it('clearMissingTitleSkip resets the visited set', () => {
    const host: { _dvdjsMissingTitleSkip?: Set<string> } = {
      _dvdjsMissingTitleSkip: new Set(['4:2']),
    };
    clearMissingTitleSkip(host);
    expect(host._dvdjsMissingTitleSkip?.size).toBe(0);
  });
});

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
      const walk = (nodes: any[]): any => {
        for (const n of nodes) {
          if (sel.startsWith('.') && n.className === sel.slice(1)) return n;
          if (sel.startsWith('#') && attrs.id === sel.slice(1)) return n;
          const hit = walk(n.children || []);
          if (hit) return hit;
        }
        return null;
      };
      // Also match self when querying from parent that holds us.
      if (sel.startsWith('.') && el.className === sel.slice(1)) return el;
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
      // Parse the three known nodes from our dialog template.
      const heading = fakeEl('p', 'dvdjs-title-unavailable__heading');
      heading.id = 'dvdjs-title-unavailable-heading';
      const body = fakeEl('p', 'dvdjs-title-unavailable__body');
      const btn = fakeEl('button', 'dvdjs-title-unavailable__btn');
      const card = fakeEl('div', 'dvdjs-title-unavailable__card');
      card.appendChild(heading);
      card.appendChild(body);
      card.appendChild(btn);
      el.appendChild(card);
      void html;
    },
    get innerHTML() {
      return '';
    },
  };
  return el;
}

describe('showTitleUnavailableOverlay', () => {
  const originalDocument = globalThis.document;

  afterEach(() => {
    if (originalDocument === undefined) {
      // @ts-expect-error cleanup test document
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  });

  function installDoc() {
    const keyListeners: Array<(ev: any) => void> = [];
    const doc: any = {
      createElement(tag: string) {
        return fakeEl(tag);
      },
      addEventListener(type: string, fn: (ev: any) => void, _cap?: boolean) {
        if (type === 'keydown') keyListeners.push(fn);
      },
      removeEventListener(type: string, fn: (ev: any) => void) {
        if (type === 'keydown') {
          const i = keyListeners.indexOf(fn);
          if (i >= 0) keyListeners.splice(i, 1);
        }
      },
      dispatchKey(key: string) {
        const ev = {
          key,
          code: key === ' ' ? 'Space' : key,
          preventDefault() {},
          stopPropagation() {},
          stopImmediatePropagation() {},
        };
        for (const fn of [...keyListeners]) fn(ev);
      },
      _keyListeners: keyListeners,
    };
    globalThis.document = doc;
    return doc;
  }

  it('mounts a dialog on the player stage when present (fullscreen-safe)', () => {
    installDoc();
    const stage = fakeEl('div', 'player-stage');
    const host = fakeEl('div');
    host.closest = (sel: string) =>
      sel === '.player-stage' ? stage : null;
    stage.appendChild(host);

    expect(resolveTitleUnavailableRoot(host)).toBe(stage);

    showTitleUnavailableOverlay(host);

    const dialog = stage.querySelector('.dvdjs-title-unavailable');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.hidden).toBe(false);
    expect(
      dialog.querySelector('.dvdjs-title-unavailable__heading')?.textContent,
    ).toBe(TITLE_UNAVAILABLE_HEADING);
    expect(
      dialog.querySelector('.dvdjs-title-unavailable__body')?.textContent,
    ).toBe(TITLE_UNAVAILABLE_MESSAGE);
    expect(
      dialog.querySelector('.dvdjs-title-unavailable__btn')?.textContent,
    ).toBe(TITLE_UNAVAILABLE_OK_LABEL);
    expect(host.querySelector('.dvdjs-title-unavailable')).toBeNull();
  });

  it('stays visible until dismissed, then runs onDismiss', () => {
    installDoc();
    const host = fakeEl('div');
    host.closest = () => null;
    const onDismiss = vi.fn();

    showTitleUnavailableOverlay(host, { onDismiss });
    const dialog = host.querySelector('.dvdjs-title-unavailable');
    expect(dialog.hidden).toBe(false);

    dialog.querySelector('.dvdjs-title-unavailable__btn').click();

    expect(dialog.hidden).toBe(true);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('dismisses on Escape without leaving the dialog up', () => {
    const doc = installDoc();
    const host = fakeEl('div');
    host.closest = () => null;
    const onDismiss = vi.fn();
    showTitleUnavailableOverlay(host, { onDismiss });

    doc.dispatchKey('Escape');

    const dialog = host.querySelector('.dvdjs-title-unavailable');
    expect(dialog.hidden).toBe(true);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('dismisses on Enter like OK', () => {
    const doc = installDoc();
    const host = fakeEl('div');
    host.closest = () => null;
    const onDismiss = vi.fn();
    showTitleUnavailableOverlay(host, { onDismiss });

    doc.dispatchKey('Enter');

    const dialog = host.querySelector('.dvdjs-title-unavailable');
    expect(dialog.hidden).toBe(true);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('hideTitleUnavailableOverlay hides without invoking onDismiss', () => {
    installDoc();
    const host = fakeEl('div');
    host.closest = () => null;
    const onDismiss = vi.fn();
    showTitleUnavailableOverlay(host, { onDismiss });

    hideTitleUnavailableOverlay(host);

    const dialog = host.querySelector('.dvdjs-title-unavailable');
    expect(dialog.hidden).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('menu resume snapshot', () => {
  it('beginUserButtonNav captures VM + menu id for later restore', () => {
    const setMenuHighlight = vi.fn();
    const menu: any = {
      id: 'menu-en-1-1',
      dataset: { domain: '1' },
      style: { display: 'none' },
      hidden: true,
      show() {
        this.hidden = false;
        this.style.display = 'flex';
      },
    };
    const host: any = {
      _dvdjsActiveMenu: menu,
      setMenuHighlight,
      querySelector: (sel: string) => (sel === '#menu-en-1-1' ? menu : null),
    };
    const g: any = {
      domain: 1,
      pgc: 3,
      lang: 'en',
      pgcSpace: 'menu',
      cellN: 2,
      sprm: { HL_BTNN: 4 * 0x0400 },
    };

    beginUserButtonNav(host, g);
    expect(host._dvdjsFromButton).toBe(true);
    expect(host._dvdjsMenuResume?.menuId).toBe('menu-en-1-1');
    expect(host._dvdjsMenuResume?.domain).toBe(1);
    expect(host._dvdjsMenuResume?.pgc).toBe(3);
    expect(host._dvdjsMenuResume?.hlBtnn).toBe(4 * 0x0400);

    // Simulate JumpTT mutating VM before playByID notices missing media.
    g.domain = 4;
    g.pgc = 1;
    g.pgcSpace = 'title';
    g.sprm.HL_BTNN = 0x0400;
    menu.hidden = true;
    menu.style.display = 'none';

    expect(restoreMenuResumeState(host, g)).toBe(true);
    expect(g.domain).toBe(1);
    expect(g.pgc).toBe(3);
    expect(g.pgcSpace).toBe('menu');
    expect(g.cellN).toBe(2);
    expect(g.sprm.HL_BTNN).toBe(4 * 0x0400);
    expect(menu.hidden).toBe(false);
    expect(menu.style.display).toBe('flex');
    expect(setMenuHighlight).toHaveBeenCalledWith(menu, 3);
    expect(host._dvdjsMenuResume).toBeNull();
  });

  it('clearUserButtonNav drops the snapshot', () => {
    const host: any = { _dvdjsFromButton: true };
    captureMenuResumeState(host, { domain: 1, pgc: 1 });
    clearUserButtonNav(host);
    expect(host._dvdjsFromButton).toBe(false);
    expect(host._dvdjsMenuResume).toBeNull();
  });
});

describe('shouldHoldAfterMenuMotion', () => {
  it('holds only for infinite still_time 255', () => {
    expect(shouldHoldAfterMenuMotion(255)).toBe(true);
    expect(shouldHoldAfterMenuMotion(0)).toBe(false);
    expect(shouldHoldAfterMenuMotion(5)).toBe(false);
  });
});

describe('scheduleMenuPostAfterStill', () => {
  it('waits still_time seconds before post (copyright-style cells)', async () => {
    vi.useFakeTimers();
    const post = vi.fn();
    const host: {
      _dvdjsStillTimer?: ReturnType<typeof setTimeout> | null;
      _dvdjsMenuPost?: (() => void) | null;
    } = { _dvdjsMenuPost: post };

    scheduleMenuPostAfterStill(host, 2, post);
    expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1999);
    expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledOnce();
    expect(host._dvdjsMenuPost).toBeNull();
  });

  it('posts immediately when still_time is 0', () => {
    const post = vi.fn();
    const host: {
      _dvdjsStillTimer?: ReturnType<typeof setTimeout> | null;
      _dvdjsMenuPost?: (() => void) | null;
    } = { _dvdjsMenuPost: post };

    scheduleMenuPostAfterStill(host, 0, post);
    expect(post).toHaveBeenCalledOnce();
    expect(host._dvdjsMenuPost).toBeNull();
  });
});

describe('escapeToVmgmTitleMenu', () => {
  it('falls back to a non-stub VTS Root when VMGM Title is missing (HP)', () => {
    const run = vi.fn();
    const onmenu = vi.fn();
    const host = { onmenu };
    const g: any = {
      lang: 'en',
      domain: 1,
      MENU_TYPES: [
        { 'ÿÿ': [] },
        {
          en: [
            undefined,
            undefined,
            undefined,
            { domain: 1, lang: 'en', pgc: 1 },
          ],
        },
      ],
      MPGCIUT: [
        undefined,
        {
          en: {
            1: { cells: [{ still_time: 255 }], run },
          },
        },
      ],
    };

    expect(escapeToVmgmTitleMenu(host, g)).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(onmenu).not.toHaveBeenCalled();
    expect(g.domain).toBe(1);
  });

  it('skips stub VTS Root and uses VMGM Title (Avatar-class)', () => {
    const runTitle = vi.fn();
    const runStub = vi.fn();
    const g: any = {
      lang: 'en',
      domain: 5,
      MENU_TYPES: [
        {
          en: [
            undefined,
            undefined,
            { domain: 0, lang: 'en', pgc: 9 },
          ],
        },
        undefined,
        undefined,
        undefined,
        undefined,
        {
          en: [
            undefined,
            undefined,
            undefined,
            { domain: 5, lang: 'en', pgc: 1 },
          ],
        },
      ],
      MPGCIUT: [
        {
          en: {
            9: { cells: [{ still_time: 0 }], run: runTitle },
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        {
          en: {
            1: { cells: [], run: runStub },
          },
        },
      ],
    };

    expect(escapeToVmgmTitleMenu({}, g)).toBe(true);
    expect(runTitle).toHaveBeenCalledOnce();
    expect(runStub).not.toHaveBeenCalled();
    expect(g.domain).toBe(0);
  });
});
