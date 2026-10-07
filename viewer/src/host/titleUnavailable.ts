/** User-facing copy when title WebMs were omitted (menu-only archive). */
export const TITLE_UNAVAILABLE_MESSAGE =
  'This title was intentionally left out of this archive. Only menus were converted.';

export const TITLE_UNAVAILABLE_HEADING = 'Title not included';

export const TITLE_UNAVAILABLE_OK_LABEL = 'OK';

type TitleUnavailableDismiss = () => void;

/** VM + menu UI snapshot so dismiss / undo / crash recovery can restore. */
export type MenuResumeSnapshot = {
  domain?: number;
  pgc?: number;
  lang?: string;
  pgcSpace?: string;
  cellN?: number;
  pgN?: number;
  hlBtnn?: number;
  /** Full GPRM bank (16). */
  gprm?: number[];
  gprm_mode?: number[];
  /** Full SPRM map (named keys). */
  sprm?: Record<string, number>;
  rsm_cell?: number;
  rsm_vtsN?: number;
  rsm_pgcN?: number;
  rsm_regs?: number[];
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

import {
  bridgeMenuLangBuckets,
  domainMenuLangs,
  menuLangKeys,
  pickMenuLang,
} from './menuLanguage.js';
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

/** Langs to try when title post() CallSS/JumpSS hits a missing LU bucket. */
export function titlePostLangCandidates(g: VmNavGlobals): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (code?: string | null) => {
    if (!code || seen.has(code)) {
      return;
    }
    seen.add(code);
    out.push(code);
  };

  const titleDomain = typeof g.domain === 'number' ? g.domain : 0;
  // Title-domain first (Harry Potter CallSS VTSM Root).
  add(pickMenuLang(g, titleDomain));
  // Then VMGM (Thief Lord CallSS VMGM PGC while lang is still a VTS code).
  add(pickMenuLang(g, 0));
  add(g.lang);

  const domainIndexes = new Set<number>([titleDomain, 0]);
  if (Array.isArray(g.MPGCIUT)) {
    for (let d = 0; d < g.MPGCIUT.length; d++) {
      domainIndexes.add(d);
    }
  } else if (g.MPGCIUT && typeof g.MPGCIUT === 'object') {
    for (const key of Object.keys(g.MPGCIUT)) {
      const d = Number(key);
      if (Number.isFinite(d)) {
        domainIndexes.add(d);
      }
    }
  }
  for (const d of domainIndexes) {
    for (const lang of domainMenuLangs(g, d)) {
      add(lang);
    }
  }
  return out;
}

/** Missing `MPGCIUT`/`MENU_TYPES` LU buckets throw TypeError (realm-safe check). */
export function isMenuLangLookupError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') {
    return false;
  }
  const name = String((err as { name?: unknown }).name || '');
  const msg = String((err as { message?: unknown }).message || err);
  const isType =
    name === 'TypeError' ||
    Object.prototype.toString.call(err) === '[object TypeError]' ||
    (typeof TypeError !== 'undefined' && err instanceof TypeError);
  if (!isType) {
    return false;
  }
  // Firefox: "can't access property 3, MPGCIUT[0][lang] is undefined"
  // Chromium: "Cannot read properties of undefined (reading '3')"
  return (
    /MPGCIUT|MENU_TYPES/i.test(msg) ||
    /can't access property|Cannot read propert/i.test(msg)
  );
}

/**
 * Run title PGC post() (or onPost), retrying across menu language units when
 * generated vm.js does `MPGCIUT[0][lang][…]` / `MENU_TYPES[…][lang][…]` and the
 * active lang is missing from that domain. Covers existing archives without
 * reconvert (The Thief Lord: VMGM `default` vs VTS `en`/`nl`/`de`).
 *
 * Returns true when post() completed without throwing.
 */
export function runTitlePgcPostWithLangFallback(
  g: VmNavGlobals,
  post: () => unknown,
): boolean {
  bridgeMenuLangBuckets(g);
  const candidates = titlePostLangCandidates(g);
  if (!candidates.length) {
    alignLangForTitlePost(g);
    try {
      post();
      return true;
    } catch (e) {
      console.warn('dvd-menu-archive title post failed', e);
      return false;
    }
  }

  let lastErr: unknown;
  for (const lang of candidates) {
    g.lang = lang;
    try {
      post();
      return true;
    } catch (e) {
      lastErr = e;
      // Missing LU buckets are TypeErrors; other failures are not lang-fixable.
      if (!isMenuLangLookupError(e)) {
        console.warn('dvd-menu-archive title post failed', e);
        return false;
      }
    }
  }
  if (lastErr != null) {
    console.warn('dvd-menu-archive title post failed', lastErr);
  }
  return false;
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
  g: VmCaptureGlobals = typeof window !== 'undefined' ? (window as any) : {},
): void {
  host._dvdjsFromButton = true;
  captureMenuResumeState(host, g);
}

type VmCaptureGlobals = VmNavGlobals & {
  pgcSpace?: string;
  cellN?: number;
  pgN?: number;
  gprm_mode?: number[];
  sprm?: Record<string, number>;
  rsm_cell?: number;
  rsm_vtsN?: number;
  rsm_pgcN?: number;
  rsm_regs?: number[];
  t?: ReturnType<typeof setTimeout> | null;
  stillTimer?: ReturnType<typeof setTimeout> | null;
};

function cloneNumberArray(src: unknown, len?: number): number[] | undefined {
  if (!Array.isArray(src)) {
    return undefined;
  }
  const out = src.map((v) => (typeof v === 'number' ? v : 0));
  if (len != null && out.length < len) {
    while (out.length < len) {
      out.push(0);
    }
  }
  return out;
}

function cloneSprm(src: unknown): Record<string, number> | undefined {
  if (!src || typeof src !== 'object') {
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    if (typeof v === 'number') {
      out[k] = v;
    }
  }
  return out;
}

/** Build a deep-enough VM/menu snapshot (does not attach to host). */
export function buildMenuResumeSnapshot(
  host: MissingTitleSkipHost,
  g: VmCaptureGlobals = typeof window !== 'undefined' ? (window as any) : {},
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
  return {
    domain: g.domain,
    pgc: g.pgc,
    lang: g.lang,
    pgcSpace: g.pgcSpace,
    cellN: g.cellN,
    pgN: g.pgN,
    hlBtnn: g.sprm?.HL_BTNN,
    gprm: cloneNumberArray(g.gprm, 16),
    gprm_mode: cloneNumberArray(g.gprm_mode, 16),
    sprm: cloneSprm(g.sprm),
    rsm_cell: typeof g.rsm_cell === 'number' ? g.rsm_cell : undefined,
    rsm_vtsN: typeof g.rsm_vtsN === 'number' ? g.rsm_vtsN : undefined,
    rsm_pgcN: typeof g.rsm_pgcN === 'number' ? g.rsm_pgcN : undefined,
    rsm_regs: cloneNumberArray(g.rsm_regs),
    menuId: menu?.id ?? null,
    menuVideoTime,
    menuVideoPaused,
  };
}

export function captureMenuResumeState(
  host: MissingTitleSkipHost,
  g: VmCaptureGlobals = typeof window !== 'undefined' ? (window as any) : {},
): MenuResumeSnapshot {
  const snap = buildMenuResumeSnapshot(host, g);
  host._dvdjsMenuResume = snap;
  return snap;
}

/** Cancel VM setTimeout handlers used by generated vm.js. */
export function cancelVmNavTimers(
  g: { t?: ReturnType<typeof setTimeout> | null; stillTimer?: ReturnType<typeof setTimeout> | null } = typeof window !== 'undefined'
    ? (window as any)
    : {},
): void {
  if (g.t != null) {
    try {
      clearTimeout(g.t);
    } catch {
      // ignore
    }
    g.t = null;
  }
  if (g.stillTimer != null) {
    try {
      clearTimeout(g.stillTimer);
    } catch {
      // ignore
    }
    g.stillTimer = null;
  }
}

export type ApplyMenuResumeOptions = {
  /**
   * Rebuild still/WebM/buttons via generated `playCurrentMenuCell` /
   * `playCurrentTitleCell` (multi-cell PGCs share one `x-menu` — show+seek
   * alone leaves the destination cell’s media and hitboxes). Default false
   * for missing-title dismiss when the menu under the dialog was never left;
   * undo / crash restore pass true.
   */
  replayPresentation?: boolean;
};

type VmReplayGlobals = VmCaptureGlobals & {
  playCurrentMenuCell?: () => void;
  playCurrentTitleCell?: () => void;
};

/**
 * Re-run the cell presentation for the restored VM position.
 * Returns true when a play helper was invoked.
 */
export function replayNavPresentation(
  host: MissingTitleSkipHost,
  snap: MenuResumeSnapshot,
  g: VmReplayGlobals = typeof window !== 'undefined' ? (window as any) : {},
): boolean {
  const space = snap.pgcSpace ?? g.pgcSpace;
  try {
    if (space === 'title') {
      if (typeof g.playCurrentTitleCell === 'function') {
        g.playCurrentTitleCell();
        return true;
      }
      // Patched playCurrentMenuCell dispatches to title when pgcSpace is title.
      if (typeof g.playCurrentMenuCell === 'function') {
        g.pgcSpace = 'title';
        g.playCurrentMenuCell();
        return true;
      }
      const dvd = host as MissingTitleSkipHost & {
        playTitleCell?: (opts: Record<string, unknown>) => void;
        playTitlePgc?: (domain: number, pgc: number) => void;
        playByID?: (id: string) => void;
      };
      if (
        typeof dvd.playTitlePgc === 'function' &&
        snap.domain != null &&
        snap.pgc != null
      ) {
        dvd.playTitlePgc(snap.domain, snap.pgc);
        return true;
      }
      if (typeof dvd.playByID === 'function' && snap.domain != null) {
        dvd.playByID(`video-${snap.domain}`);
        return true;
      }
      return false;
    }

    if (typeof g.playCurrentMenuCell === 'function') {
      g.pgcSpace = 'menu';
      g.playCurrentMenuCell();
      return true;
    }
    return false;
  } catch (e) {
    console.warn('dvd-menu-archive replay after resume failed', e);
    return false;
  }
}

/** Re-apply SPRM highlight + CSS/SPU selected state for the restored button. */
export function applyRestoredMenuHighlight(
  host: MissingTitleSkipHost,
  snap: MenuResumeSnapshot,
  g: VmCaptureGlobals = typeof window !== 'undefined' ? (window as any) : {},
): void {
  const hlBtnn =
    snap.hlBtnn != null
      ? snap.hlBtnn
      : typeof g.sprm?.HL_BTNN === 'number'
        ? g.sprm.HL_BTNN
        : 0x0400;
  if (!g.sprm || typeof g.sprm !== 'object') {
    g.sprm = {};
  }
  g.sprm.HL_BTNN = hlBtnn;
  const menu = host._dvdjsActiveMenu || null;
  if (!menu || typeof host.setMenuHighlight !== 'function') {
    return;
  }
  const idx = Math.max(0, Math.floor(hlBtnn / 0x0400) - 1);
  host.setMenuHighlight(menu, idx);
}

/** Soft UI when generated play helpers are unavailable (tests / legacy). */
function applyMenuResumeSoftUi(
  host: MissingTitleSkipHost,
  snap: MenuResumeSnapshot,
  g: VmCaptureGlobals,
): void {
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
  if (!menu) {
    return;
  }
  host._dvdjsActiveMenu = menu;
  const showable = menu as HTMLElement & { show?: () => void; hidden?: boolean };
  if (typeof showable.show === 'function') {
    showable.show();
  } else {
    showable.style.display = 'flex';
    showable.hidden = false;
  }
  applyRestoredMenuHighlight(host, snap, g);
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

/**
 * Apply a snapshot to VM globals + visible menu/highlight.
 * Does not clear host._dvdjsMenuResume (caller decides).
 */
export function applyMenuResumeSnapshot(
  host: MissingTitleSkipHost,
  snap: MenuResumeSnapshot,
  g: VmCaptureGlobals = typeof window !== 'undefined' ? (window as any) : {},
  opts: ApplyMenuResumeOptions = {},
): boolean {
  cancelVmNavTimers(g);

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
  if (snap.pgN != null) {
    g.pgN = snap.pgN;
  } else if (snap.cellN != null) {
    g.pgN = snap.cellN;
  }

  if (snap.gprm && Array.isArray(g.gprm)) {
    for (let i = 0; i < 16; i++) {
      g.gprm[i] = snap.gprm[i] ?? 0;
    }
  }
  if (snap.gprm_mode && Array.isArray(g.gprm_mode)) {
    for (let i = 0; i < 16; i++) {
      g.gprm_mode[i] = snap.gprm_mode[i] ?? 0;
    }
  }
  if (snap.sprm) {
    if (!g.sprm || typeof g.sprm !== 'object') {
      g.sprm = {};
    }
    for (const [k, v] of Object.entries(snap.sprm)) {
      g.sprm[k] = v;
    }
  }
  // Authoritative highlight: always prefer snap.hlBtnn so a partial sprm
  // clone cannot leave the destination page's HL_BTNN in place.
  if (snap.hlBtnn != null) {
    if (!g.sprm || typeof g.sprm !== 'object') {
      g.sprm = {};
    }
    g.sprm.HL_BTNN = snap.hlBtnn;
  }

  if (snap.rsm_cell != null) {
    g.rsm_cell = snap.rsm_cell;
  }
  if (snap.rsm_vtsN != null) {
    g.rsm_vtsN = snap.rsm_vtsN;
  }
  if (snap.rsm_pgcN != null) {
    g.rsm_pgcN = snap.rsm_pgcN;
  }
  if (snap.rsm_regs) {
    g.rsm_regs = snap.rsm_regs.slice();
  }

  if (opts.replayPresentation) {
    if (replayNavPresentation(host, snap, g as VmReplayGlobals)) {
      // playMenuCell enableButtons reads HL_BTNN at entry; re-stamp after
      // rebuild so the prior page’s selected button (e.g. “Next”) is visible
      // even when soft UI was skipped.
      applyRestoredMenuHighlight(host, snap, g);
      return true;
    }
  }

  applyMenuResumeSoftUi(host, snap, g);
  return true;
}

/**
 * Restore VM globals + visible menu/highlight after a missing-title JumpTT.
 * Returns true when a snapshot was applied.
 */
export function restoreMenuResumeState(
  host: MissingTitleSkipHost,
  g: VmCaptureGlobals = typeof window !== 'undefined' ? (window as any) : {},
): boolean {
  const snap = host._dvdjsMenuResume;
  if (!snap) {
    return false;
  }
  applyMenuResumeSnapshot(host, snap, g);
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
    // post() may CallSS VTSM (Harry Potter MENU_TYPES[1][lang]) or VMGM
    // (Thief Lord MPGCIUT[0][lang]) — retry across LUs when buckets disagree.
    if (!runTitlePgcPostWithLangFallback(g, () => pgcObj.post())) {
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
  bridgeMenuLangBuckets(g);
  const pgcObj = g.MPGCIUT![menu.domain][menu.lang][menu.pgc];
  g.domain = menu.domain;
  const candidates = [
    menu.lang,
    ...titlePostLangCandidates({ ...g, lang: menu.lang }),
  ].filter((lang, i, arr) => lang && arr.indexOf(lang) === i);

  for (const lang of candidates) {
    g.lang = lang;
    try {
      pgcObj.run();
      return true;
    } catch (e) {
      if (!isMenuLangLookupError(e)) {
        console.warn('dvd-menu-archive menu run failed', e);
        return false;
      }
    }
  }
  return false;
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
    bridgeMenuLangBuckets(g);
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
