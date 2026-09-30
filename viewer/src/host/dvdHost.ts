import {
  beginUserButtonNav as latchUserButtonNav,
  clearMissingTitleSkip,
  clearUserButtonNav,
  hideTitleUnavailableOverlay,
  restoreMenuResumeState,
  afterLanguageCopyrightPost,
  menuCellPrefersStillOnly,
  scheduleMenuPostAfterStill,
  shouldHoldAfterMenuMotion,
  showTitleUnavailableOverlay,
  tryAutoSkipMissingTitle,
} from './titleUnavailable.js';
import {
  ensureTitleStubMenu,
  getTitleStub,
  playSkipTitleStub,
  type TitlePgcMediaWithStubs,
} from './titleStubs.js';
import {
  silenceVideoAudio,
  notifyAutoplayBlocked,
  playWithAutoplayFallback,
  type AutoplayHost,
} from './autoplay.js';
import {
  applyDebugHitboxLabels,
  bindMenuKeys,
} from './menuKeys.js';
import { goToMainMenu as jumpToMainMenu } from './goToMainMenu.js';
import { setDiscMenuLanguage } from './menuLanguage.js';
import {
  freezeMenuVideoAtEnd,
  imageHasPixels,
  motionSegmentFinishAt,
  preloadImageUrl,
  preloadLinkedMenuAssets,
  setMenuVideoSeekCover,
  stillCoverUrlFromMenu,
  whenImageReady,
} from './menuPreload.js';
import {
  captureMenuHoldFrame,
  captureMenuHoldFromStage,
  hideMenuHoldFrame,
  menuHoldFrameVisible,
  showMenuHoldFrame,
} from './menuHoldFrame.js';
import { skipPlaybackToEnd } from './skipToEnd.js';
import {
  applyMenuButtonGeometry,
  stampHitboxStylesFromStylesheet,
} from './menuButtonHitboxes.js';

export type MenuCellPlayOpts = {
  menuId?: string;
  domain?: number | string;
  cellID?: number | string;
  vobID?: number | string;
  still_time?: number;
  hli_s_ptm?: number;
  startSec?: number;
  endSec?: number;
  buttons?: Array<{
    up?: number;
    down?: number;
    left?: number;
    right?: number;
    auto_action_mode?: number;
    /** Hitbox geometry CSS decls from convert (`left/top/width/height`). */
    css?: string;
  }>;
  spuSelect?: string[];
  spuActivate?: string[];
  onPost?: () => void;
};

type TitlePgcMedia = TitlePgcMediaWithStubs;

type PlaylistEntry = {
  id: string;
  video: HTMLVideoElement;
  src: string;
  chapterCues: TextTrackCue[];
  titlePgcMedia: TitlePgcMedia | null;
};

export type XVideoElement = HTMLElement & {
  playlist: PlaylistEntry[];
  videoIndex: number;
  onmenu: ((event: object) => void) | null;
  play: () => Promise<void> | void;
  pause: () => void;
  playByID: (elementID: string) => void;
  playByIndex: (videoIndex: number) => void;
  playChapter: (chapterIndex: number) => void;
  playMenuByID: (elementID: string) => void;
  playMenuCell: (opts: MenuCellPlayOpts) => void;
  /** Jump to the end of the active menu/title clip (N / toolbar). */
  skipToEnd: () => boolean;
  /** Escape stuck menus via title/root onmenu (M / toolbar). */
  goToMainMenu: () => boolean;
  /** Switch menu language unit and jump to main menu. */
  setMenuLanguage: (lang: string) => boolean;
  /**
   * Pre-check before JumpTT / JumpVTS_* — if the title WebM is missing (or this
   * PGC was not included in a short-cell menus rip) and the jump came from a
   * menu button, show the dialog without leaving the menu.
   * Stubbed PGCs (skip / interactive) always proceed so playTitlePgc can run.
   * @returns false when the jump must be aborted.
   */
  guardTitleJump: (elementID: string, pgc?: number) => boolean;
  /** Play a title PGC: WebM, interactive stub, or silent skip stub. */
  playTitlePgc: (domain: number, pgc: number) => void;
  /** Play one title cell/program (LinkPGN inside title domain). */
  playTitleCell: (opts: {
    domain: number;
    pgc: number;
    cellN?: number;
    cellID?: number;
    vobID?: number;
    still_time?: number;
    startSec?: number;
    endSec?: number;
    onPost?: () => void;
  }) => void;
  /** Latch button nav + snapshot menu/VM for missing-title restore. */
  beginUserButtonNav: () => void;
  setMenuHighlight: (menu: Element | null, buttonIndex: number) => void;
  flashMenuActivate: (menu: Element | null, buttonIndex: number) => void;
  setDebugHitboxes: (enabled: boolean) => void;
};

function hideAllMenu(host: HTMLElement) {
  host.querySelectorAll('x-menu').forEach((menu) => {
    const m = menu as HTMLElement & { hide?: () => void };
    if (typeof m.hide === 'function') {
      m.hide();
    } else {
      m.style.display = 'none';
      m.hidden = true;
    }
  });
}

function showTitleUnavailable(host: XVideoElement, message?: string) {
  // Do not clear _dvdjsFromButton here — JumpVTS_TT calls playByID then
  // playChapter, and JumpSS defers JumpTT via setTimeout. The latch stays
  // until playMenuCell / goToMainMenu / dismiss restores a real menu.
  const fromButton = !!(host as any)._dvdjsFromButton;

  // User picked a missing title — leave the current menu under the dialog and
  // restore exact VM/UI state on OK (as if the JumpTT never left).
  if (fromButton) {
    showTitleUnavailableOverlay(host, {
      message,
      onDismiss: () => {
        restoreMenuResumeState(host as any, window as any);
        clearUserButtonNav(host as any);
      },
    });
    return;
  }

  hideAllMenu(host);
  try {
    host.pause();
  } catch {
    // ignore
  }

  // Menus-only / FP: missing studio-logo titles should continue via PGC post
  // (e.g. LOTR → VMGM intro). Cycle-detect so Avatar-style PGC9 ↔ missing-title
  // loops fall back to onmenu.
  if (
    tryAutoSkipMissingTitle(host as any, window as any, fromButton)
  ) {
    hideTitleUnavailableOverlay(host);
    return;
  }

  // Non-button with no auto-skip path: return to menu without a sticky dialog.
  hideTitleUnavailableOverlay(host);
  if (typeof host.onmenu === 'function' && !(host as any)._dvdjsMenuFallback) {
    (host as any)._dvdjsMenuFallback = true;
    setTimeout(() => {
      try {
        host.onmenu?.({});
      } catch (e) {
        console.warn('DVD.js menu fallback failed', e);
      } finally {
        (host as any)._dvdjsMenuFallback = false;
      }
    }, 0);
  }
}

function isTitleMediaMissing(
  entry: PlaylistEntry | undefined,
  pgc?: number,
) {
  if (!entry) {
    return true;
  }
  const src =
    entry.src ||
    entry.video.currentSrc ||
    entry.video.getAttribute('src') ||
    '';
  if (!src) {
    return true;
  }
  const media = entry.titlePgcMedia;
  if (
    media &&
    Array.isArray(media.includedPgcs) &&
    media.includedPgcs.length > 0 &&
    pgc != null &&
    Number.isFinite(pgc)
  ) {
    return media.includedPgcs.indexOf(Number(pgc)) < 0;
  }
  return false;
}

function parseTitlePgcMediaAttr(video: HTMLVideoElement): TitlePgcMedia | null {
  const raw = video.getAttribute('data-title-pgc-media');
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as TitlePgcMedia;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearDvdjsTimers(host: any) {
  if (host._dvdjsStillTimer) {
    clearTimeout(host._dvdjsStillTimer);
    host._dvdjsStillTimer = null;
  }
  if (host._dvdjsHighlightTimer) {
    clearTimeout(host._dvdjsHighlightTimer);
    host._dvdjsHighlightTimer = null;
  }
  if (host._dvdjsMotionWatchdog) {
    clearTimeout(host._dvdjsMotionWatchdog);
    host._dvdjsMotionWatchdog = null;
  }
  if (host._dvdjsRevealRetryTimer) {
    clearTimeout(host._dvdjsRevealRetryTimer);
    host._dvdjsRevealRetryTimer = null;
  }
  if (host._dvdjsMotionRaf) {
    cancelAnimationFrame(host._dvdjsMotionRaf);
    host._dvdjsMotionRaf = null;
  }
}

/** Drop in-flight seek/meta/finish handlers without running onPost. Keep pixels. */
function cancelActiveMenuMotion(host: any) {
  clearDvdjsTimers(host);
  const video = (host._dvdjsMenuMotionVideo || null) as HTMLVideoElement | null;
  if (video) {
    if (host._dvdjsMenuSeeked) {
      video.removeEventListener('seeked', host._dvdjsMenuSeeked);
      host._dvdjsMenuSeeked = null;
    }
    if (host._dvdjsMenuLoadedMeta) {
      video.removeEventListener('loadedmetadata', host._dvdjsMenuLoadedMeta);
      host._dvdjsMenuLoadedMeta = null;
    }
    if (host._dvdjsMenuTimeUpdate) {
      video.removeEventListener('timeupdate', host._dvdjsMenuTimeUpdate);
      host._dvdjsMenuTimeUpdate = null;
    }
    if (host._dvdjsMenuEnded) {
      video.removeEventListener('ended', host._dvdjsMenuEnded);
      host._dvdjsMenuEnded = null;
    }
    if (host._dvdjsMenuRevealTimeUpdate) {
      video.removeEventListener('timeupdate', host._dvdjsMenuRevealTimeUpdate);
      host._dvdjsMenuRevealTimeUpdate = null;
    }
  } else {
    host._dvdjsMenuSeeked = null;
    host._dvdjsMenuLoadedMeta = null;
    host._dvdjsMenuTimeUpdate = null;
    host._dvdjsMenuEnded = null;
    host._dvdjsMenuRevealTimeUpdate = null;
  }
  host._dvdjsFinishMenuSegment = null;
  host._dvdjsMenuSegmentEnd = null;
  host._dvdjsMenuMotionVideo = null;
}

function bumpMenuPlayGen(host: any): number {
  host._dvdjsMenuPlayGen = (host._dvdjsMenuPlayGen || 0) + 1;
  return host._dvdjsMenuPlayGen as number;
}

function notePaintedStill(host: any, img: HTMLImageElement | null | undefined) {
  if (imageHasPixels(img)) {
    const src = img!.getAttribute('src');
    if (src) {
      host._dvdjsLastPaintedStillSrc = src;
    }
  }
}

/** True when the menu WebM is painted (usable as a hold-frame cover). */
function menuVideoShowsFrame(
  menuVideo: HTMLVideoElement | null | undefined,
): boolean {
  if (!menuVideo || menuVideo.hidden) {
    return false;
  }
  if (menuVideo.style.opacity === '0') {
    return false;
  }
  // HAVE_CURRENT_DATA or better — a decoded frame is available to paint.
  return menuVideo.readyState >= 2;
}

/** Hide every menu WebM except the active one once the new layer covers it. */
function hideOtherMenuVideos(
  host: ParentNode,
  active: HTMLVideoElement | null,
) {
  host.querySelectorAll('video.dvdjs-menu-video').forEach((node) => {
    const video = node as HTMLVideoElement;
    if (video === active) {
      return;
    }
    try {
      video.pause();
    } catch {
      // ignore
    }
    video.hidden = true;
    video.style.cssText = '';
    video.style.opacity = '';
  });
}

/**
 * Paint a still as seek/black cover. Only call when the menu video is NOT
 * showing a usable frame — otherwise the previous cell's cached PNG flashes
 * on top of a good freeze/transition end frame.
 */
function ensureStillCoverVisible(
  menu: Element | null,
  coverSrc: string | null,
  host: any,
) {
  if (!menu || !coverSrc) {
    return;
  }
  let still = menu.querySelector('img.menu-still') as HTMLImageElement | null;
  if (!still) {
    still = document.createElement('img');
    still.className = 'menu-still';
    still.alt = '';
    menu.insertBefore(still, menu.firstChild);
  }
  // Only swap src when needed — keep decoded pixels during same-URL loops.
  if (still.getAttribute('src') !== coverSrc) {
    still.setAttribute('src', coverSrc);
  }
  still.style.display = '';
  still.style.opacity = '';
  notePaintedStill(host, still);
}

function resetMenuMotion(
  host: any,
  menuVideo: HTMLVideoElement | null,
  menu: Element | null,
) {
  if (menuVideo) {
    if (host._dvdjsMenuTimeUpdate) {
      menuVideo.removeEventListener('timeupdate', host._dvdjsMenuTimeUpdate);
      host._dvdjsMenuTimeUpdate = null;
    }
    if (host._dvdjsMenuEnded) {
      menuVideo.removeEventListener('ended', host._dvdjsMenuEnded);
      host._dvdjsMenuEnded = null;
    }
    host._dvdjsMenuSegmentEnd = null;
    host._dvdjsFinishMenuSegment = null;
    try {
      menuVideo.pause();
    } catch {
      // ignore
    }
    menuVideo.hidden = true;
    menuVideo.style.cssText = '';
    menuVideo.style.opacity = '';
  }
  const hostMenu = menu || host._dvdjsActiveMenu;
  const still = hostMenu && hostMenu.querySelector('img.menu-still');
  if (still) {
    (still as HTMLElement).style.opacity = '';
  }
}

/** Hide WebM only after hold or still covers the stage. */
function hideMenuVideoUnderCover(
  host: HTMLElement,
  menuVideo: HTMLVideoElement | null,
  menu: Element | null,
) {
  const still = menu?.querySelector('img.menu-still') as HTMLImageElement | null;
  const covered =
    menuHoldFrameVisible(host) ||
    (still &&
      still.style.opacity !== '0' &&
      still.style.display !== 'none' &&
      imageHasPixels(still));
  if (!covered && menuVideo && menuVideoShowsFrame(menuVideo)) {
    captureMenuHoldFrame(host, menuVideo);
  }
  if (menuVideo) {
    try {
      menuVideo.pause();
    } catch {
      // ignore
    }
    menuVideo.hidden = true;
    menuVideo.style.cssText = '';
    menuVideo.style.opacity = '';
  }
}
function setMenuButtonsEnabled(menu: Element | null, enabled: boolean) {
  if (!menu) {
    return;
  }
  menu.querySelectorAll('input.btn').forEach((btn) => {
    const input = btn as HTMLInputElement;
    input.disabled = !enabled;
    input.style.pointerEvents = enabled ? '' : 'none';
  });
}

export function highlightMenuButton(
  menu: Element | null,
  buttonIndex: number,
) {
  if (!menu) {
    return;
  }
  menu.querySelectorAll('input.btn').forEach((btn, i) => {
    const el = btn as HTMLElement;
    if (i === buttonIndex) {
      el.classList.add('selected');
      el.dataset.selected = '1';
    } else {
      el.classList.remove('selected');
      delete el.dataset.selected;
    }
  });

  const sels = menu.querySelectorAll('img.menu-spu-sel');
  const acts = menu.querySelectorAll('img.menu-spu-act');
  sels.forEach((sel, s) => {
    if (s === buttonIndex) {
      sel.removeAttribute('hidden');
    } else {
      sel.setAttribute('hidden', '');
    }
  });
  acts.forEach((act) => {
    act.setAttribute('hidden', '');
  });
}

export function flashMenuButtonActivate(
  menu: Element | null,
  buttonIndex: number,
  durationMs = 120,
) {
  if (!menu) {
    return;
  }
  const act = menu.querySelector(
    `img.menu-spu-act[data-id="${buttonIndex}"]`,
  ) as HTMLImageElement | null;
  const sel = menu.querySelector(
    `img.menu-spu-sel[data-id="${buttonIndex}"]`,
  ) as HTMLImageElement | null;
  if (!act) {
    return;
  }
  if (sel) {
    sel.setAttribute('hidden', '');
  }
  act.removeAttribute('hidden');
  setTimeout(() => {
    act.setAttribute('hidden', '');
    if (sel) {
      sel.removeAttribute('hidden');
    }
  }, durationMs);
}

function resolveMenuAssetBase(
  menu: HTMLElement,
  domain: string | number | null | undefined,
  opts: MenuCellPlayOpts,
): string | null {
  const fromList = [...(opts.spuSelect || []), ...(opts.spuActivate || [])];
  for (const src of fromList) {
    const m = src && src.match(/^(.*\/)menu-\d+-\d+-\d+/);
    if (m) {
      return m[1];
    }
  }

  const still = menu.querySelector('img.menu-still') as HTMLImageElement | null;
  const stillSrc = still?.getAttribute('src');
  if (stillSrc) {
    const m = stillSrc.match(/^(.*\/)menu-\d+-\d+-\d+\.png/);
    if (m) {
      return m[1];
    }
  }

  const dom = domain != null ? String(domain) : menu.dataset.domain;
  if (dom != null && menu.ownerDocument) {
    const menuVideo = menu.ownerDocument.getElementById(
      `menu-video-${dom}`,
    ) as HTMLVideoElement | null;
    const vsrc =
      menuVideo?.getAttribute('src') || menuVideo?.currentSrc || '';
    const vm = vsrc.match(/^(.*\/)[^/]+$/);
    if (vm) {
      return vm[1];
    }
  }

  // Any still/CSS already on the page for this disc.
  const any = document.querySelector(
    'img.menu-still[src*="menu-"], link[href*="menu-"]',
  ) as HTMLElement | null;
  const href =
    (any as HTMLImageElement)?.src ||
    (any as HTMLLinkElement)?.href ||
    any?.getAttribute('src') ||
    any?.getAttribute('href') ||
    '';
  const am = href.match(/^(.*\/)menu-\d+-\d+-\d+/);
  return am ? am[1] : null;
}

function updateMenuCellVisuals(
  menu: HTMLElement,
  opts: MenuCellPlayOpts,
  visualOpts: {
    stillMode?: 'show' | 'motion';
    /** Keep the current still painted; return nextStillSrc for deferred swap. */
    deferStillSrc?: boolean;
  } = {},
): string | null {
  if (opts.cellID == null || opts.vobID == null) {
    return null;
  }
  const stillMode = visualOpts.stillMode || 'show';
  const deferStillSrc = !!visualOpts.deferStillSrc;
  const domain =
    opts.domain != null ? opts.domain : menu.dataset.domain;
  const baseDir = resolveMenuAssetBase(menu, domain, opts);
  const prefix =
    domain != null
      ? `menu-${domain}-${opts.cellID}-${opts.vobID}`
      : null;
  const hasButtons = !!(opts.buttons && opts.buttons.length);

  let still = menu.querySelector('img.menu-still') as HTMLImageElement | null;
  let cssHref: string | null = null;
  let stillSrc: string | null = null;

  // Prefer an already-linked stylesheet for this cell when present (DvdDisc
  // only emits <link> when metadata has css).
  const links = document.querySelectorAll(
    `link[href*="menu-${domain}-${opts.cellID}-${opts.vobID}"]`,
  );
  if (links.length) {
    cssHref = links[0].getAttribute('href');
  } else if (baseDir && prefix && hasButtons) {
    // Hitbox sheets exist only for cells convert gave buttons/CSS. Pure
    // wipe cells (still_time 0, no HLI) never write menu-*.css — inventing
    // the URL fetches the HTML 404 page and Firefox nosniff-blocks it.
    cssHref = `${baseDir}${prefix}.css`;
  }

  // Still PNG: only invent a URL when we will show it. Motion/transition
  // cells omit the file on purpose (viewer holds the WebM frame).
  if (baseDir && prefix && stillMode === 'show') {
    stillSrc = `${baseDir}${prefix}.png`;
  }

  if (stillMode === 'show' && stillSrc) {
    if (!still) {
      still = document.createElement('img');
      still.className = 'menu-still';
      still.alt = '';
      menu.insertBefore(still, menu.firstChild);
    }
    const stillGen = ((menu as any)._dvdjsStillGen =
      ((menu as any)._dvdjsStillGen || 0) + 1);
    if (!deferStillSrc) {
      still.setAttribute('src', stillSrc);
      still.style.display = '';
      still.style.opacity = '';
    } else {
      // Keep whatever is currently painted (often opacity:0 over a frozen
      // WebM). Revealing now would flash the previous cell's cached PNG.
      still.style.display = '';
    }
    still.onerror = () => {
      if ((menu as any)._dvdjsStillGen !== stillGen) {
        return;
      }
      // Failed decode of the *new* src — hide broken icon; video/cover stays.
      still!.style.display = 'none';
    };
  } else if (stillMode === 'motion' && still) {
    // Transition / motion cells: never flash this cell's mid-wipe PNG. Caller
    // may install a previous-menu cover; keep still hidden until then.
    still.style.opacity = '0';
    still.onerror = null;
  }

  if (baseDir && prefix) {
    menu
      .querySelectorAll('img.menu-spu-sel, img.menu-spu-act')
      .forEach((el) => el.remove());

    let selList = opts.spuSelect ? [...opts.spuSelect] : [];
    let actList = opts.spuActivate ? [...opts.spuActivate] : [];
    if (!selList.length && opts.buttons && opts.buttons.length) {
      for (let si = 0; si < opts.buttons.length; si++) {
        selList.push(`${baseDir}${prefix}-spu-sel-${si}.png`);
        actList.push(`${baseDir}${prefix}-spu-act-${si}.png`);
      }
    }

    // Only fetch base SPU when this cell has highlight art — copyright /
    // warning cells have neither buttons nor SPU and would 404 otherwise.
    const wantsSpu =
      selList.length > 0 ||
      actList.length > 0 ||
      !!(opts.buttons && opts.buttons.length);
    let spu = menu.querySelector('img.menu-spu') as HTMLImageElement | null;
    if (wantsSpu) {
      const spuSrc = `${baseDir}${prefix}-spu.png`;
      if (spu) {
        spu.setAttribute('src', spuSrc);
      } else {
        spu = document.createElement('img');
        spu.className = 'menu-spu';
        spu.alt = '';
        spu.setAttribute('aria-hidden', 'true');
        spu.src = spuSrc;
        if (still?.nextSibling) {
          menu.insertBefore(spu, still.nextSibling);
        } else {
          menu.appendChild(spu);
        }
      }
      // Hide SPU until the still/video for this cell is revealed.
      spu.style.display =
        stillMode === 'motion' || deferStillSrc ? 'none' : '';
    } else if (spu) {
      spu.removeAttribute('src');
      spu.style.display = 'none';
    }
    for (let sj = 0; sj < selList.length; sj++) {
      const simg = document.createElement('img');
      simg.className = 'menu-spu-sel';
      simg.dataset.id = String(sj);
      simg.hidden = true;
      simg.alt = '';
      simg.setAttribute('aria-hidden', 'true');
      simg.src = selList[sj];
      menu.appendChild(simg);
    }
    for (let aj = 0; aj < actList.length; aj++) {
      const aimg = document.createElement('img');
      aimg.className = 'menu-spu-act';
      aimg.dataset.id = String(aj);
      aimg.hidden = true;
      aimg.alt = '';
      aimg.setAttribute('aria-hidden', 'true');
      aimg.src = actList[aj];
      menu.appendChild(aimg);
    }
  } else if (opts.spuSelect && opts.spuSelect.length) {
    // Absolute SPU URLs without a resolved baseDir (still-less menus).
    menu
      .querySelectorAll('img.menu-spu-sel, img.menu-spu-act')
      .forEach((el) => el.remove());
    for (let sj = 0; sj < opts.spuSelect.length; sj++) {
      const simg = document.createElement('img');
      simg.className = 'menu-spu-sel';
      simg.dataset.id = String(sj);
      simg.hidden = true;
      simg.alt = '';
      simg.setAttribute('aria-hidden', 'true');
      simg.src = opts.spuSelect[sj];
      menu.appendChild(simg);
    }
    const acts = opts.spuActivate || [];
    for (let aj = 0; aj < acts.length; aj++) {
      const aimg = document.createElement('img');
      aimg.className = 'menu-spu-act';
      aimg.dataset.id = String(aj);
      aimg.hidden = true;
      aimg.alt = '';
      aimg.setAttribute('aria-hidden', 'true');
      aimg.src = acts[aj];
      menu.appendChild(aimg);
    }
  }

  if (cssHref) {
    let link = menu.querySelector(
      'link[rel="stylesheet"]',
    ) as HTMLLinkElement | null;
    if (link) {
      link.href = cssHref;
    } else {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssHref;
      menu.insertBefore(link, menu.firstChild);
    }
  } else {
    // Drop the previous cell's sheet — do not point it at a missing wipe CSS.
    menu.querySelectorAll('link[rel="stylesheet"]').forEach((el) => el.remove());
  }

  // Always rebuild hitboxes — empty cells must clear the previous page's buttons.
  menu.querySelectorAll('input.btn').forEach((el) => el.remove());
  let btnCssLink: HTMLLinkElement | null = null;
  if (cssHref) {
    btnCssLink = menu.querySelector(
      'link[rel="stylesheet"]',
    ) as HTMLLinkElement | null;
  }
  if (opts.buttons && opts.buttons.length) {
    const hasSpuHighlight =
      (opts.spuSelect && opts.spuSelect.length > 0) ||
      !!menu.querySelector('img.menu-spu-sel');
    for (let b = 0; b < opts.buttons.length; b++) {
      const nav = opts.buttons[b] || {};
      const input = document.createElement('input');
      input.type = 'button';
      input.className = hasSpuHighlight ? 'btn btn-spu' : 'btn';
      input.dataset.id = String(b);
      if (nav.up != null) input.dataset.up = String(nav.up);
      if (nav.down != null) input.dataset.down = String(nav.down);
      if (nav.left != null) input.dataset.left = String(nav.left);
      if (nav.right != null) input.dataset.right = String(nav.right);
      if (nav.auto_action_mode) {
        input.dataset.autoAction = String(nav.auto_action_mode);
      }
      applyMenuButtonGeometry(input, nav);
      menu.appendChild(input);
    }
    // Old archives: geometry only in menu-*.css (attribute-scoped). Stamp
    // decls onto buttons so a data-cell/vob mismatch cannot collapse hitboxes.
    stampHitboxStylesFromStylesheet(menu, btnCssLink);
  }

  return stillSrc;
}

function playMenuMotionSegment(
  host: any,
  menuVideo: HTMLVideoElement,
  opts: MenuCellPlayOpts,
  onReady: () => void,
  playGen: number,
  seekCoverSrc: string | null = null,
) {
  const start = opts.startSec || 0;
  const end = opts.endSec!;
  const finishAt = motionSegmentFinishAt(start, end);
  host._dvdjsMenuSegmentEnd = end;
  host._dvdjsMenuSegmentStart = start;
  host._dvdjsMenuMotionVideo = menuVideo;
  menuVideo.loop = false;

  // Assigned below; identity token for stale seek/play/finish guards.
  let finishSegment: () => void = () => {};

  const isCurrent = () =>
    host._dvdjsMenuPlayGen === playGen &&
    host._dvdjsFinishMenuSegment === finishSegment;

  const armWatchdog = () => {
    if (host._dvdjsMotionWatchdog) {
      clearTimeout(host._dvdjsMotionWatchdog);
      host._dvdjsMotionWatchdog = null;
    }
    // Budget from segment duration, not live currentTime. If currentTime is
    // still past the new cell (seek lag), end - currentTime is negative and a
    // 0.2s floor would finish instantly → onPost cascades through scene pages.
    const remaining = Math.max(0.2, end - start + 0.35);
    host._dvdjsMotionWatchdog = setTimeout(() => {
      host._dvdjsMotionWatchdog = null;
      if (isCurrent()) {
        finishSegment();
      }
    }, remaining * 1000);
  };

  finishSegment = () => {
    if (host._dvdjsFinishMenuSegment !== finishSegment) {
      return;
    }
    if (host._dvdjsMenuPlayGen !== playGen) {
      return;
    }
    if (host._dvdjsMotionWatchdog) {
      clearTimeout(host._dvdjsMotionWatchdog);
      host._dvdjsMotionWatchdog = null;
    }
    if (host._dvdjsRevealRetryTimer) {
      clearTimeout(host._dvdjsRevealRetryTimer);
      host._dvdjsRevealRetryTimer = null;
    }
    if (host._dvdjsMotionRaf) {
      cancelAnimationFrame(host._dvdjsMotionRaf);
      host._dvdjsMotionRaf = null;
    }
    menuVideo.removeEventListener('timeupdate', onTimeUpdate);
    menuVideo.removeEventListener('ended', onEnded);
    if (host._dvdjsMenuTimeUpdate === onTimeUpdate) {
      host._dvdjsMenuTimeUpdate = null;
    }
    if (host._dvdjsMenuEnded === onEnded) {
      host._dvdjsMenuEnded = null;
    }
    if (host._dvdjsMenuRevealTimeUpdate) {
      menuVideo.removeEventListener(
        'timeupdate',
        host._dvdjsMenuRevealTimeUpdate,
      );
      host._dvdjsMenuRevealTimeUpdate = null;
    }
    // Kill audio first — overshoot into the next concat cell is audible even
    // when the video layer is already covered.
    silenceVideoAudio(menuVideo);
    // Snapshot the end frame *before* freeze may hide a snapped-to-0 video.
    captureMenuHoldFrame(host, menuVideo, { show: false });
    const lostEndFrame = freezeMenuVideoAtEnd(menuVideo, start, end);
    if (lostEndFrame) {
      showMenuHoldFrame(host);
      if (!menuHoldFrameVisible(host)) {
        ensureStillCoverVisible(
          host._dvdjsActiveMenu,
          host._dvdjsLastPaintedStillSrc ||
            stillCoverUrlFromMenu(
              host._dvdjsActiveMenu,
              host._dvdjsLastPaintedStillSrc,
            ),
          host,
        );
      }
    }
    const stillTime = opts.still_time != null ? opts.still_time : 0;
    host._dvdjsMenuSegmentEnd = null;
    host._dvdjsFinishMenuSegment = null;
    // still_time 255: hold last frame until the user picks a button.
    // still_time 0 with buttons: still post — cellCmds / PGC post often loop
    // the motion segment (Harry Potter main menu). Keep loop=false + freeze;
    // restart comes from onPost → playCurrentMenuCell, not HTML video.loop.
    if (shouldHoldAfterMenuMotion(stillTime)) {
      return;
    }
    // Timed still after motion (Avatar copyrights): prefer the extracted PNG
    // over a black/near-black frozen WebM frame during still_time.
    if (stillTime > 0 && stillTime < 255) {
      const active = host._dvdjsActiveMenu as HTMLElement | null;
      const stillEl = active?.querySelector(
        'img.menu-still',
      ) as HTMLImageElement | null;
      if (stillEl) {
        const domain =
          opts.domain != null
            ? opts.domain
            : active?.dataset?.domain;
        const base = resolveMenuAssetBase(active || stillEl, domain, opts);
        if (
          base &&
          domain != null &&
          opts.cellID != null &&
          opts.vobID != null
        ) {
          const src = `${base}menu-${domain}-${opts.cellID}-${opts.vobID}.png`;
          stillEl.setAttribute('src', src);
          stillEl.style.display = '';
          stillEl.style.opacity = '';
          void whenImageReady(stillEl, { timeoutMs: 2000, expectedSrc: src }).then(
            (ok) => {
              if (!ok || host._dvdjsActiveMenu !== active) return;
              hideMenuVideoUnderCover(host, menuVideo, active);
              hideMenuHoldFrame(host);
            },
          );
        }
      }
    }
    // DVD: play the cell, then hold last frame for still_time before post().
    // Language copyrights: after the timed hold, open translated menus (same
    // as the preferStillOnly path) so a motion fallback cannot fall into PGC9.
    const rawPost = host._dvdjsMenuPost as (() => void) | null | undefined;
    const postFn = menuCellPrefersStillOnly(opts)
      ? () => {
          try {
            rawPost?.();
          } finally {
            afterLanguageCopyrightPost(window as any);
          }
        }
      : rawPost;
    scheduleMenuPostAfterStill(host, stillTime, postFn);
  };

  const checkSegmentEnd = () => {
    if (!isCurrent()) {
      return;
    }
    const t = menuVideo.currentTime;
    // Mute slightly before finish so a late decoder tick cannot play the next
    // cell's audio (Harry Potter wipe → scene page bleed).
    if (t >= finishAt - 0.08 || t >= end - 0.02) {
      silenceVideoAudio(menuVideo);
    }
    if (t >= finishAt || t >= end) {
      finishSegment();
    }
  };

  const onTimeUpdate = () => {
    // Keep a silent snapshot near the end so finish/lost-frame has a bitmap.
    if (menuVideo.currentTime >= finishAt - 0.35) {
      captureMenuHoldFrame(host, menuVideo, { show: false });
    }
    checkSegmentEnd();
  };

  const pollSegmentEnd = () => {
    if (!isCurrent()) {
      host._dvdjsMotionRaf = null;
      return;
    }
    checkSegmentEnd();
    if (host._dvdjsFinishMenuSegment === finishSegment) {
      host._dvdjsMotionRaf = requestAnimationFrame(pollSegmentEnd);
    } else {
      host._dvdjsMotionRaf = null;
    }
  };

  // Artifacted / short WebMs may never reach endSec via timeupdate.
  const onEnded = () => {
    finishSegment();
  };

  host._dvdjsFinishMenuSegment = finishSegment;

  // Capture the currently painted stage BEFORE hiding the WebM for seek.
  // Without this, opacity:0 on video + still leaves a black frame.
  const stageStill = host._dvdjsActiveMenu?.querySelector(
    'img.menu-still',
  ) as HTMLImageElement | null;
  const held = captureMenuHoldFromStage(host, {
    menuVideo,
    still: stageStill,
  });

  // Match still/SPU: fill the DVD stage (letterboxing is on the stage, not here).
  // Start opacity:0 in the same style write — never paint a seek snap for a frame.
  menuVideo.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:fill;z-index:0;opacity:0;';
  menuVideo.hidden = false;

  if (!held && seekCoverSrc) {
    // No canvas hold — last resort: previous still PNG under the seek.
    ensureStillCoverVisible(host._dvdjsActiveMenu, seekCoverSrc, host);
  } else if (stageStill) {
    // Hold canvas (or nothing) covers; keep still hidden so cached PNGs cannot flash.
    stageStill.style.opacity = '0';
  }

  const still =
    host._dvdjsActiveMenu &&
    host._dvdjsActiveMenu.querySelector('img.menu-still');

  const beginPlayback = (): boolean => {
    if (!isCurrent()) {
      return false;
    }
    // Do not arm finish listeners while still outside the segment — a stale
    // currentTime past finishAt would finish on the first timeupdate and
    // auto-advance the PGC (Harry Potter scene pages).
    if (menuVideo.currentTime < start - 0.25 || menuVideo.currentTime >= end) {
      return false;
    }
    host._dvdjsMenuTimeUpdate = onTimeUpdate;
    host._dvdjsMenuEnded = onEnded;
    menuVideo.addEventListener('timeupdate', onTimeUpdate);
    menuVideo.addEventListener('ended', onEnded);
    armWatchdog();
    // Stay muted until reveal — otherwise play() leaks audio under the seek cover.
    void playWithAutoplayFallback(menuVideo, host as AutoplayHost, {
      startMuted: true,
    }).then(
      (ok) => {
        // Segment may have already finished / advanced (seek past EOF, short
        // WebM). Do not hide the still after the next cell has taken over.
        if (!isCurrent()) {
          return;
        }
        if (ok) {
          const reveal = (): boolean => {
            if (!isCurrent()) {
              return true;
            }
            // Only drop the cover once we are actually inside this segment.
            if (menuVideo.currentTime < start - 0.25) {
              return false;
            }
            // Show video first, then drop hold — never black between layers.
            // Unmute only once the frame is visible (seek was muted).
            setMenuVideoSeekCover(menuVideo, false, {
              unmute: true,
            });
            if (still) {
              (still as HTMLElement).style.opacity = '0';
            }
            // Refresh hold bitmap for the *next* handoff without flashing it now.
            captureMenuHoldFrame(host, menuVideo, { show: false });
            hideMenuHoldFrame(host);
            const spu = host._dvdjsActiveMenu?.querySelector(
              'img.menu-spu',
            ) as HTMLElement | null;
            if (spu && spu.getAttribute('src')) {
              spu.style.display = '';
            }
            hideOtherMenuVideos(host, menuVideo);
            // Precise end detection — timeupdate alone overruns into the next cell.
            if (host._dvdjsMotionRaf) {
              cancelAnimationFrame(host._dvdjsMotionRaf);
            }
            host._dvdjsMotionRaf = requestAnimationFrame(pollSegmentEnd);
            onReady();
            return true;
          };
          const scheduleRevealRetry = () => {
            if (host._dvdjsRevealRetryTimer) {
              clearTimeout(host._dvdjsRevealRetryTimer);
            }
            host._dvdjsRevealRetryTimer = setTimeout(() => {
              host._dvdjsRevealRetryTimer = null;
              if (!isCurrent()) {
                return;
              }
              if (reveal()) {
                if (host._dvdjsMenuRevealTimeUpdate) {
                  menuVideo.removeEventListener(
                    'timeupdate',
                    host._dvdjsMenuRevealTimeUpdate,
                  );
                  host._dvdjsMenuRevealTimeUpdate = null;
                }
                return;
              }
              // Keep cover; retry until in-segment or segment cancelled.
              scheduleRevealRetry();
            }, 100);
          };
          if (reveal()) {
            return;
          }
          const onTime = () => {
            if (reveal()) {
              menuVideo.removeEventListener('timeupdate', onTime);
              if (host._dvdjsMenuRevealTimeUpdate === onTime) {
                host._dvdjsMenuRevealTimeUpdate = null;
              }
              if (host._dvdjsRevealRetryTimer) {
                clearTimeout(host._dvdjsRevealRetryTimer);
                host._dvdjsRevealRetryTimer = null;
              }
            }
          };
          host._dvdjsMenuRevealTimeUpdate = onTime;
          menuVideo.addEventListener('timeupdate', onTime);
          scheduleRevealRetry();
          return;
        }
        // Autoplay blocked: show a usable still (prefer this cell's PNG when
        // present; motion cover may still be the previous menu).
        menuVideo.removeEventListener('timeupdate', onTimeUpdate);
        menuVideo.removeEventListener('ended', onEnded);
        if (host._dvdjsMenuTimeUpdate === onTimeUpdate) {
          host._dvdjsMenuTimeUpdate = null;
        }
        if (host._dvdjsMenuEnded === onEnded) {
          host._dvdjsMenuEnded = null;
        }
        if (host._dvdjsMotionWatchdog) {
          clearTimeout(host._dvdjsMotionWatchdog);
          host._dvdjsMotionWatchdog = null;
        }
        host._dvdjsMenuSegmentEnd = null;
        host._dvdjsFinishMenuSegment = null;
        try {
          menuVideo.pause();
        } catch {
          // ignore
        }
        setMenuVideoSeekCover(menuVideo, true);
        if (still) {
          const domain =
            opts.domain != null
              ? opts.domain
              : host._dvdjsActiveMenu?.dataset?.domain;
          const base = resolveMenuAssetBase(
            host._dvdjsActiveMenu || still.parentElement!,
            domain,
            opts,
          );
          const stillTimeFallback =
            opts.still_time != null ? opts.still_time : 0;
          const wantsStillFallback =
            stillTimeFallback > 0 ||
            !!(opts.buttons && opts.buttons.length);
          if (
            wantsStillFallback &&
            base &&
            domain != null &&
            opts.cellID != null &&
            opts.vobID != null
          ) {
            still.setAttribute(
              'src',
              `${base}menu-${domain}-${opts.cellID}-${opts.vobID}.png`,
            );
          }
          (still as HTMLElement).style.opacity = '';
        }
        const stillTime = opts.still_time != null ? opts.still_time : 0;
        if (
          stillTime > 0 &&
          stillTime < 255 &&
          typeof host._dvdjsMenuPost === 'function'
        ) {
          scheduleMenuPostAfterStill(host, stillTime, host._dvdjsMenuPost);
        } else {
          notifyAutoplayBlocked(host as AutoplayHost);
        }
      },
    );
    return true;
  };

  /** Seek then play — avoids black/skip when re-entering a segment already near end. */
  let seekAttempts = 0;
  const seekThenPlay = () => {
    if (!isCurrent()) {
      return;
    }
    // Truncated menu WebM: segment starts past EOF — finish so PGC post can
    // advance (Shrek VIDEO_TS.webm ~0.13s vs FP cell at 0.48s).
    const mediaDur = menuVideo.duration;
    if (
      Number.isFinite(mediaDur) &&
      mediaDur > 0 &&
      start >= mediaDur - 0.05
    ) {
      finishSegment();
      return;
    }
    if (host._dvdjsMenuSeeked) {
      menuVideo.removeEventListener('seeked', host._dvdjsMenuSeeked);
      host._dvdjsMenuSeeked = null;
    }
    const onSeeked = () => {
      if (host._dvdjsMenuSeeked === onSeeked) {
        host._dvdjsMenuSeeked = null;
      }
      menuVideo.removeEventListener('seeked', onSeeked);
      if (!isCurrent()) {
        return;
      }
      if (beginPlayback()) {
        return;
      }
      // Landed outside the segment after retries. Common when the menu WebM is
      // shorter than menuCell times (broken / truncated encode): seeking to
      // startSec past EOF never enters the window. Finish so PGC post can run
      // (Shrek FP motion → linkPGC) instead of a permanent black screen.
      if (seekAttempts >= 3) {
        finishSegment();
        return;
      }
      seekAttempts += 1;
      host._dvdjsMenuSeeked = onSeeked;
      menuVideo.addEventListener('seeked', onSeeked);
      try {
        menuVideo.currentTime = start;
      } catch {
        menuVideo.removeEventListener('seeked', onSeeked);
        if (host._dvdjsMenuSeeked === onSeeked) {
          host._dvdjsMenuSeeked = null;
        }
      }
    };
    if (
      Math.abs(menuVideo.currentTime - start) < 0.04 &&
      menuVideo.currentTime < end
    ) {
      if (beginPlayback()) {
        return;
      }
    }
    seekAttempts += 1;
    host._dvdjsMenuSeeked = onSeeked;
    menuVideo.addEventListener('seeked', onSeeked);
    try {
      menuVideo.currentTime = start;
    } catch {
      menuVideo.removeEventListener('seeked', onSeeked);
      if (host._dvdjsMenuSeeked === onSeeked) {
        host._dvdjsMenuSeeked = null;
      }
      beginPlayback();
    }
  };

  if (menuVideo.readyState >= 1) {
    seekThenPlay();
  } else {
    if (host._dvdjsMenuLoadedMeta) {
      menuVideo.removeEventListener(
        'loadedmetadata',
        host._dvdjsMenuLoadedMeta,
      );
      host._dvdjsMenuLoadedMeta = null;
    }
    const onMeta = () => {
      if (host._dvdjsMenuLoadedMeta === onMeta) {
        host._dvdjsMenuLoadedMeta = null;
      }
      menuVideo.removeEventListener('loadedmetadata', onMeta);
      if (!isCurrent()) {
        return;
      }
      seekThenPlay();
    };
    host._dvdjsMenuLoadedMeta = onMeta;
    menuVideo.addEventListener('loadedmetadata', onMeta);
    // Avoid load() while preload is already fetching — resets the buffer.
    const ns = menuVideo.networkState;
    if (
      ns === HTMLMediaElement.NETWORK_EMPTY ||
      (ns === HTMLMediaElement.NETWORK_IDLE && menuVideo.readyState === 0)
    ) {
      menuVideo.load();
    }
  }
}

function currentVideo(host: XVideoElement): HTMLVideoElement | null {
  const entry = host.playlist[host.videoIndex];
  return entry ? entry.video : null;
}

function buildPlaylist(host: HTMLElement): PlaylistEntry[] {
  return Array.from(host.querySelectorAll(':scope > video'))
    .filter((video) => {
      const el = video as HTMLVideoElement;
      return !el.classList.contains('dvdjs-menu-video');
    })
    .map((video) => {
      const el = video as HTMLVideoElement;
      el.style.display = 'none';
      let chapterCues: TextTrackCue[] = [];
      if (el.textTracks && el.textTracks.length > 0) {
        try {
          chapterCues = Array.from(el.textTracks[0].cues || []);
        } catch {
          chapterCues = [];
        }
      }
      return {
        id: el.id,
        video: el,
        src: el.getAttribute('src') || el.currentSrc || '',
        chapterCues,
        titlePgcMedia: parseTitlePgcMediaAttr(el),
      };
    });
}

class XVideo extends HTMLElement implements XVideoElement {
  playlist: PlaylistEntry[] = [];
  videoIndex = 0;
  onmenu: ((event: object) => void) | null = null;
  #unbindKeys: (() => void) | null = null;

  connectedCallback() {
    if (getComputedStyle(this).position === 'static') {
      this.style.position = 'relative';
    }
    this.style.display = 'block';
    this.style.margin = '0 auto';
    this.style.background = '#000';
    this.style.overflow = 'hidden';
    this.tabIndex = 0;

    this.#unbindKeys = bindMenuKeys(this);

    // Defer until Solid finishes painting children.
    queueMicrotask(() => this.#refreshPlaylist());
  }

  disconnectedCallback() {
    this.#unbindKeys?.();
    this.#unbindKeys = null;
  }

  #refreshPlaylist() {
    this.playlist = buildPlaylist(this);
    this.playlist.forEach((entry, i) => {
      entry.video.style.display = i === this.videoIndex ? 'block' : 'none';
      entry.video.style.width = '100%';
      entry.video.style.height = 'auto';
    });
  }

  play() {
    this.#refreshPlaylist();
    const video = currentVideo(this);
    if (!video) {
      return;
    }
    this.playlist.forEach((entry, i) => {
      entry.video.style.display = i === this.videoIndex ? 'block' : 'none';
    });
    hideAllMenu(this);
    return video.play();
  }

  pause() {
    const video = currentVideo(this);
    if (video) {
      video.pause();
    }
    const menuVideos = this.querySelectorAll(
      'video.dvdjs-menu-video',
    ) as NodeListOf<HTMLVideoElement>;
    menuVideos.forEach((v) => {
      try {
        v.pause();
      } catch {
        // ignore
      }
    });
  }

  /**
   * Jump to the end of the active menu motion segment, timed still, or title
   * clip. Used by N and the toolbar button.
   */
  skipToEnd(): boolean {
    return skipPlaybackToEnd(this);
  }

  /**
   * Escape broken menus by jumping to the title/root menu via onmenu.
   * Used by M and the toolbar button.
   */
  goToMainMenu(): boolean {
    return jumpToMainMenu(this);
  }

  /** Persist menu lang preference and reopen main menu in that LU. */
  setMenuLanguage(lang: string): boolean {
    return setDiscMenuLanguage(this, lang, window as any);
  }

  /** Snapshot menu/VM before a user button command runs. */
  beginUserButtonNav(): void {
    latchUserButtonNav(this as any, window as any);
  }

  /**
   * Called from compiled JumpTT / JumpVTS_* before title PGC run.
   * When a menu button targets a missing title (or a PGC omitted from a
   * short-cell rip), show the dialog and abort without mutating domain/pgc
   * or hiding the current menu — unless a convert stub handles it.
   */
  guardTitleJump(elementID: string, pgc?: number): boolean {
    if (elementID === undefined) {
      return true;
    }
    const id = String(elementID);
    this.#refreshPlaylist();
    const entry = this.playlist.find((e) => e.id === id);
    if (!isTitleMediaMissing(entry, pgc)) {
      return true;
    }
    const stub = getTitleStub(entry?.titlePgcMedia, pgc);
    if (stub) {
      // skip / interactive stubs: let PGCIUT.run → playTitlePgc handle it.
      return true;
    }
    // Missing title with no stub: button → sticky dialog in place; FP/auto → let run proceed.
    if ((this as any)._dvdjsFromButton) {
      showTitleUnavailable(this);
      return false;
    }
    return true;
  }

  /**
   * Title PGC entry after pre(): play short-cell WebM, interactive stub UI,
   * or silent skip (PGC post) for omitted buttonless titles.
   */
  playTitlePgc(domain: number, pgc: number): void {
    this.#refreshPlaylist();
    const id = `video-${domain}`;
    const entry = this.playlist.find((e) => e.id === id);
    const stub = getTitleStub(entry?.titlePgcMedia, pgc);

    if (stub && stub.kind === 'skip') {
      hideTitleUnavailableOverlay(this);
      if (!playSkipTitleStub(this as any, window as any)) {
        showTitleUnavailable(this);
      }
      return;
    }

    if (stub && stub.kind === 'interactive') {
      hideTitleUnavailableOverlay(this);
      clearUserButtonNav(this as any);
      clearMissingTitleSkip(this as any);
      this.pause();
      hideAllMenu(this);
      // Hide title videos while showing the stub still.
      this.playlist.forEach((e) => {
        e.video.style.display = 'none';
      });
      const menu = ensureTitleStubMenu(this, domain, stub);
      (this as any)._dvdjsActiveMenu = menu;
      if (typeof (menu as any).show === 'function') {
        (menu as any).show();
      } else {
        menu.style.display = 'flex';
        menu.hidden = false;
      }
      // Inline geometry already set in ensureTitleStubMenu; stamp sheet as fallback.
      const cssLink = stub.css
        ? (document.querySelector(
            `link#title-stub-css-${domain}-${stub.cellID}-${stub.vobID}`,
          ) as HTMLLinkElement | null)
        : null;
      menu.querySelectorAll('input.btn').forEach((el) => {
        const id = Number((el as HTMLElement).dataset.id || 0);
        const nav = (stub.buttons || [])[id];
        applyMenuButtonGeometry(el as HTMLElement, nav);
      });
      stampHitboxStylesFromStylesheet(menu, cssLink);
      const hl =
        Math.floor(((window as any).sprm?.HL_BTNN || 0x0400) / 0x0400) - 1;
      this.setMenuHighlight(menu, Math.max(0, hl));
      // Infinite / timed still — no WebM; post only via button cmds or still_time.
      const stillTime = stub.still_time != null ? stub.still_time : 255;
      if (stillTime > 0 && stillTime < 255) {
        scheduleMenuPostAfterStill(this as any, stillTime, () => {
          const g = window as any;
          const pgcObj = g.PGCIUT?.[domain]?.[pgc];
          if (pgcObj && typeof pgcObj.post === 'function') {
            pgcObj.post();
          }
        });
      }
      return;
    }

    // Included (or legacy missing): normal playByID path.
    this.playByID(id);
  }

  /**
   * Play a single title-domain cell (LinkPGN / LinkCN). Uses remapped WebM
   * [startSec, endSec) from convert; on end runs onPost (cellCmds → post).
   */
  playTitleCell(opts: {
    domain: number;
    pgc: number;
    cellN?: number;
    cellID?: number;
    vobID?: number;
    still_time?: number;
    startSec?: number;
    endSec?: number;
    onPost?: () => void;
  }): void {
    this.#refreshPlaylist();
    const id = `video-${opts.domain}`;
    const entry = this.playlist.find((e) => e.id === id);
    const cellN = opts.cellN != null ? opts.cellN : 1;

    // Resolve timeline: explicit opts, else metadata pgcCells, else whole PGC.
    let startSec = opts.startSec;
    let endSec = opts.endSec;
    const media = entry?.titlePgcMedia;
    if (
      (startSec == null || endSec == null) &&
      media &&
      media.pgcCells &&
      media.pgcCells[String(opts.pgc)]
    ) {
      const cells = media.pgcCells[String(opts.pgc)];
      const cell = cells[Math.max(0, cellN - 1)];
      if (cell) {
        startSec = cell.startSec;
        endSec = cell.endSec;
      }
    }
    if (
      (startSec == null || endSec == null) &&
      media &&
      media.pgcTimeline &&
      media.pgcTimeline[String(opts.pgc)]
    ) {
      const tl = media.pgcTimeline[String(opts.pgc)];
      startSec = tl.startSec;
      endSec = tl.endSec;
    }

    if (!entry || isTitleMediaMissing(entry, opts.pgc)) {
      const stub = getTitleStub(entry?.titlePgcMedia, opts.pgc);
      if (stub) {
        this.playTitlePgc(opts.domain, opts.pgc);
        return;
      }
      // Missing cell media: still run onPost so trivia can return to menu.
      if (typeof opts.onPost === 'function') {
        setTimeout(() => {
          try {
            opts.onPost?.();
          } catch (e) {
            console.warn('DVD.js title cell post failed', e);
          }
        }, 0);
        return;
      }
      showTitleUnavailable(this);
      return;
    }

    hideTitleUnavailableOverlay(this);
    clearUserButtonNav(this as any);
    clearMissingTitleSkip(this as any);
    hideAllMenu(this);

    const targetIndex = this.playlist.findIndex((e) => e.id === id);
    this.videoIndex = targetIndex;
    const video = entry.video;

    // Clear prior title end handlers.
    const prevEnded = (this as any)._dvdjsTitleEnded as
      | ((ev: Event) => void)
      | null;
    const prevTime = (this as any)._dvdjsTitleTimeEnd as
      | ((ev: Event) => void)
      | null;
    if (prevEnded) {
      video.removeEventListener('ended', prevEnded);
    }
    if (prevTime) {
      video.removeEventListener('timeupdate', prevTime);
    }
    (this as any)._dvdjsTitleEnded = null;
    (this as any)._dvdjsTitleTimeEnd = null;

    const seekTo = startSec != null && Number.isFinite(startSec) ? startSec : 0;
    const finishAt =
      endSec != null && Number.isFinite(endSec) ? endSec : null;

    const onMeta = () => {
      video.removeEventListener('loadedmetadata', onMeta);
      try {
        video.currentTime = seekTo;
      } catch {
        // ignore
      }
    };
    if (video.readyState >= 1) {
      try {
        video.currentTime = seekTo;
      } catch {
        // ignore
      }
    } else {
      video.addEventListener('loadedmetadata', onMeta);
    }

    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      const endedFn = (this as any)._dvdjsTitleEnded;
      const timeFn = (this as any)._dvdjsTitleTimeEnd;
      if (endedFn) {
        video.removeEventListener('ended', endedFn);
      }
      if (timeFn) {
        video.removeEventListener('timeupdate', timeFn);
      }
      (this as any)._dvdjsTitleEnded = null;
      (this as any)._dvdjsTitleTimeEnd = null;
      try {
        video.pause();
      } catch {
        // ignore
      }
      const stillTime = opts.still_time != null ? opts.still_time : 0;
      const post = () => {
        if (typeof opts.onPost === 'function') {
          try {
            opts.onPost();
          } catch (e) {
            console.warn('DVD.js title cell onPost failed', e);
          }
        }
      };
      if (stillTime > 0 && stillTime < 255) {
        scheduleMenuPostAfterStill(this as any, stillTime, post);
      } else if (stillTime === 255) {
        // Infinite still — wait for user (unusual in title cell games).
      } else {
        post();
      }
    };

    const onEnded = () => {
      finish();
    };
    (this as any)._dvdjsTitleEnded = onEnded;
    video.addEventListener('ended', onEnded);
    if (finishAt != null) {
      const onTime = () => {
        if (video.currentTime + 0.05 >= finishAt) {
          finish();
        }
      };
      video.addEventListener('timeupdate', onTime);
      (this as any)._dvdjsTitleTimeEnd = onTime;
    }

    this.playlist.forEach((e, i) => {
      e.video.style.display = i === this.videoIndex ? 'block' : 'none';
    });
    try {
      void video.play();
    } catch (e) {
      console.warn('DVD.js title cell play failed', e);
      finish();
    }
  }

  playByIndex(videoIndex: number) {
    if (
      typeof videoIndex !== 'number' ||
      videoIndex < 0 ||
      videoIndex >= this.playlist.length
    ) {
      console.error('Video requested out of bound');
      return;
    }
    this.#refreshPlaylist();
    this.videoIndex = videoIndex;
    hideAllMenu(this);
    this.play();
  }

  playByID(elementID: string) {
    if (elementID === undefined) {
      console.error('Missing element ID');
      return;
    }
    const id = String(elementID);
    this.#refreshPlaylist();

    const targetElementIndex = this.playlist.findIndex(
      (entry) => entry.id === id,
    );

    if (targetElementIndex < 0) {
      if (/^video-/.test(id)) {
        showTitleUnavailable(this);
        return;
      }
      console.error('Unknown element ID');
      return;
    }

    const entry = this.playlist[targetElementIndex];
    const g = window as any;
    const pgc = g && g.pgc;
    if (isTitleMediaMissing(entry, pgc)) {
      const stub = getTitleStub(entry.titlePgcMedia, pgc);
      if (stub && typeof g.domain === 'number' && pgc != null) {
        this.playTitlePgc(g.domain, Number(pgc));
        return;
      }
      showTitleUnavailable(this);
      return;
    }

    hideTitleUnavailableOverlay(this);
    this.videoIndex = targetElementIndex;
    hideAllMenu(this);

    const video = this.playlist[this.videoIndex].video;
    const timeline =
      entry.titlePgcMedia &&
      entry.titlePgcMedia.pgcTimeline &&
      pgc != null
        ? entry.titlePgcMedia.pgcTimeline[String(pgc)]
        : null;
    if (timeline && Number.isFinite(timeline.startSec)) {
      const seekTo = timeline.startSec;
      const onMeta = () => {
        video.removeEventListener('loadedmetadata', onMeta);
        try {
          video.currentTime = seekTo;
        } catch {
          // ignore
        }
      };
      if (video.readyState >= 1) {
        try {
          video.currentTime = seekTo;
        } catch {
          // ignore
        }
      } else {
        video.addEventListener('loadedmetadata', onMeta);
      }
    }

    // Short included titles: when the clip ends, run title PGC post() so
    // buttonless games / extras auto-advance like on a real player.
    const prevEnded = (this as any)._dvdjsTitleEnded as
      | ((ev: Event) => void)
      | null;
    const prevTime = (this as any)._dvdjsTitleTimeEnd as
      | ((ev: Event) => void)
      | null;
    if (prevEnded) {
      video.removeEventListener('ended', prevEnded);
    }
    if (prevTime) {
      video.removeEventListener('timeupdate', prevTime);
    }
    (this as any)._dvdjsTitleEnded = null;
    (this as any)._dvdjsTitleTimeEnd = null;

    let titlePostDone = false;
    const runTitlePost = () => {
      if (titlePostDone) {
        return;
      }
      titlePostDone = true;
      const endedFn = (this as any)._dvdjsTitleEnded;
      const timeFn = (this as any)._dvdjsTitleTimeEnd;
      if (endedFn) {
        video.removeEventListener('ended', endedFn);
      }
      if (timeFn) {
        video.removeEventListener('timeupdate', timeFn);
      }
      (this as any)._dvdjsTitleEnded = null;
      (this as any)._dvdjsTitleTimeEnd = null;
      const gg = window as any;
      const pgcObj =
        gg.PGCIUT &&
        gg.domain != null &&
        gg.pgc != null &&
        gg.PGCIUT[gg.domain] &&
        gg.PGCIUT[gg.domain][gg.pgc];
      if (pgcObj && typeof pgcObj.post === 'function') {
        try {
          pgcObj.post();
        } catch (e) {
          console.warn('DVD.js title post failed', e);
        }
      }
    };
    const onTitleEnded = () => {
      runTitlePost();
    };
    (this as any)._dvdjsTitleEnded = onTitleEnded;
    video.addEventListener('ended', onTitleEnded);
    const endAt =
      timeline && Number.isFinite(timeline.endSec) ? timeline.endSec : null;
    if (endAt != null) {
      const onTime = () => {
        if (video.currentTime + 0.05 >= endAt) {
          try {
            video.pause();
          } catch {
            // ignore
          }
          runTitlePost();
        }
      };
      video.addEventListener('timeupdate', onTime);
      (this as any)._dvdjsTitleTimeEnd = onTime;
    }

    const onMediaError = () => {
      video.removeEventListener('error', onMediaError);
      showTitleUnavailable(this);
    };
    video.addEventListener('error', onMediaError);
    if (video.error) {
      onMediaError();
      return;
    }
    this.play();
  }

  playChapter(chapterIndex: number) {
    if (typeof chapterIndex !== 'number') {
      console.error('Invalid chapter number');
      return;
    }
    this.#refreshPlaylist();
    const current = this.playlist[this.videoIndex];
    if (
      isTitleMediaMissing(current) ||
      !current.chapterCues ||
      chapterIndex < 0 ||
      chapterIndex >= current.chapterCues.length
    ) {
      showTitleUnavailable(this);
      return;
    }
    hideTitleUnavailableOverlay(this);
    const cue = current.chapterCues[chapterIndex] as TextTrackCue & {
      startTime: number;
    };
    current.video.currentTime = cue.startTime;
    this.play();
  }

  playMenuByID(elementID: string) {
    if (elementID === undefined) {
      console.error('Missing element ID');
      return;
    }
    const menu = this.querySelector(`#${CSS.escape(String(elementID))}`) as
      | (HTMLElement & { show?: () => void })
      | null;
    if (!menu) {
      console.error('Unknown element ID');
      return;
    }

    hideTitleUnavailableOverlay(this);
    this.pause();
    hideAllMenu(this);
    cancelActiveMenuMotion(this as any);
    bumpMenuPlayGen(this as any);
    const domainVideo = this.querySelector(
      `#menu-video-${menu.dataset.domain != null ? menu.dataset.domain : ''}`,
    ) as HTMLVideoElement | null;
    resetMenuMotion(this, domainVideo, menu);
    hideOtherMenuVideos(this, null);
    (this as any)._dvdjsActiveMenu = menu;
    if (typeof menu.show === 'function') {
      menu.show();
    } else {
      menu.style.display = 'flex';
    }
    const hl =
      Math.floor(
        ((window as any).sprm && (window as any).sprm.HL_BTNN
          ? (window as any).sprm.HL_BTNN
          : 0x0400) / 0x0400,
      ) - 1;
    highlightMenuButton(menu, hl);
  }

  playMenuCell(opts: MenuCellPlayOpts = {}) {
    const menu = (
      opts.menuId
        ? this.querySelector(`#${CSS.escape(opts.menuId)}`)
        : (this as any)._dvdjsActiveMenu
    ) as (HTMLElement & { show?: () => void }) | null;

    if (!menu) {
      console.error('playMenuCell: unknown menu', opts.menuId);
      return;
    }

    hideTitleUnavailableOverlay(this);
    clearUserButtonNav(this as any);
    clearMissingTitleSkip(this as any);
    // Cancel prior motion/seek before swapping posts — stale finish must not
    // run with the new onPost. Keep last painted frame until the next asset is ready.
    cancelActiveMenuMotion(this as any);
    const playGen = bumpMenuPlayGen(this as any);

    // Capture outgoing still before we retarget _dvdjsActiveMenu.
    const prevMenu = (this as any)._dvdjsActiveMenu as HTMLElement | null;
    const coverSrc = stillCoverUrlFromMenu(
      prevMenu,
      (this as any)._dvdjsLastPaintedStillSrc,
    );

    (this as any)._dvdjsActiveMenu = menu;
    (this as any)._dvdjsMenuPost =
      typeof opts.onPost === 'function' ? opts.onPost : null;

    if (opts.cellID != null) {
      menu.dataset.cell = String(opts.cellID);
    }
    if (opts.vobID != null) {
      menu.dataset.vob = String(opts.vobID);
    }
    if (opts.domain != null) {
      menu.dataset.domain = String(opts.domain);
    }

    const stillTime = opts.still_time != null ? opts.still_time : 0;
    // Infinite still (255): still-only path. Playing these as motion finishes the
    // short cell and runs onPost, which auto-advances multi-cell PGCs (Harry Potter
    // scene selection pages → main menu).
    // Timed language copyrights (still_time ≥ 3, short cell, no buttons): still-only.
    const preferStillOnly = menuCellPrefersStillOnly(opts);
    const hasMotion =
      opts.startSec != null &&
      opts.endSec != null &&
      opts.endSec > opts.startSec &&
      stillTime !== 255 &&
      !preferStillOnly;

    const menuVideo = this.querySelector(
      `#menu-video-${opts.domain != null ? opts.domain : menu.dataset.domain}`,
    ) as HTMLVideoElement | null;
    if (menuVideo) {
      menuVideo.loop = false;
    }

    const playMotion = !!(hasMotion && menuVideo && menuVideo.src);
    // Copyright still-only: install PNG immediately (no defer) so we never sit on
    // a black WebM/hold cover. Other stills still defer for seamless handoff.
    const nextStillSrc = updateMenuCellVisuals(menu, opts, {
      stillMode: playMotion ? 'motion' : 'show',
      deferStillSrc: !playMotion && !preferStillOnly,
    });

    const baseDir = resolveMenuAssetBase(
      menu,
      opts.domain ?? menu.dataset.domain,
      opts,
    );
    preloadLinkedMenuAssets(this, menu, {
      domain: opts.domain ?? menu.dataset.domain,
      cellID: opts.cellID,
      vobID: opts.vobID,
      still_time: opts.still_time,
      buttons: opts.buttons,
      baseDir,
    });

    hideAllMenu(this);
    this.pause();
    if (typeof menu.show === 'function') {
      menu.show();
    } else {
      menu.style.display = 'flex';
    }

    // Snapshot whatever is on screen before we change layers.
    const stageStill = menu.querySelector(
      'img.menu-still',
    ) as HTMLImageElement | null;
    captureMenuHoldFromStage(this, {
      menuVideo,
      still: stageStill,
    });

    if (playMotion) {
      // Hold canvas covers the seek; keep still hidden (no cached PNG flash).
      if (stageStill) {
        stageStill.style.opacity = '0';
      }
    } else if (preferStillOnly) {
      // Language copyrights: show PNG now, hide video/hold (avoid black cover).
      if (stageStill) {
        stageStill.style.display = '';
        stageStill.style.opacity = '';
      }
      hideMenuVideoUnderCover(this, menuVideo, menu);
      hideMenuHoldFrame(this);
      hideOtherMenuVideos(this, null);
    } else {
      if (menuVideoShowsFrame(menuVideo) || menuHoldFrameVisible(this)) {
        // Frozen WebM or canvas hold is the cover — keep still hidden.
        if (stageStill) {
          stageStill.style.opacity = '0';
        }
        if (!menuVideoShowsFrame(menuVideo) && menuHoldFrameVisible(this)) {
          showMenuHoldFrame(this);
        }
      } else if (coverSrc) {
        ensureStillCoverVisible(menu, coverSrc, this as any);
      }
    }

    const btnIndex =
      Math.floor(
        ((window as any).sprm && (window as any).sprm.HL_BTNN
          ? (window as any).sprm.HL_BTNN
          : 0x0400) / 0x0400,
      ) - 1;
    const enableButtons = () => {
      if ((this as any)._dvdjsMenuPlayGen !== playGen) {
        return;
      }
      highlightMenuButton(menu, btnIndex);
      setMenuButtonsEnabled(menu, true);
      if (this.classList.contains('dvdjs-debug-hitboxes')) {
        applyDebugHitboxLabels(menu);
      }
      try {
        this.focus({ preventScroll: true });
      } catch {
        // ignore
      }
    };

    setMenuButtonsEnabled(menu, false);

    let hliDelay = 0;
    if (opts.hli_s_ptm != null && opts.hli_s_ptm > 0) {
      const cellStart = opts.startSec != null ? opts.startSec : 0;
      hliDelay = Math.max(0, opts.hli_s_ptm / 90000 - cellStart);
    }

    if (playMotion) {
      playMenuMotionSegment(
        this,
        menuVideo!,
        opts,
        () => {
          if (hliDelay > 0) {
            (this as any)._dvdjsHighlightTimer = setTimeout(
              enableButtons,
              hliDelay * 1000,
            );
          } else {
            enableButtons();
          }
        },
        playGen,
        coverSrc,
      );
      return;
    }

    if (preferStillOnly) {
      // PNG already installed + visible above. Hold still_time then PGC post.
      // After post sets the Avatar language cookie, skip studio-logo / Angle
      // JumpTT hubs and open the translated menus immediately.
      enableButtons();
      if (stillTime > 0 && stillTime < 255) {
        const priorPost = (this as any)._dvdjsMenuPost as
          | (() => void)
          | null
          | undefined;
        const wrappedPost = () => {
          try {
            priorPost?.();
          } finally {
            afterLanguageCopyrightPost(window as any);
          }
        };
        scheduleMenuPostAfterStill(this as any, stillTime, wrappedPost);
      }
      return;
    }

    // Still-only: keep frozen WebM / hold canvas until the *target* PNG has
    // pixels, then reveal still and drop video+hold together.
    const stillImg = menu.querySelector(
      'img.menu-still',
    ) as HTMLImageElement | null;
    const targetStillSrc =
      nextStillSrc || stillImg?.getAttribute('src') || null;

    const finishStillHandoff = (ready: boolean) => {
      if ((this as any)._dvdjsMenuPlayGen !== playGen) {
        return;
      }
      if ((this as any)._dvdjsActiveMenu !== menu) {
        return;
      }
      if ((this as any)._dvdjsFinishMenuSegment) {
        return;
      }
      if (!ready) {
        if (
          stillImg &&
          targetStillSrc &&
          stillImg.getAttribute('src') === targetStillSrc &&
          !stillImg.complete
        ) {
          void whenImageReady(stillImg, {
            timeoutMs: 30_000,
            expectedSrc: targetStillSrc,
          }).then(finishStillHandoff);
        }
        // Keep hold/video forever if the still never arrives.
        return;
      }
      // Reveal still first, then drop video + hold — never black.
      if (stillImg) {
        stillImg.style.display = '';
        stillImg.style.opacity = '';
      }
      notePaintedStill(this as any, stillImg);
      const spu = menu.querySelector('img.menu-spu') as HTMLElement | null;
      if (spu && spu.getAttribute('src')) {
        spu.style.display = '';
      }
      hideMenuVideoUnderCover(this, menuVideo, menu);
      hideMenuHoldFrame(this);
      hideOtherMenuVideos(this, null);
      if (menuVideo) {
        (this as any)._dvdjsMenuSegmentEnd = null;
        (this as any)._dvdjsFinishMenuSegment = null;
      }
    };

    const installStillWhenReady = async () => {
      if (!stillImg || !targetStillSrc) {
        finishStillHandoff(imageHasPixels(stillImg));
        return;
      }
      if (
        stillImg.getAttribute('src') === targetStillSrc &&
        imageHasPixels(stillImg)
      ) {
        finishStillHandoff(true);
        return;
      }
      // Keep still invisible while swapping; stage is covered by video/hold.
      stillImg.style.opacity = '0';
      if (!menuVideoShowsFrame(menuVideo)) {
        showMenuHoldFrame(this);
      }
      await preloadImageUrl(targetStillSrc);
      if ((this as any)._dvdjsMenuPlayGen !== playGen) {
        return;
      }
      stillImg.setAttribute('src', targetStillSrc);
      stillImg.style.display = '';
      stillImg.style.opacity = '0';
      const ready = await whenImageReady(stillImg, {
        timeoutMs: 30_000,
        expectedSrc: targetStillSrc,
      });
      finishStillHandoff(ready);
    };
    void installStillWhenReady();

    if (hliDelay > 0) {
      (this as any)._dvdjsHighlightTimer = setTimeout(
        enableButtons,
        hliDelay * 1000,
      );
    } else {
      enableButtons();
    }

    if (stillTime > 0 && stillTime < 255) {
      scheduleMenuPostAfterStill(
        this as any,
        stillTime,
        (this as any)._dvdjsMenuPost,
      );
    }
  }

  setMenuHighlight(menu: Element | null, buttonIndex: number) {
    const target = (menu || (this as any)._dvdjsActiveMenu) as HTMLElement | null;
    highlightMenuButton(target, buttonIndex);
    if (this.classList.contains('dvdjs-debug-hitboxes')) {
      applyDebugHitboxLabels(target);
    }
  }

  flashMenuActivate(menu: Element | null, buttonIndex: number) {
    flashMenuButtonActivate(
      menu || (this as any)._dvdjsActiveMenu,
      buttonIndex,
      120,
    );
  }

  /** Toggle green hitbox chrome + B0..Bn labels on menu buttons. */
  setDebugHitboxes(enabled: boolean) {
    this.classList.toggle('dvdjs-debug-hitboxes', enabled);
    const menu = (this as any)._dvdjsActiveMenu as HTMLElement | null;
    if (enabled) {
      applyDebugHitboxLabels(menu);
      // Re-stamp selection: Solid class= can drop .selected; data-selected is authoritative.
      const sprm = (window as any).sprm;
      const btnIndex =
        Math.floor(((sprm && sprm.HL_BTNN) || 0x0400) / 0x0400) - 1;
      highlightMenuButton(menu, btnIndex);
    } else {
      menu?.querySelectorAll('input.btn').forEach((btn) => {
        (btn as HTMLInputElement).value = '';
      });
    }
  }
}

class XMenu extends HTMLElement {
  connectedCallback() {
    this.style.display = 'none';
    this.hidden = true;
    this.style.position = 'absolute';
    this.style.inset = '0';
    this.style.zIndex = '1';
    this.style.alignItems = 'stretch';
    this.style.justifyContent = 'stretch';
  }

  show() {
    this.hidden = false;
    this.style.display = 'flex';
  }

  hide() {
    this.style.display = 'none';
    this.hidden = true;
  }
}

let registered = false;

/** Register native `<x-video>` / `<x-menu>` (vm.js contract, no x-tag). */
export function registerDvdHostElements() {
  if (registered || typeof customElements === 'undefined') {
    return;
  }
  if (!customElements.get('x-menu')) {
    customElements.define('x-menu', XMenu);
  }
  if (!customElements.get('x-video')) {
    customElements.define('x-video', XVideo);
  }
  registered = true;
}
