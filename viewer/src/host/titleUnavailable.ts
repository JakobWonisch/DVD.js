/** User-facing copy when title WebMs were omitted (menu-only archive). */
export const TITLE_UNAVAILABLE_MESSAGE =
  'This title was intentionally left out of this archive. Only menus were converted.';

export const TITLE_UNAVAILABLE_HEADING = 'Title not included';

export const TITLE_UNAVAILABLE_OK_LABEL = 'OK';

type TitleUnavailableDismiss = () => void;

/** VM + menu UI snapshot so dismiss can undo a JumpTT that already ran. */
export type MenuResumeSnapshot = {
  domain?: number;
  pgc?: number;
  lang?: string;
  pgcSpace?: string;
  cellN?: number;
  hlBtnn?: number;
  menuId?: string | null;
  menuVideoTime?: number | null;
  menuVideoPaused?: boolean | null;
};

export type MissingTitleSkipHost = {
  _dvdjsMissingTitleSkip?: Set<string>;
  /** Latched after a missing-title cycle — escape via VMGM, do not re-post. */
  _dvdjsMissingTitleBroken?: boolean;
  /**
   * Set by menu button activation; cleared when a real menu cell is shown.
   * Stays set across async JumpSS → JumpTT so missing titles show the dialog.
   */
  _dvdjsFromButton?: boolean;
  /** Captured at button press — restore on title-unavailable dismiss. */
  _dvdjsMenuResume?: MenuResumeSnapshot | null;
  _dvdjsActiveMenu?: HTMLElement | null;
  setMenuHighlight?: (menu: Element | null, buttonIndex: number) => void;
  onmenu?: ((event: object) => void) | null;
  querySelector?: (selectors: string) => Element | null;
  closest?: (selectors: string) => Element | null;
  appendChild?: (node: Node) => Node;
  style?: { position?: string };
  _dvdjsTitleUnavailableDismiss?: TitleUnavailableDismiss | null;
  _dvdjsTitleUnavailableKeyHandler?: ((ev: KeyboardEvent) => void) | null;
};

/** Minimal DOM host for overlay mount / hide (x-video or test fake). */
export type TitleUnavailableMountHost = {
  querySelector: (selectors: string) => Element | null;
  closest?: (selectors: string) => Element | null;
  appendChild?: (node: Node) => Node;
  style?: { position?: string };
  _dvdjsTitleUnavailableDismiss?: TitleUnavailableDismiss | null;
  _dvdjsTitleUnavailableKeyHandler?: ((ev: KeyboardEvent) => void) | null;
};

export type VmNavGlobals = {
  domain?: number;
  pgc?: number;
  lang?: string;
  PGCIUT?: any;
  MPGCIUT?: any;
  MENU_TYPES?: any;
  gprm?: number[];
};

import { domainMenuLangs, menuLangKeys, pickMenuLang } from './menuLanguage.js';
export { menuLangKeys, pickMenuLang };

/**
 * Before title PGC post() / CallSS into MENU_TYPES[domain][lang][…], ensure
 * g.lang exists for that domain. Harry Potter FP leaves lang as VMGM
 * "default" while VTS1 only has en/de/nl — MENU_TYPES[1][lang][3] then throws.
 */
export function alignLangForTitlePost(g: VmNavGlobals): void {
  const langDomain = typeof g.domain === 'number' ? g.domain : 0;
  g.lang = pickMenuLang(g, langDomain);
  if (!domainMenuLangs(g, langDomain).length) {
    g.lang = pickMenuLang(g, 0);
  }
}

/** Clear the menu-button latch once the user is back in a real menu. */
export function clearUserButtonNav(host: {
  _dvdjsFromButton?: boolean;
  _dvdjsMenuResume?: MenuResumeSnapshot | null;
}): void {
  host._dvdjsFromButton = false;
  host._dvdjsMenuResume = null;
}

/**
 * Latch a user-initiated button nav and snapshot menu/VM state so a missing
 * title dialog can restore the exact previous cell (existing vm.js without
 * JumpTT guards still mutate domain before playByID).
 */
export function beginUserButtonNav(
  host: MissingTitleSkipHost,
  g: VmNavGlobals & {
    pgcSpace?: string;
    cellN?: number;
    sprm?: { HL_BTNN?: number };
  } = typeof window !== 'undefined' ? (window as any) : {},
): void {
  host._dvdjsFromButton = true;
  captureMenuResumeState(host, g);
}

export function captureMenuResumeState(
  host: MissingTitleSkipHost,
  g: VmNavGlobals & {
    pgcSpace?: string;
    cellN?: number;
    sprm?: { HL_BTNN?: number };
  } = typeof window !== 'undefined' ? (window as any) : {},
): MenuResumeSnapshot {
  const menu = host._dvdjsActiveMenu || null;
  const domainAttr = menu?.dataset?.domain;
  let menuVideoTime: number | null = null;
  let menuVideoPaused: boolean | null = null;
  if (
    domainAttr != null &&
    domainAttr !== '' &&
    typeof host.querySelector === 'function'
  ) {
    const menuVideo = host.querySelector(
      `#menu-video-${domainAttr}`,
    ) as HTMLVideoElement | null;
    if (menuVideo) {
      menuVideoTime = menuVideo.currentTime;
      menuVideoPaused = menuVideo.paused;
    }
  }
  const snap: MenuResumeSnapshot = {
    domain: g.domain,
    pgc: g.pgc,
    lang: g.lang,
    pgcSpace: g.pgcSpace,
    cellN: g.cellN,
    hlBtnn: g.sprm?.HL_BTNN,
    menuId: menu?.id ?? null,
    menuVideoTime,
    menuVideoPaused,
  };
  host._dvdjsMenuResume = snap;
  return snap;
}

/**
 * Restore VM globals + visible menu/highlight after a missing-title JumpTT.
 * Returns true when a snapshot was applied.
 */
export function restoreMenuResumeState(
  host: MissingTitleSkipHost,
  g: VmNavGlobals & {
    pgcSpace?: string;
    cellN?: number;
    sprm?: { HL_BTNN?: number };
  } = typeof window !== 'undefined' ? (window as any) : {},
): boolean {
  const snap = host._dvdjsMenuResume;
  if (!snap) {
    return false;
  }
  if (snap.domain != null) {
    g.domain = snap.domain;
  }
  if (snap.pgc != null) {
    g.pgc = snap.pgc;
  }
  if (snap.lang != null) {
    g.lang = snap.lang;
  }
  if (snap.pgcSpace != null) {
    g.pgcSpace = snap.pgcSpace;
  }
  if (snap.cellN != null) {
    g.cellN = snap.cellN;
  }
  if (g.sprm && snap.hlBtnn != null) {
    g.sprm.HL_BTNN = snap.hlBtnn;
  }

  let menu: HTMLElement | null = null;
  if (snap.menuId && typeof host.querySelector === 'function') {
    try {
      menu = host.querySelector(
        `#${CSS.escape(snap.menuId)}`,
      ) as HTMLElement | null;
    } catch {
      menu = host.querySelector(`#${snap.menuId}`) as HTMLElement | null;
    }
  }
  if (!menu) {
    menu = host._dvdjsActiveMenu || null;
  }
  if (menu) {
    host._dvdjsActiveMenu = menu;
    const showable = menu as HTMLElement & { show?: () => void; hidden?: boolean };
    if (typeof showable.show === 'function') {
      showable.show();
    } else {
      showable.style.display = 'flex';
      showable.hidden = false;
    }
    const hl =
      Math.floor((snap.hlBtnn != null ? snap.hlBtnn : 0x0400) / 0x0400) - 1;
    if (typeof host.setMenuHighlight === 'function') {
      host.setMenuHighlight(menu, Math.max(0, hl));
    }
    const domainAttr = menu.dataset?.domain;
    if (
      domainAttr != null &&
      domainAttr !== '' &&
      typeof host.querySelector === 'function' &&
      snap.menuVideoTime != null
    ) {
      const menuVideo = host.querySelector(
        `#menu-video-${domainAttr}`,
      ) as HTMLVideoElement | null;
      if (menuVideo) {
        try {
          menuVideo.currentTime = snap.menuVideoTime;
        } catch {
          // ignore seek failures
        }
        // Do not resume play without re-arming finishSegment — that left
        // transition cells past EOF with no onPost. Freeze the snap frame;
        // buttons / Main menu remain the escape.
        try {
          menuVideo.pause();
        } catch {
          // ignore
        }
      }
    }
  }

  host._dvdjsMenuResume = null;
  return true;
}

/** True while the sticky missing-title dialog is visible. */
export function isTitleUnavailableOpen(
  host: TitleUnavailableMountHost,
): boolean {
  try {
    const root = resolveTitleUnavailableRoot(host);
    const qs =
      typeof root.querySelector === 'function'
        ? root.querySelector.bind(root)
        : typeof host.querySelector === 'function'
          ? host.querySelector.bind(host)
          : null;
    if (!qs) {
      return false;
    }
    const el = qs('.dvd-menu-archive-title-unavailable') as HTMLElement | null;
    if (!el) {
      return false;
    }
    return !el.hidden && el.style?.display !== 'none';
  } catch {
    return false;
  }
}

/**
 * Menus-only First Play often JumpTTs through studio-logo / warning titles.
 * Auto-follow each missing title's PGC post(), but break cycles (Avatar:
 * copyright → VTS4 → VMGM PGC9 → VTS5 → PGC9 → …) by jumping to the VMGM
 * Title menu (domain 0) — not the current VTS Root, which may be a stub that
 * immediately JumpTTs back into the same missing titles.
 *
 * Returns true if the caller should return without showing the unavailable UI.
 */
export function tryAutoSkipMissingTitle(
  host: MissingTitleSkipHost,
  g: VmNavGlobals,
  fromButton: boolean,
): boolean {
  if (fromButton) {
    clearMissingTitleSkip(host);
    host._dvdjsMissingTitleBroken = false;
    return false;
  }

  // Avatar: after a language-copyright PGC sets gprm[0x0B], the next JumpTTs are
  // only studio logos / hubs. Skip them and open the translated VTS menus.
  if (uiLanguageCookie(g) && runLanguageDispatcherRoot(g)) {
    clearMissingTitleSkip(host);
    host._dvdjsMissingTitleBroken = false;
    return true;
  }

  const domain = g.domain;
  const pgc = g.pgc as number | undefined;
  const pgcObj =
    domain != null && pgc != null ? g.PGCIUT?.[domain]?.[pgc] : null;
  if (!pgcObj || typeof pgcObj.post !== 'function') {
    clearMissingTitleSkip(host);
    return false;
  }

  const key = String(domain) + ':' + String(pgc);
  let visited = host._dvdjsMissingTitleSkip;
  if (!visited) {
    visited = new Set();
    host._dvdjsMissingTitleSkip = visited;
  }

  // Already broke out once — do not follow post() back into the hub loop.
  if (host._dvdjsMissingTitleBroken || visited.has(key)) {
    host._dvdjsMissingTitleBroken = true;
    visited.add(key);
    // Language was chosen (Avatar DE/FR/NL cookie) but JumpTT hub has no titles —
    // open the translated menus instead of falling through to English Title/Root.
    if (
      !runLanguageDispatcherRoot(g) &&
      !escapeToVmgmTitleMenu(host, g)
    ) {
      showTitleUnavailableOverlay(host as TitleUnavailableMountHost, {
        onDismiss: () => {
          clearUserButtonNav(host);
          if (!runLanguageDispatcherRoot(g)) {
            escapeToVmgmTitleMenu(host, g);
          }
        },
      });
    }
    return true;
  }
  visited.add(key);

  setTimeout(() => {
    // post() looks up MENU_TYPES[domain][lang] with the *current* title
    // domain still set (Harry Potter: CallSS Root via MENU_TYPES[1][lang][3]).
    alignLangForTitlePost(g);
    try {
      pgcObj.post();
    } catch (e) {
      console.warn('dvd-menu-archive missing-title post failed', e);
      host._dvdjsMissingTitleBroken = true;
      // FP auto-skip: land on a real menu when possible. Dialog only if escape
      // cannot find one (so the user is not stuck on a black intro cell).
      if (!escapeToVmgmTitleMenu(host, g)) {
        showTitleUnavailableOverlay(host as TitleUnavailableMountHost, {
          onDismiss: () => {
            clearUserButtonNav(host);
            escapeToVmgmTitleMenu(host, g);
          },
        });
      }
    }
  }, 0);
  return true;
}

type MenuRef = { domain: number; lang: string; pgc: number };

function isRunnableMenu(
  g: VmNavGlobals,
  menu: MenuRef | null | undefined,
): boolean {
  if (!menu || !g.MPGCIUT?.[menu.domain]) {
    return false;
  }
  const pgcObj = g.MPGCIUT[menu.domain]?.[menu.lang]?.[menu.pgc];
  return !!pgcObj && typeof pgcObj.run === 'function';
}

/** Empty cell list = stub Root that often JumpTTs into missing titles (Avatar). */
function isStubMenu(
  g: VmNavGlobals,
  menu: MenuRef | null | undefined,
): boolean {
  if (!isRunnableMenu(g, menu)) {
    return true;
  }
  const pgcObj = g.MPGCIUT![menu!.domain][menu!.lang][menu!.pgc];
  return !Array.isArray(pgcObj.cells) || pgcObj.cells.length === 0;
}

function runMenu(g: VmNavGlobals, menu: MenuRef): boolean {
  if (!isRunnableMenu(g, menu)) {
    return false;
  }
  g.domain = menu.domain;
  g.lang = menu.lang;
  g.MPGCIUT![menu.domain][menu.lang][menu.pgc].run();
  return true;
}


/** Avatar-style UI language cookie in gprm[0x0B] (0 = English / unset). */
function uiLanguageCookie(g: VmNavGlobals): number {
  const v = g.gprm && g.gprm[0x0b];
  return typeof v === 'number' ? v : 0;
}

/**
 * VTS Root whose pre() linkPGCs by language cookie (Avatar VTS1). Empty cells
 * but not a JumpTT stub (Avatar VTS5).
 */
export function runLanguageDispatcherRoot(g: VmNavGlobals): boolean {
  const types = g.MENU_TYPES as
    | Array<Record<string, Array<MenuRef | undefined>> | undefined>
    | undefined;
  if (!types || !uiLanguageCookie(g)) {
    return false;
  }
  for (let d = 0; d < types.length; d++) {
    if (!types[d]) continue;
    const prefer = pickMenuLang(g, d);
    for (const lang of [
      prefer,
      ...menuLangKeys(types[d]).filter((k) => k !== prefer),
    ]) {
      const root = types[d]![lang]?.[3 /* Root */];
      if (!isRunnableMenu(g, root)) continue;
      const pgcObj = g.MPGCIUT![root!.domain][root!.lang][root!.pgc];
      const src =
        typeof pgcObj.pre === 'function'
          ? Function.prototype.toString.call(pgcObj.pre)
          : '';
      if (!/linkPGC\s*\(/.test(src) || /VTT_TABLE|PTT_TABLE/.test(src)) {
        continue;
      }
      if (runMenu(g, root!)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * After a language-copyright PGC post sets gprm[0x0B] and schedules a JumpTT
 * hub (PGC9 / Angle) on `g.t`, open the translated menus instead. Clears the
 * hub timer only when the dispatcher replaced it via linkPGC — never clear
 * `g.t` afterward (that would cancel the language menu).
 */
export function afterLanguageCopyrightPost(
  g: VmNavGlobals & { t?: ReturnType<typeof setTimeout> | null },
): boolean {
  const hubTimer = g.t;
  if (!runLanguageDispatcherRoot(g)) {
    return false;
  }
  if (hubTimer != null && hubTimer !== g.t) {
    try {
      clearTimeout(hubTimer);
    } catch {
      // ignore
    }
  }
  return true;
}

/**
 * Escape missing-title / stuck-nav into a real menu.
 *
 * Prefer VMGM Title so we do not re-enter a VTS Root stub (Avatar domain 5
 * Root → PGC9). If the disc has no VMGM Title (Harry Potter: MENU_TYPES[0] is
 * empty/`ÿÿ`), fall back to a non-stub VTS Root — never leave menus hidden.
 */
export function escapeToVmgmTitleMenu(
  host: MissingTitleSkipHost,
  g: VmNavGlobals = typeof window !== 'undefined' ? (window as any) : {},
): boolean {
  try {
    const types = g.MENU_TYPES as
      | Array<Record<string, Array<MenuRef | undefined>> | undefined>
      | undefined;

    // 1. VMGM Title (best escape from VTS missing-title loops).
    if (types?.[0]) {
      const prefer = pickMenuLang(g, 0);
      for (const lang of [
        prefer,
        ...menuLangKeys(types[0]).filter((k) => k !== prefer),
      ]) {
        const title = types[0][lang]?.[2 /* Title */];
        if (title && runMenu(g, title)) {
          return true;
        }
      }
    }

    // 2. Non-stub Root in any domain (HP menus live in VTS1 Root only).
    if (types) {
      for (let d = 0; d < types.length; d++) {
        if (!types[d]) continue;
        const prefer = pickMenuLang(g, d);
        for (const lang of [
          prefer,
          ...menuLangKeys(types[d]).filter((k) => k !== prefer),
        ]) {
          const root = types[d]![lang]?.[3 /* Root */];
          if (root && !isStubMenu(g, root) && runMenu(g, root)) {
            return true;
          }
        }
      }
    }

    // 3. Any other Title menu.
    if (types) {
      for (let d = 0; d < types.length; d++) {
        if (!types[d]) continue;
        for (const lang of menuLangKeys(types[d])) {
          const title = types[d]![lang]?.[2 /* Title */];
          if (title && runMenu(g, title)) {
            return true;
          }
        }
      }
    }

    // Do NOT force domain=0 before onmenu — HP has no VMGM menus; domain 0
    // would make onmenu look at an empty MENU_TYPES[0] and leave UI dead.
    if (typeof host.onmenu === 'function') {
      host.onmenu({});
      return true;
    }
  } catch (e) {
    console.warn('dvd-menu-archive missing-title menu fallback failed', e);
  }
  return false;
}

export function clearMissingTitleSkip(host: MissingTitleSkipHost): void {
  if (host._dvdjsMissingTitleSkip) {
    host._dvdjsMissingTitleSkip.clear();
  }
}

/**
 * Prefer the fullscreen player stage so the dialog covers letterboxing;
 * fall back to the x-video host.
 */
export function resolveTitleUnavailableRoot(
  host: TitleUnavailableMountHost,
): TitleUnavailableMountHost {
  const closest =
    typeof host.closest === 'function' ? host.closest.bind(host) : null;
  const stage = closest?.('.player-stage');
  if (stage && typeof (stage as Element).querySelector === 'function') {
    return stage as TitleUnavailableMountHost;
  }
  try {
    if (
      host.style &&
      typeof getComputedStyle === 'function' &&
      host instanceof HTMLElement &&
      getComputedStyle(host).position === 'static'
    ) {
      host.style.position = 'relative';
    }
  } catch {
    // ignore (non-DOM test hosts)
  }
  return host;
}

function unbindTitleUnavailableKeys(host: TitleUnavailableMountHost): void {
  const handler = host._dvdjsTitleUnavailableKeyHandler;
  if (handler && typeof document !== 'undefined') {
    document.removeEventListener('keydown', handler, true);
    host._dvdjsTitleUnavailableKeyHandler = null;
  }
}

/**
 * Sticky dialog for menu-button JumpTT into a missing title.
 * Stays until dismiss (OK click / Enter / Space / Escape); does not auto-call onmenu.
 */
export function showTitleUnavailableOverlay(
  host: TitleUnavailableMountHost,
  opts: {
    message?: string;
    onDismiss?: TitleUnavailableDismiss;
  } = {},
): void {
  const root = resolveTitleUnavailableRoot(host);

  unbindTitleUnavailableKeys(host);

  let el = root.querySelector(
    '.dvd-menu-archive-title-unavailable',
  ) as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'dvd-menu-archive-title-unavailable';
    if (typeof root.appendChild === 'function') {
      root.appendChild(el);
    } else if (host instanceof HTMLElement) {
      host.appendChild(el);
    }
  }

  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'dvd-menu-archive-title-unavailable-heading');
  el.innerHTML =
    '<div class="dvd-menu-archive-title-unavailable__card">' +
    '<p class="dvd-menu-archive-title-unavailable__heading" id="dvd-menu-archive-title-unavailable-heading"></p>' +
    '<p class="dvd-menu-archive-title-unavailable__body"></p>' +
    '<button type="button" class="dvd-menu-archive-title-unavailable__btn"></button>' +
    '</div>';

  const heading = el.querySelector(
    '.dvd-menu-archive-title-unavailable__heading',
  ) as HTMLElement;
  const body = el.querySelector(
    '.dvd-menu-archive-title-unavailable__body',
  ) as HTMLElement;
  const btn = el.querySelector(
    '.dvd-menu-archive-title-unavailable__btn',
  ) as HTMLButtonElement;

  heading.textContent = TITLE_UNAVAILABLE_HEADING;
  body.textContent = opts.message || TITLE_UNAVAILABLE_MESSAGE;
  btn.textContent = TITLE_UNAVAILABLE_OK_LABEL;

  const dismiss = () => {
    hideTitleUnavailableOverlay(host);
    try {
      opts.onDismiss?.();
    } catch (e) {
      console.warn('dvd-menu-archive title-unavailable dismiss failed', e);
    }
  };

  host._dvdjsTitleUnavailableDismiss = dismiss;
  btn.addEventListener('click', dismiss);

  const onKey = (ev: KeyboardEvent) => {
    const key = ev.key;
    const code = ev.code;
    const isDismiss =
      key === 'Escape' ||
      key === 'Enter' ||
      code === 'Enter' ||
      key === ' ' ||
      code === 'Space';
    if (!isDismiss) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    dismiss();
  };
  host._dvdjsTitleUnavailableKeyHandler = onKey;
  document.addEventListener('keydown', onKey, true);

  el.hidden = false;
  el.style.display = 'flex';
  try {
    btn.focus({ preventScroll: true });
  } catch {
    // ignore
  }
}

export function hideTitleUnavailableOverlay(
  host: TitleUnavailableMountHost,
): void {
  unbindTitleUnavailableKeys(host);
  host._dvdjsTitleUnavailableDismiss = null;

  const root = resolveTitleUnavailableRoot(host);
  const el =
    (root.querySelector('.dvd-menu-archive-title-unavailable') as HTMLElement | null) ||
    (host.querySelector('.dvd-menu-archive-title-unavailable') as HTMLElement | null);
  if (el) {
    el.hidden = true;
    el.style.display = 'none';
  }
}

/**
 * After a motion segment ends: hold forever only for infinite still (255).
 * Buttons alone must not suppress onPost — looping menus (e.g. Harry Potter
 * main menu cell 2) use still_time 0 + a cell command / PGC post to replay.
 */
export function shouldHoldAfterMenuMotion(stillTime: number): boolean {
  return stillTime === 255;
}

/**
 * Language copyright / FBI warnings: short MPEG cell + still_time ≥ 3, no buttons.
 * Show as a held PNG (not a sub-second motion flash). still_time 1–2 (Avatar FP
 * black pad) stays on the motion path.
 */
export function menuCellPrefersStillOnly(opts: {
  still_time?: number;
  startSec?: number;
  endSec?: number;
  buttons?: unknown[];
}): boolean {
  const stillTime = opts.still_time != null ? opts.still_time : 0;
  if (!(stillTime >= 3 && stillTime < 255)) {
    return false;
  }
  if (opts.buttons && opts.buttons.length) {
    return false;
  }
  const start = opts.startSec != null ? opts.startSec : 0;
  const end = opts.endSec != null ? opts.endSec : start;
  const duration = end - start;
  return duration > 0 && duration <= 1.5;
}

/**
 * After a motion cell ends, DVD still_time holds the last frame before post().
 * 0 = advance now; 255 = infinite (never call post from here).
 */
export function scheduleMenuPostAfterStill(
  host: {
    _dvdjsStillTimer?: ReturnType<typeof setTimeout> | null;
    _dvdjsMenuPost?: (() => void) | null;
  },
  stillTime: number,
  post: (() => void) | null | undefined,
): void {
  if (stillTime === 255) {
    // Infinite still — keep last frame; caller must not advance the PGC.
    return;
  }
  if (typeof post !== 'function') {
    return;
  }
  if (host._dvdjsStillTimer) {
    clearTimeout(host._dvdjsStillTimer);
    host._dvdjsStillTimer = null;
  }
  host._dvdjsMenuPost = post;
  if (stillTime > 0 && stillTime < 255) {
    host._dvdjsStillTimer = setTimeout(() => {
      host._dvdjsStillTimer = null;
      const fn = host._dvdjsMenuPost;
      host._dvdjsMenuPost = null;
      if (fn) {
        try {
          fn();
        } catch (e) {
          console.warn('dvd-menu-archive menu post failed', e);
        }
      }
    }, stillTime * 1000);
    return;
  }
  host._dvdjsMenuPost = null;
  try {
    post();
  } catch (e) {
    console.warn('dvd-menu-archive menu post failed', e);
  }
}
