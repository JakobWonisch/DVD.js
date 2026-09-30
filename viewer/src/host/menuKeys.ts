/**
 * Menu D-pad / Enter handling for <x-video>.
 * Prefer PCI adjacency on the live hitboxes; fall back to geometry when a
 * neighbor is missing or points at the current button.
 */

import {
  beginUserButtonNav,
  isTitleUnavailableOpen,
} from './titleUnavailable.js';

export type MenuKeyHost = HTMLElement & {
  _dvdjsActiveMenu?: HTMLElement | null;
  _dvdjsFromButton?: boolean;
  _dvdjsMenuResume?: unknown;
  beginUserButtonNav?: () => void;
  skipToEnd?: () => boolean;
  goToMainMenu?: () => boolean;
  setMenuHighlight?: (menu: Element | null, buttonIndex: number) => void;
  flashMenuActivate?: (menu: Element | null, buttonIndex: number) => void;
};

function activeMenu(host: MenuKeyHost): HTMLElement | null {
  const menu = host._dvdjsActiveMenu;
  if (!menu || menu.hidden) {
    return null;
  }
  const disp = menu.style.display || '';
  if (disp === 'none') {
    return null;
  }
  return menu;
}

function buttonList(menu: HTMLElement): HTMLInputElement[] {
  return Array.from(menu.querySelectorAll('input.btn')) as HTMLInputElement[];
}

function currentIndex(buttons: HTMLInputElement[]): number {
  const sprm = (window as any).sprm;
  let idx =
    Math.floor(((sprm && sprm.HL_BTNN) || 0x0400) / 0x0400) - 1;
  if (idx < 0 || idx >= buttons.length) {
    idx = buttons.findIndex(
      (b) =>
        b.classList.contains('selected') || b.dataset.selected === '1',
    );
  }
  if (idx < 0 || idx >= buttons.length) {
    idx = 0;
  }
  return idx;
}

function neighborFromDataset(
  btn: HTMLInputElement,
  dir: 'up' | 'down' | 'left' | 'right',
): number | null {
  const raw = btn.dataset[dir];
  if (raw == null || raw === '') {
    return null;
  }
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id) || id < 1) {
    return null;
  }
  return id; // 1-based
}

function centerOf(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
}

/** Nearest hitbox in the arrow direction (geometry fallback). */
export function findSpatialNeighbor(
  buttons: HTMLInputElement[],
  fromIndex: number,
  dir: 'up' | 'down' | 'left' | 'right',
): number | null {
  if (fromIndex < 0 || fromIndex >= buttons.length) {
    return null;
  }
  const from = centerOf(buttons[fromIndex]);
  let best: number | null = null;
  let bestScore = Infinity;

  for (let i = 0; i < buttons.length; i++) {
    if (i === fromIndex) {
      continue;
    }
    const c = centerOf(buttons[i]);
    const dx = c.x - from.x;
    const dy = c.y - from.y;
    let primary = 0;
    let lateral = 0;
    if (dir === 'up') {
      if (dy >= -2) continue;
      primary = -dy;
      lateral = Math.abs(dx);
    } else if (dir === 'down') {
      if (dy <= 2) continue;
      primary = dy;
      lateral = Math.abs(dx);
    } else if (dir === 'left') {
      if (dx >= -2) continue;
      primary = -dx;
      lateral = Math.abs(dy);
    } else {
      if (dx <= 2) continue;
      primary = dx;
      lateral = Math.abs(dy);
    }
    // Prefer mostly-aligned neighbors, then closer along the axis.
    const score = primary + lateral * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** btnCmd is indexed [domain][vobId][cellId][buttonIndex]. */
export function lookupBtnCmd(
  btnCmd: unknown,
  domain: string,
  vob: string,
  cell: string,
  idx: number,
): (() => void) | undefined {
  const byDomain = (btnCmd as any)?.[domain];
  const byVob = byDomain?.[vob];
  const byCell = byVob?.[cell];
  const cmd = byCell?.[idx];
  return typeof cmd === 'function' ? cmd : undefined;
}

/** @returns true if a btnCmd ran (caller may stop key propagation). */
export function activateButton(
  host: MenuKeyHost,
  menu: HTMLElement,
  idx: number,
): boolean {
  const domain = menu.dataset.domain;
  const vob = menu.dataset.vob;
  const cell = menu.dataset.cell;
  if (domain == null || vob == null || cell == null) {
    return false;
  }
  const cmd = lookupBtnCmd((window as any).btnCmd, domain, vob, cell, idx);
  if (!cmd) {
    return false;
  }
  host.setMenuHighlight?.(menu, idx);
  host.flashMenuActivate?.(menu, idx);
  if (typeof host.beginUserButtonNav === 'function') {
    host.beginUserButtonNav();
  } else {
    beginUserButtonNav(host as any);
  }
  cmd();
  return true;
}

export type MenuNavAction = 'up' | 'down' | 'left' | 'right' | 'enter';

/**
 * Programmatic D-pad / Enter (virtual remote). Same path as keyboard arrows.
 * @returns true if the action was handled.
 */
export function handleMenuNavAction(
  host: MenuKeyHost,
  action: MenuNavAction,
): boolean {
  // Sticky missing-title dialog owns input until OK / Escape.
  if (isTitleUnavailableOpen(host as any)) {
    return false;
  }

  const menu = activeMenu(host);
  if (!menu) {
    return false;
  }

  const buttons = buttonList(menu);
  if (!buttons.length) {
    return false;
  }

  const idx = currentIndex(buttons);

  if (action === 'enter') {
    return activateButton(host, menu, idx);
  }

  const dir = action;
  const currentBtn = buttons[idx];
  let nextId = neighborFromDataset(currentBtn, dir); // 1-based
  // Self-link or missing → spatial fallback so vertical lists stay fully reachable.
  if (nextId == null || nextId === idx + 1) {
    const spatial = findSpatialNeighbor(buttons, idx, dir);
    if (spatial != null) {
      nextId = spatial + 1;
    }
  }
  if (nextId == null || nextId < 1 || nextId > buttons.length) {
    return false;
  }
  if (nextId === idx + 1) {
    return false;
  }

  const sprm = (window as any).sprm || ((window as any).sprm = {});
  sprm.HL_BTNN = nextId * 0x0400;
  host.setMenuHighlight?.(menu, nextId - 1);

  const nextBtn = buttons[nextId - 1];
  if (nextBtn?.dataset.autoAction === '1') {
    activateButton(host, menu, nextId - 1);
  }
  return true;
}

/**
 * @returns true if the event was handled (caller should stop propagation).
 */
export function handleMenuKeyDown(
  host: MenuKeyHost,
  event: KeyboardEvent,
): boolean {
  // Sticky missing-title dialog owns the keyboard until OK / Escape.
  if (isTitleUnavailableOpen(host as any)) {
    return false;
  }

  // Don't steal keys from real form fields / contenteditable.
  const t = event.target;
  if (
    t instanceof HTMLElement &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' ||
      t.isContentEditable)
  ) {
    // Menu hitboxes are input.btn — still handle those below.
    if (!(t instanceof HTMLInputElement) || !t.classList.contains('btn')) {
      return false;
    }
  }

  const key = event.key;
  if (key === 'n' || key === 'N' || event.code === 'KeyN') {
    if (typeof host.skipToEnd === 'function' && host.skipToEnd()) {
      event.preventDefault();
      return true;
    }
    return false;
  }
  if (key === 'm' || key === 'M' || event.code === 'KeyM') {
    if (typeof host.goToMainMenu === 'function' && host.goToMainMenu()) {
      event.preventDefault();
      return true;
    }
    return false;
  }

  let action: MenuNavAction | null = null;
  if (key === 'ArrowUp' || event.code === 'ArrowUp') action = 'up';
  else if (key === 'ArrowDown' || event.code === 'ArrowDown') action = 'down';
  else if (key === 'ArrowLeft' || event.code === 'ArrowLeft') action = 'left';
  else if (key === 'ArrowRight' || event.code === 'ArrowRight') action = 'right';
  else if (key === 'Enter' || event.code === 'Enter') action = 'enter';
  else {
    return false;
  }

  if (!handleMenuNavAction(host, action)) {
    return false;
  }
  // Enter: only claim when btnCmd ran (handleMenuNavAction already gated that).
  // A failed host lookup must not stopImmediatePropagation — generated vm.js
  // still handles Enter with cell.
  event.preventDefault();
  return true;
}

function buttonIndexFromTarget(
  host: MenuKeyHost,
  target: EventTarget | null,
): { menu: HTMLElement; idx: number } | null {
  if (!(target instanceof HTMLInputElement) || !target.classList.contains('btn')) {
    return null;
  }
  if (target.disabled) {
    return null;
  }
  const menu = activeMenu(host);
  if (!menu || !menu.contains(target)) {
    return null;
  }
  const idx = parseInt(target.dataset.id || '', 10);
  if (!Number.isFinite(idx) || idx < 0) {
    return null;
  }
  return { menu, idx };
}

function selectButton(host: MenuKeyHost, menu: HTMLElement, idx: number) {
  const sprm = (window as any).sprm || ((window as any).sprm = {});
  const current = Math.floor((sprm.HL_BTNN || 0x0400) / 0x0400) - 1;
  if (current === idx) {
    return;
  }
  sprm.HL_BTNN = (idx + 1) * 0x0400;
  host.setMenuHighlight?.(menu, idx);
}

export function bindMenuKeys(host: MenuKeyHost): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (handleMenuKeyDown(host, event)) {
      event.stopImmediatePropagation();
    }
  };
  /** Hover moves the highlight; click / Enter activates. */
  const onPointerOver = (event: PointerEvent) => {
    const hit = buttonIndexFromTarget(host, event.target);
    if (!hit) {
      return;
    }
    selectButton(host, hit.menu, hit.idx);
  };
  const onClick = (event: MouseEvent) => {
    const hit = buttonIndexFromTarget(host, event.target);
    if (!hit) {
      return;
    }
    event.preventDefault();
    selectButton(host, hit.menu, hit.idx);
    if (!activateButton(host, hit.menu, hit.idx)) {
      // Let generated vm.js try (e.g. older archives / lookup miss).
      return;
    }
    // After btnCmd the hitbox is often detached — a second handler would
    // read parentNode.dataset and throw (HP Special Features B0).
    event.stopImmediatePropagation();
  };
  // Capture so we win over generated vm.js keydown (and avoid double-steps).
  document.addEventListener('keydown', onKey, true);
  host.addEventListener('pointerover', onPointerOver);
  host.addEventListener('click', onClick);
  return () => {
    document.removeEventListener('keydown', onKey, true);
    host.removeEventListener('pointerover', onPointerOver);
    host.removeEventListener('click', onClick);
  };
}

/** Short label for debug hitbox chrome (id + PCI neighbors). */
export function debugButtonLabel(index: number, btn: HTMLInputElement): string {
  const id = btn.dataset.id ?? String(index);
  const u = btn.dataset.up ?? '·';
  const d = btn.dataset.down ?? '·';
  const l = btn.dataset.left ?? '·';
  const r = btn.dataset.right ?? '·';
  return `B${id} ↑${u}↓${d}←${l}→${r}`;
}

export function applyDebugHitboxLabels(menu: HTMLElement | null | undefined) {
  if (!menu) {
    return;
  }
  buttonList(menu).forEach((btn, i) => {
    btn.value = debugButtonLabel(i, btn);
  });
}
