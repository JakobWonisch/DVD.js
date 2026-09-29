import {
  beginUserButtonNav as latchUserButtonNav,
  clearMissingTitleSkip,
  clearUserButtonNav,
  hideTitleUnavailableOverlay,
  restoreMenuResumeState,
  scheduleMenuPostAfterStill,
  shouldHoldAfterMenuMotion,
  showTitleUnavailableOverlay,
  tryAutoSkipMissingTitle,
} from './titleUnavailable.js';
import {
  notifyAutoplayBlocked,
  playWithAutoplayFallback,
  type AutoplayHost,
} from './autoplay.js';
import {
  applyDebugHitboxLabels,
  bindMenuKeys,
} from './menuKeys.js';
import { goToMainMenu as jumpToMainMenu } from './goToMainMenu.js';
import {
  freezeMenuVideoAtEnd,
  preloadLinkedMenuAssets,
  setMenuVideoSeekCover,
  stillCoverUrlFromMenu,
  whenImageReady,
} from './menuPreload.js';
import { skipPlaybackToEnd } from './skipToEnd.js';

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
  }>;
  spuSelect?: string[];
  spuActivate?: string[];
  onPost?: () => void;
};

type PlaylistEntry = {
  id: string;
  video: HTMLVideoElement;
  src: string;
  chapterCues: TextTrackCue[];
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
  /**
   * Pre-check before JumpTT / JumpVTS_* — if the title WebM is missing and the
   * jump came from a menu button, show the dialog without leaving the menu.
   * @returns false when the jump must be aborted.
   */
  guardTitleJump: (elementID: string) => boolean;
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

function isTitleMediaMissing(entry: PlaylistEntry | undefined) {
  if (!entry) {
    return true;
  }
  const src =
    entry.src ||
    entry.video.currentSrc ||
    entry.video.getAttribute('src') ||
    '';
  return !src;
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
  visualOpts: { stillMode?: 'show' | 'motion' } = {},
) {
  if (opts.cellID == null || opts.vobID == null) {
    return;
  }
  const stillMode = visualOpts.stillMode || 'show';
  const domain =
    opts.domain != null ? opts.domain : menu.dataset.domain;
  const baseDir = resolveMenuAssetBase(menu, domain, opts);
  const prefix =
    domain != null
      ? `menu-${domain}-${opts.cellID}-${opts.vobID}`
      : null;

  let still = menu.querySelector('img.menu-still') as HTMLImageElement | null;
  let cssHref: string | null = null;
  let stillSrc: string | null = null;

  if (baseDir && prefix) {
    stillSrc = `${baseDir}${prefix}.png`;
    cssHref = `${baseDir}${prefix}.css`;
  }

  // Prefer an already-linked stylesheet for this cell when present.
  const links = document.querySelectorAll(
    `link[href*="menu-${domain}-${opts.cellID}-${opts.vobID}"]`,
  );
  if (links.length) {
    cssHref = links[0].getAttribute('href') || cssHref;
  }

  if (stillMode === 'show' && stillSrc) {
    if (!still) {
      still = document.createElement('img');
      still.className = 'menu-still';
      still.alt = '';
      menu.insertBefore(still, menu.firstChild);
    }
    still.setAttribute('src', stillSrc);
    still.style.display = '';
    // Motion segments hide the still; always restore when swapping cells so a
    // late play() from the previous clip cannot leave a black screen.
    still.style.opacity = '';
    still.onerror = () => {
      // Motion-only cells may lack a still PNG — keep video visible.
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
        spu.style.display = '';
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
  }

  // Always rebuild hitboxes — empty cells must clear the previous page's buttons.
  menu.querySelectorAll('input.btn').forEach((el) => el.remove());
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
      menu.appendChild(input);
    }
  }
}

function playMenuMotionSegment(
  host: any,
  menuVideo: HTMLVideoElement,
  opts: MenuCellPlayOpts,
  onReady: () => void,
) {
  const start = opts.startSec || 0;
  const end = opts.endSec!;
  host._dvdjsMenuSegmentEnd = end;
  menuVideo.loop = false;

  const finishSegment = () => {
    if (host._dvdjsFinishMenuSegment !== finishSegment) {
      return;
    }
    if (host._dvdjsMotionWatchdog) {
      clearTimeout(host._dvdjsMotionWatchdog);
      host._dvdjsMotionWatchdog = null;
    }
    menuVideo.removeEventListener('timeupdate', onTimeUpdate);
    menuVideo.removeEventListener('ended', onEnded);
    if (host._dvdjsMenuTimeUpdate === onTimeUpdate) {
      host._dvdjsMenuTimeUpdate = null;
    }
    if (host._dvdjsMenuEnded === onEnded) {
      host._dvdjsMenuEnded = null;
    }
    // Freeze near end *before* leaving the segment. Some browsers snap to
    // frame 0 on `ended`. Do **not** reveal this cell's still PNG — for
    // transition cells that still is a mid-wipe / lookalike of the previous
    // menu and causes a visible jump. Hold the last decoded video frame.
    freezeMenuVideoAtEnd(menuVideo, start, end);
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
    // DVD: play the cell, then hold last frame for still_time before post().
    scheduleMenuPostAfterStill(host, stillTime, host._dvdjsMenuPost);
  };

  const onTimeUpdate = () => {
    // Finish before EOF so we pause on a real decoded frame. Hitting `ended`
    // resets many browsers to 0; freeze-seek would then snap to the cell's
    // opening keyframe (wipe start).
    if (menuVideo.currentTime >= end - 0.15) {
      finishSegment();
    }
  };

  // Artifacted / short WebMs may never reach endSec via timeupdate.
  const onEnded = () => {
    finishSegment();
  };

  host._dvdjsFinishMenuSegment = finishSegment;
  // Short / artifacted WebMs may never hit endSec or fire ended reliably.
  if (host._dvdjsMotionWatchdog) {
    clearTimeout(host._dvdjsMotionWatchdog);
  }
  host._dvdjsMotionWatchdog = setTimeout(
    () => {
      host._dvdjsMotionWatchdog = null;
      finishSegment();
    },
    Math.max(0.2, end - start + 0.35) * 1000,
  );

  if (host._dvdjsMenuTimeUpdate) {
    menuVideo.removeEventListener('timeupdate', host._dvdjsMenuTimeUpdate);
    host._dvdjsMenuTimeUpdate = null;
  }
  if (host._dvdjsMenuEnded) {
    menuVideo.removeEventListener('ended', host._dvdjsMenuEnded);
    host._dvdjsMenuEnded = null;
  }

  // Match still/SPU: fill the DVD stage (letterboxing is on the stage, not here).
  menuVideo.hidden = false;
  menuVideo.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:fill;z-index:0;';
  // Hide video during seek — sparse WebM keyframes flash the segment start.
  setMenuVideoSeekCover(menuVideo, true);
  const still =
    host._dvdjsActiveMenu &&
    host._dvdjsActiveMenu.querySelector('img.menu-still');

  const beginPlayback = () => {
    host._dvdjsMenuTimeUpdate = onTimeUpdate;
    host._dvdjsMenuEnded = onEnded;
    menuVideo.addEventListener('timeupdate', onTimeUpdate);
    menuVideo.addEventListener('ended', onEnded);
    void playWithAutoplayFallback(menuVideo, host as AutoplayHost).then(
      (ok) => {
        // Segment may have already finished / advanced (seek past EOF, short
        // WebM). Do not hide the still after the next cell has taken over.
        if (host._dvdjsFinishMenuSegment !== finishSegment) {
          return;
        }
        if (ok) {
          const reveal = () => {
            if (host._dvdjsFinishMenuSegment !== finishSegment) {
              return;
            }
            // Only drop the cover once we are actually inside this segment.
            if (menuVideo.currentTime < start - 0.25) {
              return;
            }
            setMenuVideoSeekCover(menuVideo, false);
            if (still) {
              (still as HTMLElement).style.opacity = '0';
            }
            onReady();
          };
          if (menuVideo.currentTime >= start - 0.25) {
            reveal();
          } else {
            const onTime = () => {
              if (menuVideo.currentTime >= start - 0.25) {
                menuVideo.removeEventListener('timeupdate', onTime);
                reveal();
              }
            };
            menuVideo.addEventListener('timeupdate', onTime);
            // Safety: don't leave the cover forever if timeupdate is sparse.
            setTimeout(() => {
              menuVideo.removeEventListener('timeupdate', onTime);
              reveal();
            }, 400);
          }
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
          if (
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
  };

  /** Seek then play — avoids black/skip when re-entering a segment already near end. */
  const seekThenPlay = () => {
    const onSeeked = () => {
      menuVideo.removeEventListener('seeked', onSeeked);
      beginPlayback();
    };
    if (Math.abs(menuVideo.currentTime - start) < 0.04) {
      beginPlayback();
      return;
    }
    menuVideo.addEventListener('seeked', onSeeked);
    try {
      menuVideo.currentTime = start;
    } catch {
      menuVideo.removeEventListener('seeked', onSeeked);
      beginPlayback();
    }
  };

  if (menuVideo.readyState >= 1) {
    seekThenPlay();
  } else {
    const onMeta = () => {
      menuVideo.removeEventListener('loadedmetadata', onMeta);
      seekThenPlay();
    };
    menuVideo.addEventListener('loadedmetadata', onMeta);
    menuVideo.load();
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

  /** Snapshot menu/VM before a user button command runs. */
  beginUserButtonNav(): void {
    latchUserButtonNav(this as any, window as any);
  }

  /**
   * Called from compiled JumpTT / JumpVTS_* before title PGC run.
   * When a menu button targets a missing title, show the dialog and abort
   * without mutating domain/pgc or hiding the current menu.
   */
  guardTitleJump(elementID: string): boolean {
    if (elementID === undefined) {
      return true;
    }
    const id = String(elementID);
    this.#refreshPlaylist();
    const entry = this.playlist.find((e) => e.id === id);
    if (!isTitleMediaMissing(entry)) {
      return true;
    }
    // Missing title: button → sticky dialog in place; FP/auto → let run proceed.
    if ((this as any)._dvdjsFromButton) {
      showTitleUnavailable(this);
      return false;
    }
    return true;
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

    if (isTitleMediaMissing(this.playlist[targetElementIndex])) {
      showTitleUnavailable(this);
      return;
    }

    hideTitleUnavailableOverlay(this);
    this.videoIndex = targetElementIndex;
    hideAllMenu(this);

    const video = this.playlist[this.videoIndex].video;
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
    clearDvdjsTimers(this);
    const domainVideo = this.querySelector(
      `#menu-video-${menu.dataset.domain != null ? menu.dataset.domain : ''}`,
    ) as HTMLVideoElement | null;
    resetMenuMotion(this, domainVideo, menu);
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
    clearDvdjsTimers(this);

    // Capture outgoing still before we retarget _dvdjsActiveMenu.
    const prevMenu = (this as any)._dvdjsActiveMenu as HTMLElement | null;
    const coverSrc = stillCoverUrlFromMenu(prevMenu);

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
    const hasMotion =
      opts.startSec != null &&
      opts.endSec != null &&
      opts.endSec > opts.startSec &&
      stillTime !== 255;

    const menuVideo = this.querySelector(
      `#menu-video-${opts.domain != null ? opts.domain : menu.dataset.domain}`,
    ) as HTMLVideoElement | null;
    if (menuVideo) {
      menuVideo.loop = false;
    }

    updateMenuCellVisuals(menu, opts, {
      stillMode: hasMotion && menuVideo && menuVideo.src ? 'motion' : 'show',
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
      baseDir,
    });

    hideAllMenu(this);
    this.pause();
    if (typeof menu.show === 'function') {
      menu.show();
    } else {
      menu.style.display = 'flex';
    }

    if (hasMotion && menuVideo && menuVideo.src) {
      let still = menu.querySelector(
        'img.menu-still',
      ) as HTMLImageElement | null;
      if (!still && coverSrc) {
        still = document.createElement('img');
        still.className = 'menu-still';
        still.alt = '';
        menu.insertBefore(still, menu.firstChild);
      }
      if (still && coverSrc) {
        // Hold the previous menu under the seek; hide once playback starts.
        still.setAttribute('src', coverSrc);
        still.style.display = '';
        still.style.opacity = '';
      } else if (still) {
        still.style.opacity = '0';
      }
    }

    const btnIndex =
      Math.floor(
        ((window as any).sprm && (window as any).sprm.HL_BTNN
          ? (window as any).sprm.HL_BTNN
          : 0x0400) / 0x0400,
      ) - 1;
    const enableButtons = () => {
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

    if (hasMotion && menuVideo && menuVideo.src) {
      playMenuMotionSegment(this, menuVideo, opts, () => {
        if (hliDelay > 0) {
          (this as any)._dvdjsHighlightTimer = setTimeout(
            enableButtons,
            hliDelay * 1000,
          );
        } else {
          enableButtons();
        }
      });
      return;
    }

    // Still-only (or motion missing): keep the previous WebM frame painted
    // until the still PNG is ready, then hide the video.
    const stillImg = menu.querySelector(
      'img.menu-still',
    ) as HTMLImageElement | null;
    const hideVideoWhenStillReady = () => {
      if ((this as any)._dvdjsActiveMenu !== menu) {
        return;
      }
      // A newer motion segment owns the video now — leave it alone.
      if ((this as any)._dvdjsFinishMenuSegment) {
        return;
      }
      resetMenuMotion(this, menuVideo, menu);
    };
    void whenImageReady(stillImg).then(hideVideoWhenStillReady);

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
